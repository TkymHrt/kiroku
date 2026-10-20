import {
  bodyBytes,
  MAX_BODY_BYTES,
  type ApiProblem,
  type Diary,
  type DiaryResponse,
  type MutationResponse,
} from "./types";
import {
  createDraftRepository,
  DraftRevisionConflict,
  emptyDraft,
  type Draft,
  type DraftProblem,
  type DraftRepositoryLike,
  type MutationKind,
  type PendingMutation,
} from "./drafts";

export type SaveStatus =
  | "saved"
  | "local-saving"
  | "local"
  | "syncing"
  | "unsynced"
  | "auth"
  | "conflict"
  | "error";
type Listener = () => void;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface SyncOptions {
  repository?: DraftRepositoryLike;
  fetcher?: Fetcher;
  debounceMs?: number;
  now?: () => number;
  /** Disable only in tests. Browser lifecycle hooks and BroadcastChannel are enabled by default. */
  browserEvents?: boolean;
}

class RequestFailure extends Error {
  constructor(
    readonly status: number,
    readonly problem: ApiProblem,
    readonly retryAfter = 0,
  ) {
    super(problem.message);
  }
}

export function retryAfterMilliseconds(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

function sameServer(a: Diary | null | undefined, b: Diary | null | undefined): boolean {
  return (a?.id ?? null) === (b?.id ?? null) && (a?.version ?? null) === (b?.version ?? null);
}

function isDiary(value: unknown): value is Diary {
  if (!value || typeof value !== "object") return false;
  const diary = value as Record<string, unknown>;
  return (
    typeof diary.id === "string" &&
    typeof diary.date === "string" &&
    typeof diary.body === "string" &&
    Number.isInteger(diary.version) &&
    typeof diary.createdAt === "string" &&
    typeof diary.updatedAt === "string" &&
    (diary.deletedAt === null || typeof diary.deletedAt === "string")
  );
}

/** Durable per-day queues; a completion is always applied to its own day and request ID. */
export class DiarySyncEngine {
  private readonly repository: DraftRepositoryLike;
  private readonly fetcher: Fetcher;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private readonly browserEvents: boolean;
  private readonly owner = crypto.randomUUID();
  private readonly records = new Map<string, Draft>();
  private readonly listeners = new Set<Listener>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly localQueues = new Map<string, Promise<void>>();
  private readonly localCounts = new Map<string, number>();
  private readonly active = new Map<string, Promise<void>>();
  private readonly syncing = new Set<string>();
  private readonly failedLocal = new Set<string>();
  private channel: BroadcastChannel | null = null;
  private started = false;
  private stopped = false;

  constructor(options: SyncOptions = {}) {
    this.repository = options.repository ?? createDraftRepository();
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.debounceMs = options.debounceMs ?? 1000;
    this.now = options.now ?? Date.now;
    this.browserEvents = options.browserEvents ?? true;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    let records: Draft[] = [];
    try {
      records = await this.repository.list();
    } catch {
      /* Opening a date exposes a recoverable scratch editor. */
    }
    for (const record of records) {
      if (!this.failedLocal.has(record.date)) this.apply(record, record.date);
    }
    if (this.browserEvents && typeof window !== "undefined") {
      window.addEventListener("online", this.onWake);
      window.addEventListener("focus", this.onWake);
      document.addEventListener("visibilitychange", this.onVisibility);
      window.addEventListener("beforeunload", this.onBeforeUnload);
      if (typeof BroadcastChannel !== "undefined") {
        this.channel = new BroadcastChannel("kiroku-draft-changes");
        this.channel.onmessage = (event) => {
          if (typeof event.data?.date === "string") void this.refreshFromOtherTab(event.data.date);
        };
      }
    }
    this.emit();
    for (const record of records) {
      if (record.dirty || record.pending)
        this.schedule(record.date, Math.max(0, (record.retryAt ?? 0) - this.now()));
    }
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.channel?.close();
    this.channel = null;
    if (this.browserEvents && typeof window !== "undefined") {
      window.removeEventListener("online", this.onWake);
      window.removeEventListener("focus", this.onWake);
      document.removeEventListener("visibilitychange", this.onVisibility);
      window.removeEventListener("beforeunload", this.onBeforeUnload);
    }
    this.started = false;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getDraft(date: string): Draft | undefined {
    return this.records.get(date);
  }
  getDrafts(): Draft[] {
    return [...this.records.values()];
  }

  getStatus(date: string): SaveStatus {
    const record = this.records.get(date);
    if (this.failedLocal.has(date)) return "error";
    if ((this.localCounts.get(date) ?? 0) > 0) return "local-saving";
    if (record?.problem?.kind === "auth") return "auth";
    if (record?.problem?.kind === "conflict" || record?.problem?.kind === "recovery")
      return "conflict";
    if (record?.problem && record.problem.kind !== "network") return "error";
    if (this.syncing.has(date)) return "syncing";
    if (!record || (!record.dirty && !record.pending)) return "saved";
    return record.problem?.kind === "network" ? "unsynced" : "local";
  }

  async open(date: string): Promise<Draft> {
    await this.flushLocal(date);
    let stored: Draft | null;
    try {
      stored = await this.repository.get(date);
    } catch {
      const existing = this.records.get(date) ?? emptyDraft(date);
      let scratch = existing;
      try {
        const response = await this.request<DiaryResponse>(date);
        scratch = {
          ...existing,
          diary: response.diary,
          epoch: response.epoch,
          absenceToken: response.absenceToken,
          body: existing.dirty || existing.pending ? existing.body : (response.diary?.body ?? ""),
        };
      } catch {
        /* Keep any memory text if both storage and the network fail. */
      }
      scratch = {
        ...scratch,
        problem: {
          kind: "storage",
          message:
            "端末内保存を利用できません。本文はこの画面にだけ保持しています。画面を閉じず、コピーまたはMarkdown保存で退避してください。",
        },
      };
      this.records.set(date, scratch);
      this.failedLocal.add(date);
      this.emit();
      return scratch;
    }
    if (stored) this.records.set(date, stored);
    else if (!this.records.has(date)) this.records.set(date, emptyDraft(date));
    this.emit();
    try {
      const response = await this.request<DiaryResponse>(date);
      const result = await this.change(date, (current) => {
        const local = current ?? emptyDraft(date);
        if (local.dirty || local.pending) {
          if (local.epoch && local.epoch !== response.epoch)
            return this.withConflict(
              local,
              response.diary,
              response.epoch,
              true,
              response.absenceToken,
            );
          // A pending operation may already have succeeded. Replay it before interpreting changed versions.
          if (
            !local.pending &&
            (!sameServer(local.diary, response.diary) ||
              (!local.diary &&
                !response.diary &&
                (local.absenceToken ?? null) !== response.absenceToken))
          ) {
            return this.withConflict(
              local,
              response.diary,
              response.epoch,
              false,
              response.absenceToken,
            );
          }
          return {
            ...local,
            epoch: response.epoch,
            diary: local.diary ?? response.diary,
            absenceToken: local.epoch ? (local.absenceToken ?? null) : response.absenceToken,
          };
        }
        return {
          ...local,
          body: response.diary?.body ?? "",
          diary: response.diary,
          epoch: response.epoch,
          absenceToken: response.absenceToken,
          tombstone: false,
          problem: null,
          lastSyncedAt: this.iso(),
          updatedAt: this.iso(),
        };
      });
      if (result?.dirty || result?.pending) this.schedule(date, 0);
    } catch (error) {
      await this.recordFailure(date, error, false);
    }
    return this.records.get(date) ?? emptyDraft(date);
  }

  /** The returned promise resolves only after the text is committed to IndexedDB. */
  edit(date: string, body: string, expectedRevision?: number): Promise<Draft> {
    const previous = this.records.get(date) ?? emptyDraft(date);
    const expected = expectedRevision ?? previous.revision;
    const revision = expected + 1;
    const optimistic: Draft = {
      ...previous,
      body,
      revision,
      dirty: true,
      updatedAt: this.iso(),
      unsyncedSince: previous.unsyncedSince ?? this.iso(),
    };
    this.records.set(date, optimistic);
    this.localCounts.set(date, (this.localCounts.get(date) ?? 0) + 1);
    this.emit();
    const previousQueue = this.localQueues.get(date) ?? Promise.resolve();
    const operation = previousQueue
      .catch(() => {})
      .then(async () => {
        try {
          const saved = await this.repository.change(date, (current) => {
            if ((current?.revision ?? 0) !== expected) throw new DraftRevisionConflict(current);
            const base = current ?? previous;
            const dirty = !!base.pending || body !== (base.diary?.body ?? "");
            let problem = base.problem;
            if (problem?.kind === "storage" || problem?.kind === "validation") problem = null;
            if (bodyBytes(body) > MAX_BODY_BYTES)
              problem = {
                kind: "validation",
                message:
                  "本文が1,000,000バイトを超えています。端末には保持します。コピーまたはMarkdown保存で退避してください。",
              };
            if (base.tombstone && body)
              problem = {
                kind: "conflict",
                message:
                  "この日記は完全削除されています。日付を開き直し、新しく作成するか確認してください。",
                server: null,
                epoch: base.epoch ?? undefined,
              };
            return {
              ...base,
              body,
              revision,
              dirty,
              problem,
              updatedAt: optimistic.updatedAt,
              retryAt: base.retryAt ?? 0,
              retryCount: base.retryCount ?? 0,
              unsyncedSince: dirty ? (base.unsyncedSince ?? optimistic.updatedAt) : null,
            };
          });
          this.failedLocal.delete(date);
          this.apply(saved!, date);
          this.channel?.postMessage({ date });
          if (saved?.dirty || saved?.pending) this.schedule(date, this.debounceMs);
          return saved!;
        } catch (error) {
          const latest = this.records.get(date) ?? optimistic;
          const problem: DraftProblem =
            error instanceof DraftRevisionConflict
              ? { kind: "conflict", message: error.message, server: error.current?.diary ?? null }
              : {
                  kind: "storage",
                  message:
                    "端末内保存に失敗しました。画面を閉じず、本文をコピーまたはMarkdown保存で退避してください。",
                };
          this.records.set(date, { ...latest, problem });
          this.failedLocal.add(date);
          throw error;
        } finally {
          this.localCounts.set(date, Math.max(0, (this.localCounts.get(date) ?? 1) - 1));
          this.emit();
        }
      });
    this.localQueues.set(
      date,
      operation.then(
        () => {},
        () => {},
      ),
    );
    return operation;
  }

  async flushLocal(date?: string): Promise<void> {
    if (date) await this.localQueues.get(date);
    else await Promise.all(this.localQueues.values());
    if (date ? this.failedLocal.has(date) : this.failedLocal.size > 0) {
      throw new Error(
        "端末内保存が完了していません。本文をコピーまたはMarkdown保存してから移動してください。",
      );
    }
  }

  async retry(date?: string): Promise<void> {
    const targets = date ? [date] : [...this.records.keys()];
    await Promise.all(
      targets.map(async (target) => {
        const memory = this.records.get(target);
        if (this.failedLocal.has(target) && memory) {
          if (memory.problem?.kind === "conflict") {
            throw new Error(
              "別の画面に新しい端末内下書きがあります。この画面の本文をコピーまたはMarkdown保存し、ほかの画面の変更を確認してから再読み込みしてください。",
            );
          }
          const stored = await this.repository.get(target);
          await this.edit(target, memory.body, stored?.revision ?? 0);
        }
        const current = this.records.get(target);
        if (current?.problem && !current.dirty && !current.pending) {
          // A deliberate read retry can bypass our local backoff. A server-requested
          // Retry-After still applies; otherwise an early tap has no scheduled wakeup.
          if ((current.retryAfterUntil ?? 0) > this.now()) return;
          await this.open(target);
          return;
        }
        if (current?.problem?.kind === "auth") {
          // An authenticated GET is required before resuming a queue paused for authentication.
          try {
            await this.request<DiaryResponse>(target);
          } catch (error) {
            await this.recordFailure(target, error, false);
            return;
          }
        }
        await this.change(
          target,
          (stored) =>
            stored && {
              ...stored,
              problem: stored.problem?.kind === "auth" ? null : stored.problem,
              // A manual retry also respects the server's Retry-After deadline.
              retryAt: stored.retryAt ?? 0,
            },
        );
        await this.syncDay(target);
      }),
    );
  }

  async mutate(date: string, kind: Exclude<MutationKind, "create" | "update">): Promise<void> {
    await this.flushLocal(date);
    await this.syncDay(date);
    const current = await this.repository.get(date);
    if (!current?.diary || !current.epoch || current.dirty || current.pending || current.problem) {
      throw new Error("保存または競合解決を完了してから操作してください。");
    }
    await this.change(date, (stored) => {
      if (!stored || !sameServer(stored.diary, current.diary) || stored.dirty || stored.pending)
        throw new DraftRevisionConflict(stored);
      return { ...stored, pending: this.operation(stored, kind), unsyncedSince: this.iso() };
    });
    await this.syncDay(date);
  }

  async resolve(date: string, choice: "server" | "local" | "merge", body?: string): Promise<void> {
    await this.flushLocal(date);
    const previous = this.records.get(date);
    if (!previous?.problem || !["conflict", "recovery"].includes(previous.problem.kind)) return;
    const response = await this.request<DiaryResponse>(date);
    const shownServer = previous.problem.server;
    if (
      shownServer !== undefined &&
      (!sameServer(shownServer, response.diary) ||
        (previous.problem.epoch && previous.problem.epoch !== response.epoch) ||
        (previous.problem.absenceToken !== undefined &&
          previous.problem.absenceToken !== response.absenceToken))
    ) {
      await this.change(
        date,
        (current) =>
          current &&
          this.withConflict(current, response.diary, response.epoch, false, response.absenceToken),
      );
      throw new Error("サーバー版が再び更新されました。新しい内容を確認してください。");
    }
    await this.change(date, (current) => {
      if (!current || current.revision !== previous.revision)
        throw new DraftRevisionConflict(current);
      const selectedBody =
        choice === "server"
          ? (response.diary?.body ?? "")
          : choice === "merge"
            ? (body ?? current.body)
            : current.body;
      if (choice !== "server" && response.diary?.deletedAt) {
        throw new Error(
          "サーバー版はゴミ箱内にあります。サーバー版を採用して復元し、退避した本文を統合してください。",
        );
      }
      const dirty = selectedBody !== (response.diary?.body ?? "");
      return {
        ...current,
        body: selectedBody,
        revision: current.revision + 1,
        diary: response.diary,
        epoch: response.epoch,
        absenceToken: response.absenceToken,
        pending: null,
        problem: null,
        tombstone: false,
        dirty,
        unsyncedSince: dirty ? (current.unsyncedSince ?? this.iso()) : null,
        retryAt: 0,
        retryCount: 0,
      };
    });
    this.schedule(date, 0);
  }

  private onWake = (): void => {
    // Authentication and conflicts need an explicit retry/decision, but transient failures wake automatically.
    for (const record of this.records.values()) {
      if (
        (record.dirty || record.pending) &&
        (!record.problem || record.problem.kind === "network")
      ) {
        this.schedule(record.date, Math.max(0, (record.retryAt ?? 0) - this.now()));
      }
    }
  };
  private onVisibility = (): void => {
    if (document.visibilityState === "visible") this.onWake();
  };
  private onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (this.failedLocal.size || [...this.localCounts.values()].some((count) => count > 0)) {
      event.preventDefault();
      event.returnValue = "";
    }
  };

  private schedule(date: string, milliseconds: number): void {
    if (this.stopped) return;
    const previous = this.timers.get(date);
    if (previous) clearTimeout(previous);
    this.timers.set(
      date,
      setTimeout(
        () => {
          this.timers.delete(date);
          void this.syncDay(date).catch(() => {});
        },
        Math.min(Math.max(0, milliseconds), 2_147_483_647),
      ),
    );
  }

  private async syncDay(date: string): Promise<void> {
    const existing = this.active.get(date);
    if (existing) return existing;
    const task = this.runSync(date).finally(() => {
      this.active.delete(date);
      this.syncing.delete(date);
      this.emit();
    });
    this.active.set(date, task);
    return task;
  }

  private async runSync(date: string): Promise<void> {
    await this.flushLocal(date);
    if (this.stopped || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    let record = await this.repository.get(date);
    if (!record || (!record.dirty && !record.pending)) return;
    if (record.problem && record.problem.kind !== "network") return;
    if ((record.retryAt ?? 0) > this.now()) {
      this.schedule(date, record.retryAt! - this.now());
      return;
    }
    if (bodyBytes(record.body) > MAX_BODY_BYTES) {
      await this.change(
        date,
        (current) =>
          current && {
            ...current,
            problem: {
              kind: "validation",
              message:
                "本文が1,000,000バイトを超えています。端末に保持中です。コピーまたはMarkdown保存で退避してください。",
            },
          },
      );
      return;
    }
    if (!record.epoch) {
      try {
        const response = await this.request<DiaryResponse>(date);
        record = await this.change(date, (current) => {
          if (!current) return null;
          if (response.diary && !sameServer(current.diary, response.diary))
            return this.withConflict(
              current,
              response.diary,
              response.epoch,
              false,
              response.absenceToken,
            );
          if (!response.diary && response.absenceToken !== null)
            return this.withConflict(current, null, response.epoch, false, response.absenceToken);
          return {
            ...current,
            diary: response.diary,
            epoch: response.epoch,
            absenceToken: response.absenceToken,
          };
        });
      } catch (error) {
        await this.recordFailure(date, error);
        return;
      }
      if (!record || record.problem?.kind === "conflict") return;
    }
    const claimed = await this.change(date, (current) => {
      if (
        !current ||
        (current.lease && current.lease.owner !== this.owner && current.lease.until > this.now())
      )
        return current;
      if (current.problem && current.problem.kind !== "network") return current;
      if (!current.pending && (!current.dirty || (!current.diary && current.body === "")))
        return current;
      return {
        ...current,
        pending: current.pending ?? this.operation(current, current.diary ? "update" : "create"),
        lease: { owner: this.owner, until: this.now() + 30_000 },
      };
    });
    if (!claimed?.pending || claimed.lease?.owner !== this.owner) {
      if (claimed?.lease) this.schedule(date, Math.max(100, claimed.lease.until - this.now()));
      return;
    }
    const pending = claimed.pending;
    this.syncing.add(date);
    this.emit();
    try {
      const { revision: _revision, ...payload } = pending;
      const response = await this.request<MutationResponse>(date, payload);
      if (response.mutationId !== pending.mutationId || response.epoch !== pending.epoch) {
        throw new RequestFailure(409, {
          code: "RECOVERY_REQUIRED",
          message: "保存中にデータベースの状態が変更されました。両方の本文を確認してください。",
          diary: response.diary,
          epoch: response.epoch,
          absenceToken: response.absenceToken,
        });
      }
      const saved = await this.change(date, (current) => {
        if (!current || current.pending?.mutationId !== pending.mutationId) return current;
        const newerServer =
          pending.kind === "purge"
            ? response.diary !== null
            : response.diary?.version !== response.appliedVersion ||
              response.diary?.id !== response.appliedDiaryId;
        if (newerServer) {
          return {
            ...this.withConflict(
              current,
              response.diary,
              response.epoch,
              false,
              response.absenceToken,
            ),
            pending: null,
            lease: undefined,
          };
        }
        if (pending.kind === "purge") {
          if (current.revision !== pending.revision)
            return {
              ...this.withConflict(current, null, response.epoch, false, response.absenceToken),
              pending: null,
              lease: undefined,
            };
          return {
            ...current,
            body: "",
            diary: null,
            pending: null,
            dirty: false,
            problem: null,
            absenceToken: response.absenceToken,
            tombstone: true,
            lease: undefined,
            unsyncedSince: null,
            lastSyncedAt: this.iso(),
            retryAt: 0,
            retryAfterUntil: 0,
            retryCount: 0,
          };
        }
        if (!response.diary)
          return {
            ...this.withConflict(current, null, response.epoch, false, response.absenceToken),
            pending: null,
            lease: undefined,
          };
        const dirty = current.body !== response.diary.body;
        return {
          ...current,
          diary: response.diary,
          epoch: response.epoch,
          absenceToken: response.absenceToken,
          pending: null,
          dirty,
          problem: null,
          lease: undefined,
          unsyncedSince: dirty ? current.unsyncedSince : null,
          lastSyncedAt: this.iso(),
          retryAt: 0,
          retryAfterUntil: 0,
          retryCount: 0,
        };
      });
      if (saved?.dirty && !saved.problem) this.schedule(date, 0);
    } catch (error) {
      await this.recordFailure(date, error);
    } finally {
      await this.change(date, (current) =>
        current?.lease?.owner === this.owner ? { ...current, lease: undefined } : current,
      );
    }
  }

  private operation(record: Draft, kind: MutationKind): PendingMutation {
    return {
      mutationId: crypto.randomUUID(),
      kind,
      id: record.diary?.id ?? null,
      expectedVersion: record.diary?.version ?? null,
      epoch: record.epoch!,
      revision: record.revision,
      ...(kind === "create" ? { absenceToken: record.absenceToken ?? null } : {}),
      ...(kind === "create" || kind === "update" ? { body: record.body } : {}),
    };
  }

  private async request<T>(date: string, payload?: Omit<PendingMutation, "revision">): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await this.fetcher(`/api/diaries/${encodeURIComponent(date)}`, {
        method: payload ? "POST" : "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
        headers: payload
          ? { "Content-Type": "application/json", "X-Kiroku-CSRF": "1" }
          : { Accept: "application/json" },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      const isJson = response.headers.get("content-type")?.includes("application/json");
      if (!isJson) {
        const authentication =
          response.status < 400 || response.status === 401 || response.status === 403;
        throw new RequestFailure(authentication ? 401 : response.status, {
          code: authentication ? "AUTH_REQUIRED" : "SERVER_ERROR",
          message: authentication
            ? "認証を確認できません。再認証後に「再試行」を押してください。端末の本文は保持しています。"
            : "サーバーが応答できません。本文は端末に保持し、時間をおいて再試行します。",
        });
      }
      const decoded: unknown = await response.json();
      if (!decoded || typeof decoded !== "object") throw new TypeError("Invalid server response");
      const data = decoded as Record<string, unknown>;
      if (!response.ok) {
        const problem: ApiProblem = {
          code: typeof data?.code === "string" ? data.code : "SERVER_ERROR",
          message:
            typeof data?.message === "string"
              ? data.message
              : "保存できませんでした。本文は端末に保持しています。",
          ...(data.diary === null || isDiary(data.diary) ? { diary: data.diary } : {}),
          ...(typeof data?.epoch === "string" ? { epoch: data.epoch } : {}),
          ...(data.absenceToken === null || typeof data.absenceToken === "string"
            ? { absenceToken: data.absenceToken }
            : {}),
        };
        throw new RequestFailure(
          response.status,
          problem,
          retryAfterMilliseconds(response.headers.get("Retry-After"), this.now()),
        );
      }
      if (
        typeof data.epoch !== "string" ||
        (data.diary !== null && !isDiary(data.diary)) ||
        (payload &&
          (data.mutationId !== payload.mutationId ||
            !("appliedVersion" in data) ||
            typeof data.appliedDiaryId !== "string"))
      ) {
        throw new TypeError("Invalid server response");
      }
      return decoded as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async recordFailure(date: string, error: unknown, scheduleRetry = true): Promise<void> {
    const failure = error instanceof RequestFailure ? error : null;
    let kind: DraftProblem["kind"] = "network";
    if (
      failure?.status === 401 ||
      failure?.status === 403 ||
      failure?.problem.code === "AUTH_REQUIRED"
    )
      kind = "auth";
    else if (failure?.status === 409 || failure?.status === 404)
      kind =
        failure.problem.code.includes("EPOCH") || failure.problem.code.includes("RECOVERY")
          ? "recovery"
          : "conflict";
    else if (
      failure &&
      failure.status >= 400 &&
      failure.status < 500 &&
      failure.status !== 408 &&
      failure.status !== 429
    )
      kind = "validation";
    const message =
      failure?.problem.message ??
      "通信できません。本文は端末内に保持し、接続が戻ったら再試行します。";
    try {
      const saved = await this.change(date, (current) => {
        const record = current ?? this.records.get(date) ?? emptyDraft(date);
        const retryCount = (record.retryCount ?? 0) + 1;
        const delay = Math.max(
          failure?.retryAfter ?? 0,
          Math.min(300_000, 1000 * 2 ** Math.min(retryCount - 1, 9)),
        );
        return {
          ...record,
          problem: {
            kind,
            message,
            ...(kind === "conflict" || kind === "recovery"
              ? {
                  server: failure?.problem.diary ?? null,
                  epoch: failure?.problem.epoch,
                  absenceToken: failure?.problem.absenceToken,
                }
              : {}),
          },
          retryCount,
          retryAt: kind === "network" ? this.now() + delay : 0,
          retryAfterUntil: failure?.retryAfter
            ? this.now() + failure.retryAfter
            : record.retryAfterUntil,
          lease: undefined,
        };
      });
      if (kind === "network" && scheduleRetry && saved && (saved.dirty || saved.pending))
        this.schedule(date, (saved.retryAt ?? this.now()) - this.now());
    } catch {
      const record = this.records.get(date) ?? emptyDraft(date);
      this.records.set(date, {
        ...record,
        problem: {
          kind: "storage",
          message:
            "端末内保存に失敗しました。画面を閉じず、本文をコピーまたはMarkdown保存で退避してください。",
        },
      });
      this.failedLocal.add(date);
      this.emit();
    }
  }

  private withConflict(
    record: Draft,
    server: Diary | null,
    epoch: string,
    recovery = false,
    absenceToken?: string | null,
  ): Draft {
    return {
      ...record,
      problem: {
        kind: recovery ? "recovery" : "conflict",
        message: recovery
          ? "データベースが復旧・更新されています。端末版とサーバー版を確認して同期を再開してください。"
          : "別の画面または端末で変更されています。端末版とサーバー版を確認してください。",
        server,
        epoch,
        absenceToken,
      },
    };
  }

  private async change(
    date: string,
    update: (current: Draft | null) => Draft | null,
  ): Promise<Draft | null> {
    const result = await this.repository.change(date, update);
    this.apply(result, date);
    this.channel?.postMessage({ date });
    return result;
  }

  private apply(record: Draft | null, date: string): void {
    const memory = this.records.get(date);
    // Metadata acknowledgements must never replace a more recent not-yet-committed keystroke.
    if (
      record &&
      memory &&
      memory.revision > record.revision &&
      (this.localCounts.get(date) ?? 0) > 0
    ) {
      this.records.set(date, {
        ...record,
        body: memory.body,
        revision: memory.revision,
        dirty: true,
        updatedAt: memory.updatedAt,
      });
    } else if (record) this.records.set(date, record);
    else this.records.delete(date);
    this.emit();
  }

  private async refreshFromOtherTab(date: string): Promise<void> {
    if ((this.localCounts.get(date) ?? 0) > 0 || this.failedLocal.has(date)) return;
    const record = await this.repository.get(date);
    this.apply(record, date);
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
