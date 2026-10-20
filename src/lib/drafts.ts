import type { Diary } from "./types";

export type MutationKind = "create" | "update" | "trash" | "restore" | "purge";
export type DraftProblemKind =
  | "auth"
  | "conflict"
  | "validation"
  | "recovery"
  | "network"
  | "storage";

export interface DraftProblem {
  kind: DraftProblemKind;
  message: string;
  server?: Diary | null;
  epoch?: string;
  absenceToken?: string | null;
}

/** The exact request is durable before transmission, including after an ambiguous failure. */
export interface PendingMutation {
  mutationId: string;
  kind: MutationKind;
  id: string | null;
  expectedVersion: number | null;
  body?: string;
  epoch: string;
  absenceToken?: string | null;
  revision: number;
}

export interface Draft {
  date: string;
  body: string;
  /** Changes only when the local text changes, so stale tabs cannot replace newer text. */
  revision: number;
  diary: Diary | null;
  epoch: string | null;
  absenceToken: string | null;
  dirty: boolean;
  pending: PendingMutation | null;
  problem: DraftProblem | null;
  unsyncedSince: string | null;
  updatedAt: string;
  lastSyncedAt: string | null;
  /** A purged diary is never silently converted into a new diary by an old editor. */
  tombstone?: boolean;
  retryAt?: number;
  retryAfterUntil?: number;
  retryCount?: number;
  lease?: { owner: string; until: number };
}

export class DraftRevisionConflict extends Error {
  readonly name = "DraftRevisionConflict";
  constructor(readonly current: Draft | null) {
    super("別の画面で本文が更新されました。この画面の本文をコピーしてから再読み込みしてください。");
  }
}

export function emptyDraft(date: string, now = new Date().toISOString()): Draft {
  return {
    date,
    body: "",
    revision: 0,
    diary: null,
    epoch: null,
    absenceToken: null,
    dirty: false,
    pending: null,
    problem: null,
    unsyncedSince: null,
    updatedAt: now,
    lastSyncedAt: null,
  };
}

export interface DraftRepositoryLike {
  get(date: string): Promise<Draft | null>;
  list(): Promise<Draft[]>;
  change(date: string, change: (current: Draft | null) => Draft | null): Promise<Draft | null>;
  close(): void;
}

/** Each change is one IndexedDB read/write transaction; no read/await/write races. */
export class DraftRepository implements DraftRepositoryLike {
  private database: Promise<IDBDatabase> | null = null;
  constructor(
    readonly name = "kiroku-drafts-v1",
    private readonly factory: IDBFactory = globalThis.indexedDB,
  ) {}

  private db(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        if (!this.factory) {
          reject(
            new Error(
              "このブラウザでは端末内保存を利用できません。本文をコピーして退避してください。",
            ),
          );
          return;
        }
        const request = this.factory.open(this.name, 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("drafts", { keyPath: "date" });
        request.onerror = () =>
          reject(request.error ?? new Error("端末内保存を開けませんでした。"));
        request.onblocked = () =>
          reject(
            new Error("別の画面が端末内保存を使用中です。ほかの画面を閉じて再試行してください。"),
          );
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => {
            database.close();
            this.database = null;
          };
          resolve(database);
        };
      });
      this.database.catch(() => {
        this.database = null;
      });
    }
    return this.database;
  }

  async get(date: string): Promise<Draft | null> {
    const database = await this.db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", "readonly");
      const request = transaction.objectStore("drafts").get(date);
      request.onsuccess = () => resolve((request.result as Draft | undefined) ?? null);
      request.onerror = () => reject(request.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("端末内保存の読み込みに失敗しました。"));
    });
  }

  async list(): Promise<Draft[]> {
    const database = await this.db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", "readonly");
      const request = transaction.objectStore("drafts").getAll();
      request.onsuccess = () => resolve(request.result as Draft[]);
      request.onerror = () => reject(request.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("端末内保存の読み込みに失敗しました。"));
    });
  }

  async change(
    date: string,
    change: (current: Draft | null) => Draft | null,
  ): Promise<Draft | null> {
    const database = await this.db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite", { durability: "strict" });
      const store = transaction.objectStore("drafts");
      const request = store.get(date);
      let result: Draft | null = null;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          result = change((request.result as Draft | undefined) ?? null);
          if (result) store.put(result);
          else store.delete(date);
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () =>
        reject(failure ?? transaction.error ?? new Error("端末内保存に失敗しました。"));
      transaction.onabort = () =>
        reject(failure ?? transaction.error ?? new Error("端末内保存に失敗しました。"));
    });
  }

  close(): void {
    void this.database?.then(
      (database) => database.close(),
      () => {},
    );
    this.database = null;
  }
}

export function createDraftRepository(name?: string): DraftRepository {
  return new DraftRepository(name);
}
