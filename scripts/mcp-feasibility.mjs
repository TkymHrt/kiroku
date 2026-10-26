// Isolated feasibility experiment: synthetic data, ephemeral local D1, no network API.
// This is not the production MCP server or a production migration.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { Miniflare } from "miniflare";

const runtime = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("experiment"); } }',
  compatibilityDate: "2026-02-24",
  d1Databases: { DB: "mcp-feasibility-synthetic" },
  d1Persist: false,
});
const results = [];
const record = (name, evidence) => results.push({ name, passed: true, evidence });

try {
  const db = await runtime.getD1Database("DB");
  const migrations = new URL("../db/migrations/", import.meta.url);
  for (const name of readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    for (const statement of readFileSync(new URL(name, migrations), "utf8").split(";")) {
      if (statement.trim()) await db.prepare(statement).run();
    }
  }
  await db
    .prepare("UPDATE app_meta SET value = 'experiment-epoch-1' WHERE key = 'database_epoch'")
    .run();
  const fixture = [
    ["synthetic-a", "2080-01-01", "今日は図書館で読書した。帰りに散歩した。", null],
    ["synthetic-b", "2080-01-02", "東京で友人と会い、Cloudflareの設定を見直した。", null],
    ["synthetic-trash", "2080-01-03", "図書館の削除済み架空記録。", "2080-01-04T00:00:00Z"],
  ];
  for (const [id, date, body, deletedAt] of fixture) {
    await db
      .prepare(
        "INSERT INTO diaries (id, diary_date, body, version, deleted_at, created_at, updated_at) VALUES (?, ?, ?, 1, ?, '2080-01-01T00:00:00Z', '2080-01-01T00:00:00Z')",
      )
      .bind(id, date, body, deletedAt)
      .run();
  }
  for (const [name, tokenizer] of [
    ["words", "unicode61"],
    ["grams", "trigram"],
  ]) {
    await db
      .prepare(`CREATE VIRTUAL TABLE ${name} USING fts5(body, tokenize='${tokenizer}')`)
      .run();
    await db.prepare(`INSERT INTO ${name} (rowid, body) SELECT rowid, body FROM diaries`).run();
  }
  const hits = async (table, query) =>
    (
      await db
        .prepare(
          `SELECT d.id FROM ${table} JOIN diaries d ON d.rowid = ${table}.rowid WHERE ${table} MATCH ? AND d.deleted_at IS NULL ORDER BY d.id`,
        )
        .bind(query)
        .all()
    ).results.map((row) => row.id);

  assert.deepEqual(await hits("words", "図書館"), []);
  assert.deepEqual(await hits("grams", "図書館"), ["synthetic-a"]);
  record("Japanese substring: unicode61 misses, trigram matches", {
    unicode61: [],
    trigram: ["synthetic-a"],
    query: "図書館",
  });
  assert.deepEqual(await hits("grams", "東京"), []);
  const shortHits = await db
    .prepare("SELECT id FROM diaries WHERE deleted_at IS NULL AND instr(body, ?) > 0 ORDER BY id")
    .bind("東京")
    .all();
  assert.deepEqual(
    shortHits.results.map((row) => row.id),
    ["synthetic-b"],
  );
  record("Two-character Japanese query needs substring fallback", {
    query: "東京",
    matches: ["synthetic-b"],
  });
  assert.deepEqual(await hits("grams", '"Cloudflare"'), ["synthetic-b"]);
  record("Latin query matches; deleted diary is excluded by live-table join", {
    query: "Cloudflare",
  });

  // Prototype of the source/version/epoch and summary revision conditions only.
  await db
    .prepare(`CREATE TABLE experimental_summaries (
    diary_id TEXT PRIMARY KEY, source_version INTEGER NOT NULL,
    source_epoch TEXT NOT NULL, summary TEXT NOT NULL, revision INTEGER NOT NULL
  )`)
    .run();
  const save = async ({
    id = "synthetic-a",
    version = 1,
    epoch = "experiment-epoch-1",
    revision = 0,
    summary = "架空の要約",
  } = {}) => {
    const result = await db
      .prepare(`
      INSERT INTO experimental_summaries (diary_id, source_version, source_epoch, summary, revision)
      SELECT d.id, d.version, m.value, ?, 1 FROM diaries d, app_meta m
      WHERE d.id = ? AND d.version = ? AND d.deleted_at IS NULL
        AND m.key = 'database_epoch' AND m.value = ?
        AND ((? = 0 AND NOT EXISTS (SELECT 1 FROM experimental_summaries WHERE diary_id = d.id))
          OR EXISTS (SELECT 1 FROM experimental_summaries WHERE diary_id = d.id AND revision = ?))
      ON CONFLICT(diary_id) DO UPDATE SET source_version = excluded.source_version,
        source_epoch = excluded.source_epoch, summary = excluded.summary, revision = revision + 1
      WHERE revision = ?
    `)
      .bind(summary, id, version, epoch, revision, revision, revision)
      .run();
    return result.meta.changes;
  };
  assert.equal(await save(), 1);
  assert.equal(
    (await db.prepare("SELECT version FROM diaries WHERE id = 'synthetic-a'").first()).version,
    1,
  );
  record("Saving separate summary leaves diary version unchanged", { diaryVersion: 1 });
  assert.equal(await save({ summary: "古い期待値で上書き" }), 0);
  assert.equal(await save({ revision: 1, summary: "明示的に再生成" }), 1);
  record("Summary revision rejects a stale replacement", {
    rejectedRevision: 0,
    acceptedRevision: 1,
  });
  await db
    .prepare("UPDATE diaries SET version = 2, body = body || '追記。' WHERE id = 'synthetic-a'")
    .run();
  assert.equal(await save({ revision: 2 }), 0);
  assert.equal(await save({ version: 2, revision: 2 }), 1);
  record("Diary edit rejects summary generated from old version", {
    rejectedVersion: 1,
    acceptedVersion: 2,
  });
  await db
    .prepare("UPDATE app_meta SET value = 'experiment-epoch-2' WHERE key = 'database_epoch'")
    .run();
  assert.equal(await save({ version: 2, revision: 3 }), 0);
  record("Database recovery epoch rejects old summary result", {
    rejectedEpoch: "experiment-epoch-1",
  });
  assert.equal(await save({ id: "synthetic-trash", epoch: "experiment-epoch-2" }), 0);
  record("Trashed diary cannot receive a summary", { id: "synthetic-trash" });
  await db.prepare("DELETE FROM diaries WHERE id = 'synthetic-a'").run();
  await db
    .prepare(
      "INSERT INTO diaries (id, diary_date, body, version, created_at, updated_at) VALUES ('synthetic-new', '2080-01-01', '再作成した架空日記。', 1, '2080-01-01T00:00:00Z', '2080-01-01T00:00:00Z')",
    )
    .run();
  assert.equal(await save({ epoch: "experiment-epoch-2", revision: 3 }), 0);
  record("Same-date recreation rejects result for old diary ID", {
    oldId: "synthetic-a",
    newId: "synthetic-new",
  });

  const targetDate = (iso) =>
    new Date(new Date(iso).getTime() + 9 * 3600000 - 86400000).toISOString().slice(0, 10);
  assert.equal(targetDate("2080-01-01T15:15:00Z"), "2080-01-01");
  assert.equal(targetDate("2079-12-31T15:15:00Z"), "2079-12-31");
  record("00:15 JST targets previous Tokyo day, including year boundary", {
    utc: "2080-01-01T15:15:00Z",
    targetDate: "2080-01-01",
  });

  const report = {
    checkedAt: new Date().toISOString(),
    runtime: "local Miniflare D1; ephemeral synthetic fixtures",
    node: process.version,
    miniflare: JSON.parse(
      readFileSync(new URL("../node_modules/miniflare/package.json", import.meta.url), "utf8"),
    ).version,
    scope:
      "Search tokenizer behavior and proposed SQL conditions only; no MCP/OAuth/cloud/AI/production validation",
    results,
  };
  const reportDirectory = new URL("../test-results/", import.meta.url);
  mkdirSync(reportDirectory, { recursive: true });
  writeFileSync(
    new URL("mcp-feasibility.json", reportDirectory),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await runtime.dispose();
}
