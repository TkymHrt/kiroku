import { readFileSync, readdirSync } from "node:fs";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Diary, MutationRequest } from "../src/lib/types";
import { getDiary, getExportPage, mutateDiary } from "./diaries";
import { handleMcp } from "./mcp";
import {
  chargeMcp,
  getMcpDiary,
  listMcpDiaries,
  listPendingSummaries,
  MCP_LIMITS,
  saveSummary,
  searchMcpDiaries,
  type McpContext,
  type SaveSummaryInput,
} from "./mcp-service";

describe("MCP and independent summary persistence on D1", () => {
  let runtime: Miniflare;
  let db: D1Database;
  let context: McpContext;
  let epoch: string;
  const date = "2026-10-19";
  beforeAll(async () => {
    runtime = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("test"); } }',
      compatibilityDate: "2026-02-24",
      d1Databases: { DB: "mcp-tests" },
    });
    db = (await runtime.getD1Database("DB")) as unknown as D1Database;
    const directory = new URL("../db/migrations/", import.meta.url);
    for (const name of readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      for (const statement of readFileSync(new URL(name, directory), "utf8")
        .split(";")
        .filter((sql) => sql.trim()))
        await db.prepare(statement).run();
    }
  });
  afterAll(async () => {
    await runtime?.dispose();
  });
  beforeEach(async () => {
    epoch = crypto.randomUUID();
    await db.batch([
      db.prepare("DELETE FROM diaries"),
      db.prepare("DELETE FROM mutation_receipts"),
      db.prepare("DELETE FROM summary_mutation_receipts"),
      db.prepare("DELETE FROM mcp_daily_usage"),
      db.prepare("UPDATE app_meta SET value = ? WHERE key = 'database_epoch'").bind(epoch),
    ]);
    context = {
      db: db.withSession("first-primary"),
      secret: "mcp-test-only-secret-at-least-32-characters",
      now: new Date("2026-10-20T15:15:00Z"),
    };
  });
  async function create(body = "今日は公園で散歩。日本語の短語検索。", day = date) {
    const input: MutationRequest = {
      mutationId: crypto.randomUUID(),
      kind: "create",
      id: null,
      expectedVersion: null,
      body,
      epoch,
      absenceToken: null,
    };
    return (await mutateDiary(db, day, input)).diary!;
  }
  async function change(diary: Diary, kind: MutationRequest["kind"], body = "追記した本文") {
    return mutateDiary(db, diary.date, {
      mutationId: crypto.randomUUID(),
      kind,
      id: diary.id,
      expectedVersion: diary.version,
      epoch,
      ...(kind === "update" ? { body } : {}),
    });
  }
  async function summary(day = date): Promise<SaveSummaryInput> {
    const source = await getMcpDiary(context, { date: day });
    return {
      mutationId: crypto.randomUUID(),
      date: day,
      diaryId: source.id,
      sourceVersion: source.version,
      epoch: source.epoch,
      expectedRevision: source.summaryRevision,
      sourceToken: source.sourceToken!,
      summary: "公園で散歩した。",
    };
  }
  async function count(table: string) {
    return (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
  }
  function rpc(body: unknown, headers: HeadersInit = {}) {
    return new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("lists bounded dates without bodies, searches literal Japanese and excludes trash", async () => {
    await create();
    const deleted = await create("散歩のゴミ箱", "2026-10-18");
    await change(deleted, "trash");
    const list = await listMcpDiaries(context, { from: "2026-10-01", to: "2026-10-31", limit: 1 });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ date, summaryStatus: "missing", summaryRevision: 0 });
    expect(list.items[0]).not.toHaveProperty("body");
    expect(
      (await searchMcpDiaries(context, { query: "散歩", from: "2026-10-01", to: "2026-10-31" }))
        .items,
    ).toHaveLength(1);
    expect(
      (await searchMcpDiaries(context, { query: "%", from: "2026-10-01", to: "2026-10-31" })).items,
    ).toEqual([]);
    await expect(getMcpDiary(context, { date: deleted.date })).rejects.toMatchObject({
      code: "DIARY_NOT_FOUND",
    });
    await expect(
      searchMcpDiaries(context, { query: "a", from: "2026-01-01", to: "2026-10-31" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      listMcpDiaries(context, { from: "2026-10-01", to: "2026-10-31", limit: 21 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("has stable date cursors and rejects invalid or unknown arguments", async () => {
    await create();
    await create("前の日", "2026-10-18");
    const first = await listMcpDiaries(context, { from: "2026-10-01", to: "2026-10-31", limit: 1 });
    const second = await listMcpDiaries(context, {
      from: "2026-10-01",
      to: "2026-10-31",
      cursor: first.nextCursor!,
      limit: 1,
    });
    expect(second.items[0].date).toBe("2026-10-18");
    expect(second.nextCursor).toBeNull();
    for (const input of [
      { from: "2026-02-30", to: date },
      { from: date, to: "2026-01-01" },
      { from: date, to: date, sql: "SELECT 1" },
    ])
      await expect(listMcpDiaries(context, input)).rejects.toMatchObject({ status: 400 });
  });

  it("reads all 1,000,000 bytes with Unicode, NUL and controls without truncation", async () => {
    const prefix = "a".repeat(11999) + "🍵\u0000日本語\r\n";
    const body = prefix + "x".repeat(1_000_000 - new TextEncoder().encode(prefix).length);
    await create(body);
    let page = await getMcpDiary(context, { date });
    expect(page.complete).toBe(false);
    expect(page.sourceToken).toBeNull();
    let actual = page.body;
    let calls = 1;
    while (page.nextCursor) {
      page = await getMcpDiary(context, { date, cursor: page.nextCursor });
      actual += page.body;
      calls++;
      expect(new TextEncoder().encode(page.body).length).toBeLessThanOrEqual(MCP_LIMITS.chunkBytes);
    }
    expect(actual).toBe(body);
    expect(calls).toBeLessThanOrEqual(85);
    expect(page.complete).toBe(true);
    expect(page.sourceToken).toBeTruthy();
  });

  it("rejects tampered cursors, skipped offsets and changes during a multi-part read", async () => {
    const diary = await create("a".repeat(13000));
    const page = await getMcpDiary(context, { date });
    await expect(getMcpDiary(context, { date, offset: 12000 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      getMcpDiary(context, { date, cursor: page.nextCursor + "x" }),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    await expect(
      getMcpDiary(context, { date: "2026-10-18", cursor: page.nextCursor }),
    ).rejects.toMatchObject({ status: 400 });
    await change(diary, "update");
    await expect(getMcpDiary(context, { date, cursor: page.nextCursor })).rejects.toMatchObject({
      code: "SOURCE_CHANGED",
    });
  });

  it("requires a complete read token and preserves the source version on summary save", async () => {
    const diary = await create();
    const input = await summary();
    await expect(saveSummary(context, { ...input, sourceToken: "invalid" })).rejects.toMatchObject({
      code: "INVALID_TOKEN",
    });
    expect((await saveSummary(context, input)).appliedRevision).toBe(1);
    expect(await getDiary(db, date)).toEqual(diary);
    expect((await getMcpDiary(context, { date })).summaryStatus).toBe("current");
    expect(await count("summary_history")).toBe(1);
    expect(await count("summary_mutation_receipts")).toBe(1);
  });

  it("deduplicates concurrent identical operations and rejects changed payloads", async () => {
    await create();
    const input = await summary();
    const results = await Promise.all([saveSummary(context, input), saveSummary(context, input)]);
    expect(results.filter((item) => item.replayed)).toHaveLength(1);
    expect(await count("summary_history")).toBe(1);
    await expect(saveSummary(context, { ...input, summary: "別の要約" })).rejects.toMatchObject({
      code: "MUTATION_ID_REUSED",
    });
    const later = await summary();
    await saveSummary(context, later);
    expect((await saveSummary(context, input)).appliedRevision).toBe(1);
    expect((await getMcpDiary(context, { date })).summaryRevision).toBe(2);
  });

  it("allows only one of two concurrent revisions and keeps history", async () => {
    await create();
    const input = await summary();
    const results = await Promise.allSettled([
      saveSummary(context, input),
      saveSummary(context, {
        ...input,
        mutationId: crypto.randomUUID(),
        summary: "もう一つの要約",
      }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(await count("summary_mutation_receipts")).toBe(1);
    expect(await count("summary_history")).toBe(1);
    await expect(
      saveSummary(context, { ...input, mutationId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "SUMMARY_CONFLICT" });
  });

  it("rolls back receipt and current summary if history persistence fails", async () => {
    await create();
    const input = await summary();
    const failing: McpContext = {
      ...context,
      db: {
        prepare: (sql) =>
          db.prepare(
            sql.startsWith("INSERT INTO summary_history")
              ? sql.replace("SELECT ?, ?, ?, ?, ?, ?", "SELECT ?, ?, ?, ?, substr(?, 1, 0), ?")
              : sql,
          ),
        batch: db.batch.bind(db),
      },
    };
    await expect(saveSummary(failing, input)).rejects.toThrow();
    expect(await count("summary_mutation_receipts")).toBe(0);
    expect(await count("diary_summaries")).toBe(0);
    expect(await count("summary_history")).toBe(0);
    context.now = new Date("2026-10-21T15:15:00Z");
    expect((await listPendingSummaries(context, {})).items[0].date).toBe(date);
    await saveSummary(context, input);
    expect(await count("summary_mutation_receipts")).toBe(1);
  });

  it("rejects source changes and picks up appended diaries the next day", async () => {
    const diary = await create();
    const old = await summary();
    const updated = (await change(diary, "update")).diary!;
    await expect(saveSummary(context, old)).rejects.toMatchObject({ code: "SUMMARY_CONFLICT" });
    await saveSummary(context, await summary());
    expect((await listPendingSummaries(context, {})).items).toEqual([]);
    await change(updated, "update", "さらに追記");
    expect((await listPendingSummaries(context, {})).items[0].summaryStatus).toBe("stale");
  });

  it("rejects trash, purge and same-date recreation; purge removes summary text but retains receipts", async () => {
    const diary = await create();
    await saveSummary(context, await summary());
    const old = await summary();
    const trash = (await change(diary, "trash")).diary!;
    await expect(saveSummary(context, old)).rejects.toMatchObject({ code: "SUMMARY_CONFLICT" });
    expect((await listPendingSummaries(context, {})).items).toEqual([]);
    await change(trash, "purge");
    expect(await count("summary_history")).toBe(0);
    expect(await count("diary_summaries")).toBe(0);
    expect(await count("summary_mutation_receipts")).toBe(1);
    const absence = await db
      .prepare("SELECT mutation_id FROM mutation_receipts ORDER BY rowid DESC LIMIT 1")
      .first<{ mutation_id: string }>();
    await mutateDiary(db, date, {
      mutationId: crypto.randomUUID(),
      kind: "create",
      id: null,
      expectedVersion: null,
      body: "同日の新しい日記",
      epoch,
      absenceToken: absence!.mutation_id,
    });
    await expect(saveSummary(context, old)).rejects.toMatchObject({ code: "SUMMARY_CONFLICT" });
    expect((await getDiary(db, date))!.id).not.toBe(diary.id);
  });

  it("marks a restored diary stale and rejects an epoch change even on a receipt replay", async () => {
    const diary = await create();
    const input = await summary();
    await saveSummary(context, input);
    const trash = (await change(diary, "trash")).diary!;
    await change(trash, "restore");
    expect((await listPendingSummaries(context, {})).items[0].summaryStatus).toBe("stale");
    await db
      .prepare("UPDATE app_meta SET value = ? WHERE key = 'database_epoch'")
      .bind(crypto.randomUUID())
      .run();
    await expect(saveSummary(context, input)).rejects.toMatchObject({ code: "EPOCH_CHANGED" });
  });

  it("rechecks the epoch in the transaction, including a change immediately before batch", async () => {
    await create();
    const input = await summary();
    const raced: McpContext = {
      ...context,
      db: {
        prepare: db.prepare.bind(db),
        batch: async (statements) => {
          await db
            .prepare("UPDATE app_meta SET value = ? WHERE key = 'database_epoch'")
            .bind(crypto.randomUUID())
            .run();
          return db.batch(statements);
        },
      },
    };
    await expect(saveSummary(raced, input)).rejects.toMatchObject({ code: "EPOCH_CHANGED" });
    expect(await count("summary_mutation_receipts")).toBe(0);
    expect(await count("summary_history")).toBe(0);
  });

  it("computes yesterday on the server at Tokyo midnight and year boundaries; empty days stay absent", async () => {
    await create("年末", "2026-12-31");
    await create("新年", "2027-01-01");
    context.now = new Date("2026-12-31T14:59:59Z");
    expect((await listPendingSummaries(context, {})).items).toEqual([]);
    context.now = new Date("2026-12-31T15:00:00Z");
    expect((await listPendingSummaries(context, {})).items.map((item) => item.date)).toEqual([
      "2026-12-31",
    ]);
    context.now = new Date("2027-01-02T00:00:00Z");
    const first = await listPendingSummaries(context, { limit: 1 });
    expect(first.nextCursor).toBe("2026-12-31");
    expect((await listPendingSummaries(context, { cursor: first.nextCursor })).items[0].date).toBe(
      "2027-01-01",
    );
    expect(await count("diaries")).toBe(2);
  });

  it("exports current and stale summaries in v2 and aborts if summaries change between pages", async () => {
    for (const day of ["2026-10-16", "2026-10-17", "2026-10-18", date]) await create("架空", day);
    await saveSummary(context, await summary());
    const first = await getExportPage(db);
    const second = await getExportPage(db, first.nextCursor!, first.snapshotToken);
    expect(first.formatVersion).toBe(2);
    expect(second.diaries[0].aiSummary?.revision).toBe(1);
    await saveSummary(context, await summary());
    await expect(getExportPage(db, first.nextCursor!, first.snapshotToken)).rejects.toMatchObject({
      code: "EXPORT_CHANGED",
    });
  });

  it("enforces daily shared budgets under concurrency and resets at Tokyo midnight", async () => {
    await db
      .prepare("INSERT INTO mcp_daily_usage VALUES (?, ?, ?, ?)")
      .bind("2026-10-21", 499, 20, 1_992_000)
      .run();
    await expect(chargeMcp(context, "get_diary")).rejects.toMatchObject({ status: 429 });
    await expect(chargeMcp(context, "search_diaries")).rejects.toMatchObject({ status: 429 });
    const result = await Promise.allSettled([
      chargeMcp(context, "list_diaries"),
      chargeMcp(context, "list_diaries"),
    ]);
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    context.now = new Date("2026-10-21T15:00:00Z");
    await chargeMcp(context, "search_diaries");
    expect(await count("mcp_daily_usage")).toBe(1);
  });

  it("accepts the official SDK handshake and tools/list/read/write calls", async () => {
    await create();
    const client = new Client({ name: "kiroku-test", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL("https://mcp.example/mcp"), {
      fetch: async (input, init) => handleMcp(new Request(input, init), context),
    });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(5);
      expect(
        tools.tools.find((tool) => tool.name === "save_summary")?.annotations?.readOnlyHint,
      ).toBe(false);
      expect(tools.tools.filter((tool) => tool.annotations?.readOnlyHint)).toHaveLength(4);
      const pending = await client.callTool({ name: "list_pending_summaries", arguments: {} });
      expect(pending.isError).toBeUndefined();
      const saved = await client.callTool({
        name: "save_summary",
        arguments: { ...(await summary()) },
      });
      expect(saved.isError).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  it("handles notifications, invalid methods, input sizes and response limits without leaking text", async () => {
    expect((await handleMcp(new Request("http://localhost/mcp"), context)).status).toBe(405);
    expect(
      (await handleMcp(rpc({ jsonrpc: "2.0", method: "notifications/initialized" }), context))
        .status,
    ).toBe(202);
    expect((await handleMcp(rpc("["), context)).status).toBe(400);
    expect((await handleMcp(rpc("x".repeat(32001)), context)).status).toBe(413);
    expect((await handleMcp(rpc([], {}), context)).status).toBe(400);
    expect(
      (
        await handleMcp(
          rpc({ id: 1, jsonrpc: "2.0", method: "ping" }, { "mcp-protocol-version": "invalid" }),
          context,
        )
      ).status,
    ).toBe(400);
    const unknown = (await (
      await handleMcp(rpc({ id: 1, jsonrpc: "2.0", method: "execute_sql" }), context)
    ).json()) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32601);
    await create("\u0000".repeat(12000));
    const response = await handleMcp(
      rpc({
        id: 1,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "get_diary", arguments: { date } },
      }),
      context,
    );
    expect(new TextEncoder().encode(await response.text()).length).toBeLessThan(
      MCP_LIMITS.responseBytes,
    );
  });
});
