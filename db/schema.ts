import { sql } from 'void/db';
import { check, index, integer, sqliteTable, text } from 'void/schema-d1';

export const diaries = sqliteTable('diaries', {
  id: text('id').primaryKey(),
  date: text('diary_date').notNull().unique(),
  body: text('body').notNull(),
  version: integer('version').notNull(),
  deletedAt: text('deleted_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('diaries_deleted_date_idx').on(table.deletedAt, table.date),
  check('diaries_version_positive', sql`${table.version} >= 1`),
  check('diaries_body_bytes', sql`length(CAST(${table.body} AS BLOB)) <= 1000000`),
]);

// Receipts are kept indefinitely: removing them makes an arbitrarily old retry unsafe.
// Only a SHA-256 fingerprint is retained, never a second copy of the diary body.
export const mutationReceipts = sqliteTable('mutation_receipts', {
  mutationId: text('mutation_id').primaryKey(),
  requestHash: text('request_hash').notNull(),
  diaryId: text('diary_id').notNull(),
  date: text('diary_date').notNull(),
  kind: text('kind').notNull(),
  resultVersion: integer('result_version').notNull(),
  epoch: text('epoch').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  check('mutation_receipts_kind', sql`${table.kind} IN ('create', 'update', 'trash', 'restore', 'purge')`),
  index('mutation_receipts_date_idx').on(table.date),
]);

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
