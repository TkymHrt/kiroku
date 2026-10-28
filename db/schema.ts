import { sql } from "void/db";
import { check, index, integer, primaryKey, sqliteTable, text } from "void/schema-d1";

export const diaries = sqliteTable(
  "diaries",
  {
    id: text("id").primaryKey(),
    date: text("diary_date").notNull().unique(),
    body: text("body").notNull(),
    version: integer("version").notNull(),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("diaries_deleted_date_idx").on(table.deletedAt, table.date),
    check("diaries_version_positive", sql`${table.version} >= 1`),
    check("diaries_body_bytes", sql`length(CAST(${table.body} AS BLOB)) <= 1000000`),
  ],
);

// Receipts are kept indefinitely: removing them makes an arbitrarily old retry unsafe.
// Only a SHA-256 fingerprint is retained, never a second copy of the diary body.
export const mutationReceipts = sqliteTable(
  "mutation_receipts",
  {
    mutationId: text("mutation_id").primaryKey(),
    requestHash: text("request_hash").notNull(),
    diaryId: text("diary_id").notNull(),
    date: text("diary_date").notNull(),
    kind: text("kind").notNull(),
    resultVersion: integer("result_version").notNull(),
    epoch: text("epoch").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "mutation_receipts_kind",
      sql`${table.kind} IN ('create', 'update', 'trash', 'restore', 'purge')`,
    ),
    index("mutation_receipts_date_idx").on(table.date),
  ],
);

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    pinned: integer("pinned").notNull().default(0),
    archived: integer("archived").notNull().default(0),
    excerpt: text("excerpt").notNull(),
    taskCount: integer("task_count").notNull().default(0),
    completedCount: integer("completed_count").notNull().default(0),
    version: integer("version").notNull(),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("notes_list_idx").on(
      table.deletedAt,
      table.archived,
      table.pinned,
      table.updatedAt,
      table.id,
    ),
    check("notes_version_positive", sql`${table.version} >= 1`),
    check("notes_body_bytes", sql`length(CAST(${table.body} AS BLOB)) <= 1000000`),
    check("notes_title_length", sql`length(${table.title}) <= 200`),
    check("notes_flags", sql`${table.pinned} IN (0, 1) AND ${table.archived} IN (0, 1)`),
  ],
);
export const noteMutationReceipts = sqliteTable(
  "note_mutation_receipts",
  {
    mutationId: text("mutation_id").primaryKey(),
    requestHash: text("request_hash").notNull(),
    noteId: text("note_id").notNull(),
    kind: text("kind").notNull(),
    resultVersion: integer("result_version").notNull(),
    epoch: text("epoch").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("note_receipts_note_idx").on(table.noteId),
    check(
      "note_receipts_kind",
      sql`${table.kind} IN ('create', 'update', 'trash', 'restore', 'purge')`,
    ),
  ],
);

// Summary text never changes the source diary's version. Purge cascades to both
// current text and history; non-content operation receipts remain indefinitely.
export const diarySummaries = sqliteTable(
  "diary_summaries",
  {
    diaryId: text("diary_id")
      .primaryKey()
      .references(() => diaries.id, { onDelete: "cascade" }),
    sourceVersion: integer("source_version").notNull(),
    sourceEpoch: text("source_epoch").notNull(),
    revision: integer("revision").notNull(),
    summary: text("summary").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("summary_revision_positive", sql`${table.revision} >= 1`),
    check("summary_bytes", sql`length(CAST(${table.summary} AS BLOB)) BETWEEN 1 AND 4000`),
  ],
);

export const summaryHistory = sqliteTable(
  "summary_history",
  {
    diaryId: text("diary_id")
      .notNull()
      .references(() => diaries.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    sourceVersion: integer("source_version").notNull(),
    sourceEpoch: text("source_epoch").notNull(),
    summary: text("summary").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.diaryId, table.revision] }),
    check("summary_history_bytes", sql`length(CAST(${table.summary} AS BLOB)) BETWEEN 1 AND 4000`),
  ],
);

export const summaryMutationReceipts = sqliteTable("summary_mutation_receipts", {
  mutationId: text("mutation_id").primaryKey(),
  requestHash: text("request_hash").notNull(),
  diaryId: text("diary_id").notNull(),
  sourceVersion: integer("source_version").notNull(),
  resultRevision: integer("result_revision").notNull(),
  epoch: text("epoch").notNull(),
  createdAt: text("created_at").notNull(),
});

// Shared by all Worker isolates, rather than an in-memory rate limit. These
// counters contain no text, query, account identifier or authentication data.
export const mcpDailyUsage = sqliteTable("mcp_daily_usage", {
  day: text("day").primaryKey(),
  calls: integer("calls").notNull().default(0),
  searches: integer("searches").notNull().default(0),
  readCharacters: integer("read_characters").notNull().default(0),
});
