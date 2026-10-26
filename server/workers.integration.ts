/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MutationRequest } from "../src/lib/types";
import { getDiary, getDiaryState, getEpoch, mutateDiary } from "./diaries";
import { authenticate } from "./security";
import { getMcpDiary, saveSummary } from "./mcp-service";

const bindings = env as unknown as { DB: D1Database; TEST_MIGRATIONS: D1Migration[] };

describe("official Cloudflare Workers runtime integration", () => {
  let epoch: string;
  beforeAll(async () => {
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    epoch = crypto.randomUUID();
    await bindings.DB.batch([
      bindings.DB.prepare("DELETE FROM diaries"),
      bindings.DB.prepare("DELETE FROM mutation_receipts"),
      bindings.DB.prepare("UPDATE app_meta SET value = ? WHERE key = 'database_epoch'").bind(epoch),
    ]);
  });

  const create = (body = "Workers 内の日記"): MutationRequest => ({
    kind: "create",
    mutationId: crypto.randomUUID(),
    id: null,
    expectedVersion: null,
    body,
    epoch,
    absenceToken: null,
  });

  it("uses the primary session and deduplicates a successfully applied mutation", async () => {
    const db = bindings.DB.withSession("first-primary");
    const request = create();
    const first = await mutateDiary(db, "2026-10-18", request);
    const retry = await mutateDiary(db, "2026-10-18", request);
    expect(retry.replayed).toBe(true);
    expect(retry.diary?.version).toBe(1);
    expect(retry.appliedDiaryId).toBe(first.diary?.id);
    expect(await getEpoch(db)).toBe(epoch);
  });

  it("blocks an unsent stale create after another client permanently deletes the date", async () => {
    const db = bindings.DB.withSession("first-primary");
    const stale = create("古い端末の本文");
    const first = (await mutateDiary(db, "2026-10-18", create())).diary!;
    const trash = (
      await mutateDiary(db, "2026-10-18", {
        mutationId: crypto.randomUUID(),
        kind: "trash",
        id: first.id,
        expectedVersion: first.version,
        epoch,
      })
    ).diary!;
    await mutateDiary(db, "2026-10-18", {
      mutationId: crypto.randomUUID(),
      kind: "purge",
      id: trash.id,
      expectedVersion: trash.version,
      epoch,
    });
    await expect(mutateDiary(db, "2026-10-18", stale)).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
    expect(await getDiary(db, "2026-10-18")).toBeNull();
    expect((await getDiaryState(db, "2026-10-18")).absenceToken).not.toBeNull();
  });

  it("stores a 1,000,000-byte body unchanged inside the actual Workers runtime", async () => {
    const body = "日".repeat(333_333) + "a";
    await mutateDiary(bindings.DB, "2026-10-18", create(body));
    expect((await getDiary(bindings.DB, "2026-10-18"))?.body).toBe(body);
  });

  it("fails closed without production Access configuration, even on localhost", async () => {
    await expect(
      authenticate(new Request("http://localhost/api/session"), {}, false),
    ).rejects.toMatchObject({ status: 503, code: "AUTH_NOT_CONFIGURED" });
    await expect(
      authenticate(
        new Request("https://diary.example/api/session"),
        {
          ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
          ACCESS_AUD: "audience",
          ACCESS_EMAIL: "owner@example.com",
        },
        false,
      ),
    ).rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
  });

  it("saves and replays a summary atomically without changing the source diary", async () => {
    const db = bindings.DB.withSession("first-primary");
    const day = "2026-10-18";
    const original = (await mutateDiary(db, day, create())).diary!;
    const context = { db, secret: "worker-test-only-mcp-cursor-key-32-characters" };
    const read = await getMcpDiary(context, { date: day });
    const request = {
      mutationId: crypto.randomUUID(),
      date: day,
      diaryId: read.id,
      sourceVersion: read.version,
      epoch,
      expectedRevision: read.summaryRevision,
      summary: "Workers 内の日記を保存した。",
      sourceToken: read.sourceToken,
    };
    expect((await saveSummary(context, request)).appliedRevision).toBe(1);
    expect((await saveSummary(context, request)).replayed).toBe(true);
    expect(await getDiary(db, day)).toEqual(original);
    expect((await getMcpDiary(context, { date: day })).summaryStatus).toBe("current");
  });

  it("preserves multibyte and embedded NUL bytes across signed chunks", async () => {
    const day = "2026-10-18";
    const body = "a".repeat(11999) + "🍵\u0000日本語";
    await mutateDiary(bindings.DB, day, create(body));
    const context = {
      db: bindings.DB.withSession("first-primary"),
      secret: "worker-test-only-mcp-cursor-key-32-characters",
    };
    const first = await getMcpDiary(context, { date: day });
    expect(first.sourceToken).toBeNull();
    const last = await getMcpDiary(context, { date: day, cursor: first.nextCursor });
    expect(first.body + last.body).toBe(body);
    expect(last.complete).toBe(true);
  });
});
