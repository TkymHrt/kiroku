import { readFileSync, readdirSync } from "node:fs";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Diary, MutationRequest } from "../src/lib/types";
import {
  getExportPage,
  getDiary,
  getDiaryState,
  getEpoch,
  getNeighbors,
  listDiaries,
  mutateDiary,
} from "./diaries";
import { validateDate, validateMutation } from "./validation";

describe("D1 diary persistence and durable mutations", () => {
  let runtime: Miniflare;
  let db: D1Database;
  let epoch: string;
  const date = "2026-10-18";

  beforeAll(async () => {
    runtime = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("test"); } }',
      compatibilityDate: "2026-02-24",
      d1Databases: { DB: "diary-tests" },
    });
    db = (await runtime.getD1Database("DB")) as unknown as D1Database;
    const directory = new URL("../db/migrations/", import.meta.url);
    for (const name of readdirSync(directory)
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      const sql = readFileSync(new URL(name, directory), "utf8");
      for (const statement of sql.split(";").filter((part) => part.trim()))
        await db.prepare(statement).run();
    }
  }, 30_000);
  afterAll(async () => {
    await runtime?.dispose();
  });
  beforeEach(async () => {
    epoch = crypto.randomUUID();
    await db.batch([
      db.prepare("DELETE FROM diaries"),
      db.prepare("DELETE FROM mutation_receipts"),
      db.prepare("UPDATE app_meta SET value = ? WHERE key = 'database_epoch'").bind(epoch),
    ]);
  });

  function create(body = "今日の記録", absenceToken: string | null = null): MutationRequest {
    return {
      mutationId: crypto.randomUUID(),
      kind: "create",
      id: null,
      expectedVersion: null,
      body,
      epoch,
      absenceToken,
    };
  }
  function edit(
    diary: Diary,
    kind: MutationRequest["kind"] = "update",
    body = "新しい本文",
  ): MutationRequest {
    return {
      mutationId: crypto.randomUUID(),
      kind,
      id: diary.id,
      expectedVersion: diary.version,
      epoch,
      ...(kind === "update" ? { body } : {}),
    };
  }

  it("does not create a record merely by reading a date", async () => {
    expect(await getDiary(db, date)).toBeNull();
    expect((await listDiaries(db)).items).toEqual([]);
  });

  it("acknowledges an identical lost-response retry without incrementing the version", async () => {
    const request = create();
    const first = await mutateDiary(db, date, request);
    const retry = await mutateDiary(db, date, request);
    expect(first.diary?.version).toBe(1);
    expect(retry.diary).toEqual(first.diary);
    expect(retry.replayed).toBe(true);
    expect(retry.appliedVersion).toBe(1);
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM mutation_receipts").first<{ n: number }>())?.n,
    ).toBe(1);
  });

  it("rejects reuse of a mutation ID with a changed payload", async () => {
    const request = create();
    await mutateDiary(db, date, request);
    await expect(mutateDiary(db, date, { ...request, body: "別の本文" })).rejects.toMatchObject({
      status: 409,
      code: "MUTATION_ID_REUSED",
    });
    expect((await getDiary(db, date))?.body).toBe(request.body);
  });

  it("allows exactly one of two racing writes based on the same version", async () => {
    const diary = (await mutateDiary(db, date, create())).diary!;
    const results = await Promise.allSettled([
      mutateDiary(db, date, edit(diary, "update", "端末 A")),
      mutateDiary(db, date, edit(diary, "update", "端末 B")),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await getDiary(db, date))?.version).toBe(2);
  });

  it("keeps a saved diary when its body becomes empty and rejects a new empty diary", async () => {
    const diary = (await mutateDiary(db, date, create())).diary!;
    const result = await mutateDiary(db, date, edit(diary, "update", ""));
    expect(result.diary?.body).toBe("");
    expect(result.diary?.id).toBe(diary.id);
    await expect(mutateDiary(db, "2026-10-19", create(""))).rejects.toMatchObject({ status: 400 });
  });

  it("detects a trash/update race, requires the latest version to restore, and lists trash separately", async () => {
    const diary = (await mutateDiary(db, date, create())).diary!;
    const trashed = (await mutateDiary(db, date, edit(diary, "trash"))).diary!;
    await expect(mutateDiary(db, date, edit(diary))).rejects.toMatchObject({ status: 409 });
    await expect(mutateDiary(db, date, edit(diary, "restore"))).rejects.toMatchObject({
      status: 409,
    });
    await expect(mutateDiary(db, date, create())).rejects.toMatchObject({ status: 409 });
    expect((await listDiaries(db)).items).toHaveLength(0);
    expect((await listDiaries(db, { trash: true })).items[0].date).toBe(date);
    const restored = (await mutateDiary(db, date, edit(trashed, "restore"))).diary!;
    expect(restored.deletedAt).toBeNull();
    expect(restored.body).toBe(diary.body);
  });

  it("never resurrects a purged diary when an old create/update/purge is replayed", async () => {
    const initial = create();
    const diary = (await mutateDiary(db, date, initial)).diary!;
    const update = edit(diary);
    const updated = (await mutateDiary(db, date, update)).diary!;
    const trash = (await mutateDiary(db, date, edit(updated, "trash"))).diary!;
    const purge = edit(trash, "purge");
    await mutateDiary(db, date, purge);
    for (const oldRequest of [initial, update, purge]) {
      const retry = await mutateDiary(db, date, oldRequest);
      expect(retry.diary).toBeNull();
      expect(retry.replayed).toBe(true);
      expect(await getDiary(db, date)).toBeNull();
    }
    await expect(mutateDiary(db, date, edit(diary))).rejects.toMatchObject({ status: 409 });
    const absence = await getDiaryState(db, date);
    const replacement = (
      await mutateDiary(db, date, create("作り直した日記", absence.absenceToken))
    ).diary!;
    expect(replacement.id).not.toBe(diary.id);
    const oldCreateRetry = await mutateDiary(db, date, initial);
    expect(oldCreateRetry.appliedDiaryId).toBe(diary.id);
    expect(oldCreateRetry.diary?.id).toBe(replacement.id);
    expect(oldCreateRetry.appliedVersion).toBe(1);
    expect(oldCreateRetry.diary?.version).toBe(1);
    await expect(mutateDiary(db, date, edit(diary))).rejects.toMatchObject({ status: 409 });
    expect((await getDiary(db, date))?.body).toBe("作り直した日記");
  });

  it("reports the original applied version when a retry finds newer server content", async () => {
    const initial = create();
    const diary = (await mutateDiary(db, date, initial)).diary!;
    await mutateDiary(db, date, edit(diary));
    const retry = await mutateDiary(db, date, initial);
    expect(retry.appliedVersion).toBe(1);
    expect(retry.diary?.version).toBe(2);
    expect(retry.diary?.body).toBe("新しい本文");
  });

  it("rejects a never-sent create from before another device created and purged the date", async () => {
    const unsent = create("オフライン端末の古い下書き");
    expect((await getDiaryState(db, date)).absenceToken).toBeNull();
    const diary = (await mutateDiary(db, date, create("別端末"))).diary!;
    const trashed = (await mutateDiary(db, date, edit(diary, "trash"))).diary!;
    const purged = await mutateDiary(db, date, edit(trashed, "purge"));
    expect(purged.absenceToken).not.toBeNull();
    await expect(mutateDiary(db, date, unsent)).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      diary: null,
      absenceToken: purged.absenceToken,
    });
    expect(await getDiary(db, date)).toBeNull();
    const reopened = await getDiaryState(db, date);
    expect(
      (await mutateDiary(db, date, create("確認して新しく作成", reopened.absenceToken))).diary
        ?.body,
    ).toBe("確認して新しく作成");
  });

  it("accepts exactly 1,000,000 UTF-8 bytes and refuses an extra byte without truncation", async () => {
    const body = "日".repeat(333_333) + "a";
    expect(new TextEncoder().encode(body).byteLength).toBe(1_000_000);
    const diary = (await mutateDiary(db, date, create(body))).diary!;
    expect((await getDiary(db, date))?.body).toBe(body);
    await expect(mutateDiary(db, date, edit(diary, "update", body + "a"))).rejects.toMatchObject({
      status: 413,
    });
    expect((await getDiary(db, date))?.body).toBe(body);
  });

  it("blocks pending writes after a database restoration changes its epoch", async () => {
    const request = create();
    await db
      .prepare("UPDATE app_meta SET value = ? WHERE key = 'database_epoch'")
      .bind(crypto.randomUUID())
      .run();
    await expect(mutateDiary(db, date, request)).rejects.toMatchObject({
      code: "EPOCH_CHANGED",
      status: 409,
    });
    expect(await getDiary(db, date)).toBeNull();
  });

  it("paginates summaries without bodies and skips missing dates in navigation", async () => {
    for (const day of ["2026-10-13", "2026-10-15", date]) await mutateDiary(db, day, create());
    const first = await listDiaries(db, { limit: 2 });
    expect(first.items.map((item) => item.date)).toEqual([date, "2026-10-15"]);
    expect(first.items[0]).not.toHaveProperty("body");
    expect((await listDiaries(db, { before: first.nextCursor! })).items[0].date).toBe("2026-10-13");
    expect(await getNeighbors(db, "2026-10-15")).toEqual({ previous: "2026-10-13", next: date });
  });

  it("exports saved and trashed diaries with their bodies and no receipts", async () => {
    const diary = (await mutateDiary(db, date, create())).diary!;
    await mutateDiary(db, date, edit(diary, "trash"));
    const result = await getExportPage(db);
    expect(result.formatVersion).toBe(2);
    expect(result.diaries).toHaveLength(1);
    expect(result.diaries[0].body).toBe(diary.body);
    expect(result.diaries[0].deletedAt).not.toBeNull();
    expect(result).not.toHaveProperty("mutation_receipts");
    expect(await getEpoch(db)).toBe(epoch);
  });

  it("rejects export continuation when another operation changes the snapshot", async () => {
    for (const day of ["2026-10-13", "2026-10-15", date, "2026-10-20"])
      await mutateDiary(db, day, create());
    const first = await getExportPage(db);
    expect(first.diaries).toHaveLength(3);
    const second = await getExportPage(db, first.nextCursor!, first.snapshotToken);
    expect(second.diaries).toHaveLength(1);
    const diary = (await getDiary(db, date))!;
    await mutateDiary(db, date, edit(diary));
    await expect(getExportPage(db, first.nextCursor!, first.snapshotToken)).rejects.toMatchObject({
      code: "EXPORT_CHANGED",
      status: 409,
    });
  });
});

describe("request validation", () => {
  it("rejects invalid calendar dates and input types", () => {
    for (const date of ["2026-02-29", "2026-13-01", "0000-01-01", "../../secret"])
      expect(() => validateDate(date)).toThrow();
    expect(validateDate("2024-02-29")).toBe("2024-02-29");
    expect(() => validateMutation({ kind: "update", body: 0 })).toThrow();
  });
});
