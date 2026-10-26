import { afterEach, describe, expect, it } from "vite-plus/test";
import { IDBFactory } from "fake-indexeddb";
import { DraftRepository, DraftRevisionConflict, emptyDraft } from "./drafts";
import { DiarySyncEngine, retryAfterMilliseconds } from "./sync";
import type { Diary, MutationRequest, MutationResponse } from "./types";

const date = "2026-10-18";
const otherDate = "2026-10-17";
const databases: DraftRepository[] = [];
const engines: DiarySyncEngine[] = [];

function repository(factory = new IDBFactory(), name: string = crypto.randomUUID()) {
  const value = new DraftRepository(name, factory);
  databases.push(value);
  return value;
}

function engine(repo: DraftRepository, server: FakeServer, now?: () => number) {
  const value = new DiarySyncEngine({
    repository: repo,
    fetcher: server.fetch,
    browserEvents: false,
    debounceMs: 1_000_000,
    now,
  });
  engines.push(value);
  return value;
}

function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function diary(body: string, version = 1, day = date): Diary {
  return {
    id: `id-${day}`,
    date: day,
    body,
    version,
    deletedAt: null,
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
  };
}

class FakeServer {
  epoch = "epoch-1";
  diaries = new Map<string, Diary>();
  requests: MutationRequest[] = [];
  receipts = new Map<string, { version: number | null; id: string }>();
  tokens = new Map<string, string>();
  loseResponse = false;
  auth = false;
  failure: Response | null = null;
  beforePost: ((day: string) => Promise<void>) | null = null;
  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const day = (input instanceof Request ? input.url : input.toString()).split("/").at(-1)!;
    if (this.auth) return json({ code: "AUTH_REQUIRED", message: "認証切れ" }, 401);
    if (init?.method !== "POST")
      return json({
        diary: this.diaries.get(day) ?? null,
        epoch: this.epoch,
        absenceToken: this.tokens.get(day) ?? null,
      });
    expect(new Headers(init.headers).get("X-Kiroku-CSRF")).toBe("1");
    const request = JSON.parse(init.body as string) as MutationRequest;
    this.requests.push(request);
    await this.beforePost?.(day);
    if (this.failure) return this.failure.clone();
    const current = this.diaries.get(day) ?? null;
    if (request.epoch !== this.epoch)
      return json(
        {
          code: "EPOCH_CHANGED",
          message: "復旧済み",
          diary: current,
          epoch: this.epoch,
          absenceToken: this.tokens.get(day) ?? null,
        },
        409,
      );
    if (this.receipts.has(request.mutationId)) {
      return json({
        diary: current,
        epoch: this.epoch,
        absenceToken: this.tokens.get(day) ?? null,
        mutationId: request.mutationId,
        appliedVersion: this.receipts.get(request.mutationId)!.version,
        appliedDiaryId: this.receipts.get(request.mutationId)!.id,
        replayed: true,
      } satisfies MutationResponse);
    }
    if (
      (request.kind === "create" &&
        (current || request.absenceToken !== (this.tokens.get(day) ?? null))) ||
      (request.kind !== "create" &&
        (!current || current.id !== request.id || current.version !== request.expectedVersion))
    ) {
      return json(
        {
          code: "CONFLICT",
          message: "別の端末で更新済み",
          diary: current,
          epoch: this.epoch,
          absenceToken: this.tokens.get(day) ?? null,
        },
        409,
      );
    }
    let saved: Diary | null = null;
    if (request.kind === "purge") this.diaries.delete(day);
    else {
      saved = {
        ...(current ?? diary("", 0, day)),
        version: (current?.version ?? 0) + 1,
        body: request.body ?? current?.body ?? "",
        deletedAt:
          request.kind === "trash"
            ? "2026-10-18T01:00:00.000Z"
            : request.kind === "restore"
              ? null
              : (current?.deletedAt ?? null),
      };
      this.diaries.set(day, saved);
    }
    const appliedId = saved?.id ?? current!.id;
    this.receipts.set(request.mutationId, { version: saved?.version ?? null, id: appliedId });
    this.tokens.set(day, request.mutationId);
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new TypeError("response lost");
    }
    return json({
      diary: saved,
      epoch: this.epoch,
      absenceToken: this.tokens.get(day) ?? null,
      mutationId: request.mutationId,
      appliedVersion: saved?.version ?? null,
      appliedDiaryId: appliedId,
      replayed: false,
    } satisfies MutationResponse);
  };
}

afterEach(() => {
  for (const value of engines.splice(0)) value.stop();
  for (const value of databases.splice(0)) value.close();
});

describe("durable draft repository", () => {
  it("commits before resolving and atomically rejects a stale revision from another tab", async () => {
    const factory = new IDBFactory();
    const a = repository(factory, "shared");
    const b = repository(factory, "shared");
    await a.change(date, () => ({ ...emptyDraft(date), body: "端末A", revision: 1, dirty: true }));
    expect((await b.get(date))?.body).toBe("端末A");
    await expect(
      b.change(date, (current) => {
        if (current?.revision !== 0) throw new DraftRevisionConflict(current);
        return { ...current!, body: "古い画面" };
      }),
    ).rejects.toBeInstanceOf(DraftRevisionConflict);
    expect((await a.get(date))?.body).toBe("端末A");
  });

  it("serializes quick edits and keeps oversized UTF-8 text locally without sending it", async () => {
    const repo = repository();
    const server = new FakeServer();
    const app = engine(repo, server);
    await app.start();
    await app.open(date);
    const writes = [
      app.edit(date, "一"),
      app.edit(date, "一二"),
      app.edit(date, "あ".repeat(333_334)),
    ];
    await Promise.all(writes);
    await app.retry(date);
    expect((await repo.get(date))?.body).toHaveLength(333_334);
    expect((await repo.get(date))?.revision).toBe(3);
    expect(app.getStatus(date)).toBe("error");
    expect(server.requests).toHaveLength(0);
  });

  it("blocks a stale editor without replacing the other tab’s durable text", async () => {
    const factory = new IDBFactory();
    const repoA = repository(factory, "tabs");
    const repoB = repository(factory, "tabs");
    const server = new FakeServer();
    server.diaries.set(date, diary("base"));
    const a = engine(repoA, server);
    const b = engine(repoB, server);
    await a.start();
    await b.start();
    await a.open(date);
    await b.open(date);
    await a.edit(date, "new tab A");
    await expect(b.edit(date, "old tab B")).rejects.toBeInstanceOf(DraftRevisionConflict);
    expect((await repoA.get(date))?.body).toBe("new tab A");
    expect(b.getDraft(date)?.body).toBe("old tab B");
    await expect(b.flushLocal(date)).rejects.toThrow("端末内保存");
  });
});

describe("sync without losing local changes", () => {
  it("does not create on open or after clearing a new draft, but retains an existing empty diary", async () => {
    const repo = repository();
    const server = new FakeServer();
    const app = engine(repo, server);
    await app.start();
    await app.open(date);
    await app.retry(date);
    expect(server.requests).toHaveLength(0);
    await app.edit(date, "new");
    await app.edit(date, "");
    await app.retry(date);
    expect(server.requests).toHaveLength(0);
    server.diaries.set(date, diary("saved"));
    await app.open(date);
    await app.edit(date, "");
    await app.retry(date);
    expect(server.requests).toHaveLength(1);
    expect(server.diaries.get(date)?.body).toBe("");
    expect(app.getStatus(date)).toBe("saved");
  });

  it("reuses a persisted mutation after a lost response and a browser restart", async () => {
    let now = 100_000;
    const repo = repository();
    const server = new FakeServer();
    const first = engine(repo, server, () => now);
    await first.start();
    await first.open(date);
    await first.edit(date, "original");
    server.loseResponse = true;
    await first.retry(date);
    const operationId = (await repo.get(date))?.pending?.mutationId;
    expect(operationId).toBeTruthy();
    expect(server.diaries.get(date)?.version).toBe(1);
    first.stop();
    const next = engine(repo, server, () => now);
    await next.start();
    await next.edit(date, "newer local");
    now += 1000;
    await next.retry(date);
    expect(server.requests[1]?.mutationId).toBe(operationId);
    expect(next.getDraft(date)?.body).toBe("newer local");
    await next.retry(date);
    expect(server.diaries.get(date)?.body).toBe("newer local");
    expect(server.diaries.get(date)?.version).toBe(2);
    expect(next.getStatus(date)).toBe("saved");
  });

  it("applies independently completed dates to the correct draft", async () => {
    const repo = repository();
    const server = new FakeServer();
    const app = engine(repo, server);
    await app.start();
    await Promise.all([app.open(date), app.open(otherDate)]);
    await Promise.all([app.edit(date, "today"), app.edit(otherDate, "yesterday")]);
    let release!: () => void;
    server.beforePost = (day) =>
      day === date
        ? new Promise<void>((resolve) => {
            release = resolve;
          })
        : Promise.resolve();
    const syncing = app.retry();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    while (app.getStatus(otherDate) !== "saved")
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.getDraft(otherDate)?.diary?.body).toBe("yesterday");
    expect(app.getDraft(date)?.body).toBe("today");
    release();
    await syncing;
    expect(app.getDraft(date)?.diary?.body).toBe("today");
  });

  it("does not mark a newer local edit saved when an earlier request completes", async () => {
    const repo = repository();
    const server = new FakeServer();
    const app = engine(repo, server);
    await app.start();
    await app.open(date);
    await app.edit(date, "first");
    let release!: () => void;
    server.beforePost = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const syncing = app.retry(date);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    await app.edit(date, "second");
    release();
    await syncing;
    expect(app.getDraft(date)?.body).toBe("second");
    expect(app.getDraft(date)?.diary?.body).toBe("first");
    expect(app.getStatus(date)).not.toBe("saved");
  });

  it("preserves both versions on conflict and rechecks server version during resolution", async () => {
    const repo = repository();
    const server = new FakeServer();
    server.diaries.set(date, diary("base"));
    const app = engine(repo, server);
    await app.start();
    await app.open(date);
    await app.edit(date, "local");
    server.diaries.set(date, diary("server", 2));
    await app.retry(date);
    expect(app.getStatus(date)).toBe("conflict");
    expect(app.getDraft(date)?.body).toBe("local");
    expect(app.getDraft(date)?.problem?.server?.body).toBe("server");
    server.diaries.set(date, diary("server changed again", 3));
    await expect(app.resolve(date, "local")).rejects.toThrow("再び更新");
    expect(app.getDraft(date)?.body).toBe("local");
    await app.resolve(date, "merge", "merged");
    await app.retry(date);
    expect(server.diaries.get(date)?.body).toBe("merged");
  });

  it("acknowledges an ambiguous save but stops if another device has already advanced it", async () => {
    let now = 100_000;
    const repo = repository();
    const server = new FakeServer();
    const app = engine(repo, server, () => now);
    await app.start();
    await app.open(date);
    await app.edit(date, "local");
    server.loseResponse = true;
    await app.retry(date);
    server.diaries.set(date, diary("other device", 2));
    now += 1000;
    await app.retry(date);
    expect(app.getStatus(date)).toBe("conflict");
    expect(app.getDraft(date)?.body).toBe("local");
    expect(app.getDraft(date)?.problem?.server?.body).toBe("other device");
    expect(app.getDraft(date)?.pending).toBeNull();
  });

  it("detects a recreated diary even if its version matches the old receipt", async () => {
    let now = 100_000;
    const repo = repository();
    const server = new FakeServer();
    const app = engine(repo, server, () => now);
    await app.start();
    await app.open(date);
    await app.edit(date, "original diary");
    server.loseResponse = true;
    await app.retry(date);
    server.diaries.set(date, { ...diary("recreated diary", 1), id: "new-id" });
    now += 1000;
    await app.retry(date);
    expect(app.getStatus(date)).toBe("conflict");
    expect(app.getDraft(date)?.body).toBe("original diary");
    expect(app.getDraft(date)?.problem?.server?.id).toBe("new-id");
  });

  it("does not send an unsent old create after another device creates and purges the date", async () => {
    const repo = repository();
    const server = new FakeServer();
    const app = engine(repo, server);
    await app.start();
    await app.open(date);
    await app.edit(date, "unsent old draft");
    server.tokens.set(date, "created-and-purged-on-another-device");
    await app.retry(date);
    expect(server.requests[0]?.absenceToken).toBeNull();
    expect(app.getStatus(date)).toBe("conflict");
    expect(server.diaries.has(date)).toBe(false);
    await app.open(date);
    expect(app.getDraft(date)?.absenceToken).toBeNull();
    expect(app.getDraft(date)?.body).toBe("unsent old draft");
    await app.resolve(date, "local");
    await app.retry(date);
    expect(server.requests.at(-1)?.absenceToken).toBe("created-and-purged-on-another-device");
    expect(server.diaries.get(date)?.body).toBe("unsent old draft");
  });

  it("detects an absent-date generation change on reopening before making any request", async () => {
    const repo = repository();
    const server = new FakeServer();
    const app = engine(repo, server);
    await app.start();
    await app.open(date);
    await app.edit(date, "old local");
    server.tokens.set(date, "purged-generation");
    await app.open(date);
    expect(app.getStatus(date)).toBe("conflict");
    expect(server.requests).toHaveLength(0);
    expect(app.getDraft(date)?.absenceToken).toBeNull();
  });

  it("requires confirmation for an offline unobserved draft whose date has deletion history", async () => {
    const repo = repository();
    const server = new FakeServer();
    const app = engine(repo, server);
    await app.start();
    await app.edit(date, "created before first successful server read");
    server.tokens.set(date, "other-device-purged");
    await app.retry(date);
    expect(app.getStatus(date)).toBe("conflict");
    expect(server.requests).toHaveLength(0);
    expect(app.getDraft(date)?.body).toBe("created before first successful server read");
  });

  it("requires a deliberate recovery decision after a database epoch change", async () => {
    const repo = repository();
    const server = new FakeServer();
    server.diaries.set(date, diary("before"));
    const app = engine(repo, server);
    await app.start();
    await app.open(date);
    await app.edit(date, "unsynced");
    server.epoch = "restored-epoch";
    await app.retry(date);
    expect(app.getDraft(date)?.problem?.kind).toBe("recovery");
    expect(app.getDraft(date)?.body).toBe("unsynced");
    await app.resolve(date, "local");
    await app.retry(date);
    expect(server.diaries.get(date)?.body).toBe("unsynced");
  });

  it("pauses authentication failures and retains draft until an authenticated manual retry", async () => {
    const repo = repository();
    const server = new FakeServer();
    const app = engine(repo, server);
    await app.start();
    await app.open(date);
    await app.edit(date, "keep me");
    server.auth = true;
    await app.retry(date);
    expect(app.getStatus(date)).toBe("auth");
    expect((await repo.get(date))?.body).toBe("keep me");
    server.auth = false;
    await app.retry(date);
    expect(app.getStatus(date)).toBe("saved");
  });

  it("respects Retry-After even on manual retry", async () => {
    let now = 100_000;
    const repo = repository();
    const server = new FakeServer();
    const app = engine(repo, server, () => now);
    await app.start();
    await app.open(date);
    await app.edit(date, "keep me");
    server.failure = json({ code: "RATE_LIMIT", message: "wait" }, 429, { "Retry-After": "60" });
    await app.retry(date);
    expect(app.getDraft(date)?.retryAt).toBe(now + 60_000);
    server.failure = null;
    await app.retry(date);
    expect(server.requests).toHaveLength(1);
    now += 60_000;
    await app.retry(date);
    expect(app.getStatus(date)).toBe("saved");
  });

  it("immediately retries a deliberate read after a network failure without changing the diary", async () => {
    const repo = repository();
    const server = new FakeServer();
    server.diaries.set(date, diary("saved text"));
    let unavailable = true;
    const app = new DiarySyncEngine({
      repository: repo,
      browserEvents: false,
      now: () => 100_000,
      fetcher: async (input, init) => {
        if (unavailable) throw new TypeError("Failed to fetch");
        return server.fetch(input, init);
      },
    });
    engines.push(app);
    await app.start();
    await app.open(date);
    expect(app.getDraft(date)?.retryAt).toBeGreaterThan(100_000);
    unavailable = false;
    await app.retry(date);
    expect(app.getDraft(date)?.body).toBe("saved text");
    expect(app.getDraft(date)?.problem).toBeNull();
    expect(server.diaries.get(date)?.version).toBe(1);
    expect(server.requests).toHaveLength(0);
  });

  it("still honors the server Retry-After for a deliberate read retry", async () => {
    const repo = repository();
    const server = new FakeServer();
    server.diaries.set(date, diary("saved text"));
    let now = 100_000;
    let unavailable = true;
    let requests = 0;
    const app = new DiarySyncEngine({
      repository: repo,
      browserEvents: false,
      now: () => now,
      fetcher: async (input, init) => {
        requests++;
        return unavailable
          ? json({ code: "RATE_LIMITED", message: "wait" }, 429, { "Retry-After": "60" })
          : server.fetch(input, init);
      },
    });
    engines.push(app);
    await app.start();
    await app.open(date);
    unavailable = false;
    await app.retry(date);
    expect(requests).toBe(1);
    expect(app.getDraft(date)?.problem?.kind).toBe("network");
    now += 60_000;
    await app.retry(date);
    expect(requests).toBe(2);
    expect(app.getDraft(date)?.body).toBe("saved text");
    expect(app.getDraft(date)?.problem).toBeNull();
    expect(server.diaries.get(date)?.version).toBe(1);
  });

  it("never recreates a purged diary through a stale update", async () => {
    const repo = repository();
    const server = new FakeServer();
    server.diaries.set(date, diary("saved"));
    const app = engine(repo, server);
    await app.start();
    await app.open(date);
    await app.mutate(date, "trash");
    await app.mutate(date, "purge");
    expect(server.diaries.has(date)).toBe(false);
    await app.edit(date, "stale editor");
    await app.retry(date);
    expect(app.getStatus(date)).toBe("conflict");
    expect(server.requests.filter((request) => request.kind === "create")).toHaveLength(0);
  });

  it("holds local content and blocks navigation if IndexedDB cannot commit", async () => {
    const repo = repository();
    const server = new FakeServer();
    const app = engine(repo, server);
    await app.start();
    await app.open(date);
    const original = repo.change.bind(repo);
    repo.change = async () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    await expect(app.edit(date, "unsaved but visible")).rejects.toThrow();
    expect(app.getDraft(date)?.body).toBe("unsaved but visible");
    await expect(app.flushLocal()).rejects.toThrow("端末内保存");
    repo.change = original;
    await app.retry(date);
    expect(app.getStatus(date)).toBe("saved");
  });

  it("allows server text and a scratch editor when IndexedDB is unavailable at startup", async () => {
    const repo = repository();
    const server = new FakeServer();
    server.diaries.set(date, diary("server text"));
    const failure = async () => {
      throw new DOMException("storage unavailable", "UnknownError");
    };
    repo.list = failure;
    repo.get = failure;
    repo.change = failure;
    const app = engine(repo, server);
    await app.start();
    expect((await app.open(date)).body).toBe("server text");
    expect(app.getStatus(date)).toBe("error");
    await expect(app.edit(date, "scratch text")).rejects.toThrow();
    expect(app.getDraft(date)?.body).toBe("scratch text");
    await expect(app.flushLocal(date)).rejects.toThrow("端末内保存");
  });

  it("does not replace uncommitted memory text when authentication restarts the engine", async () => {
    const repo = repository();
    const server = new FakeServer();
    server.diaries.set(date, diary("server"));
    const app = engine(repo, server);
    await app.start();
    await app.open(date);
    const original = repo.change.bind(repo);
    repo.change = async () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    await expect(app.edit(date, "memory only")).rejects.toThrow();
    app.stop();
    await app.start();
    expect(app.getDraft(date)?.body).toBe("memory only");
    repo.change = original;
    await app.retry(date);
    expect(server.diaries.get(date)?.body).toBe("memory only");
  });

  it("refreshes a clean cached diary after an initial read failure", async () => {
    const repo = repository();
    const server = new FakeServer();
    server.diaries.set(date, diary("old"));
    const app = engine(repo, server);
    await app.start();
    await app.open(date);
    server.auth = true;
    await app.open(date);
    expect(app.getStatus(date)).toBe("auth");
    server.auth = false;
    server.diaries.set(date, diary("new", 2));
    await app.retry(date);
    expect(app.getDraft(date)?.body).toBe("new");
    expect(app.getStatus(date)).toBe("saved");
  });
});

describe("Retry-After parsing", () => {
  it("supports seconds and dates, and ignores invalid values", () => {
    expect(retryAfterMilliseconds("10", 0)).toBe(10_000);
    expect(retryAfterMilliseconds("Thu, 01 Jan 1970 00:01:00 GMT", 30_000)).toBe(30_000);
    expect(retryAfterMilliseconds("invalid", 0)).toBe(0);
  });
});
