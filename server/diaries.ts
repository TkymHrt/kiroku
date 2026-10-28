import type { Diary, DiarySummary, MutationRequest, MutationResponse } from "../src/lib/types";
import { ApiError } from "./errors";
import { validateDate, validateMutation } from "./validation";
import type { Note } from "../src/lib/notes";

type Connection = Pick<D1Database, "prepare" | "batch">;
interface Row {
  id: string;
  diary_date: string;
  body: string;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
interface Receipt {
  request_hash: string;
  result_version: number;
  diary_id: string;
}
const columns = "id, diary_date, body, version, deleted_at, created_at, updated_at";
const summaryColumns = "id, diary_date, version, deleted_at, created_at, updated_at";

export function toDiary(row: Row): Diary {
  return {
    id: row.id,
    date: row.diary_date,
    body: row.body,
    version: row.version,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getEpoch(db: Connection): Promise<string> {
  const row = await db
    .prepare("SELECT value FROM app_meta WHERE key = 'database_epoch'")
    .first<{ value: string }>();
  if (!row?.value)
    throw new ApiError(503, "DATABASE_NOT_READY", "データベースの準備ができていません。");
  return row.value;
}

export async function getDiary(db: Connection, date: string): Promise<Diary | null> {
  validateDate(date);
  const row = await db
    .prepare(`SELECT ${columns} FROM diaries WHERE diary_date = ?`)
    .bind(date)
    .first<Row>();
  return row ? toDiary(row) : null;
}

export async function getDiaryState(
  db: Connection,
  date: string,
): Promise<{ diary: Diary | null; epoch: string; absenceToken: string | null }> {
  validateDate(date);
  const [diaryResult, epochResult, absenceResult] = await db.batch<
    Row | { value: string } | { mutation_id: string }
  >([
    db.prepare(`SELECT ${columns} FROM diaries WHERE diary_date = ?`).bind(date),
    db.prepare("SELECT value FROM app_meta WHERE key = 'database_epoch'"),
    db
      .prepare(
        "SELECT mutation_id FROM mutation_receipts WHERE diary_date = ? ORDER BY rowid DESC LIMIT 1",
      )
      .bind(date),
  ]);
  const row = diaryResult.results[0] as Row | undefined;
  const epoch = (epochResult.results[0] as { value: string } | undefined)?.value;
  if (!epoch) throw new ApiError(503, "DATABASE_NOT_READY", "データベースの準備ができていません。");
  return {
    diary: row ? toDiary(row) : null,
    epoch,
    absenceToken:
      (absenceResult.results[0] as { mutation_id: string } | undefined)?.mutation_id ?? null,
  };
}

export async function listDiaries(
  db: Connection,
  options: { trash?: boolean; before?: string; limit?: number } = {},
) {
  if (options.before) validateDate(options.before);
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new ApiError(400, "INVALID_LIMIT", "取得件数は 1〜100 件です。");
  const state = options.trash ? "IS NOT NULL" : "IS NULL";
  const rows = await db
    .prepare(`SELECT ${summaryColumns} FROM diaries
    WHERE deleted_at ${state} ${options.before ? "AND diary_date < ?" : ""}
    ORDER BY diary_date DESC LIMIT ?`)
    .bind(...(options.before ? [options.before, limit + 1] : [limit + 1]))
    .all<Row>();
  const items: DiarySummary[] = rows.results.slice(0, limit).map((row) => ({
    id: row.id,
    date: row.diary_date,
    version: row.version,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  return {
    items,
    nextCursor: rows.results.length > limit ? items.at(-1)!.date : null,
    epoch: await getEpoch(db),
  };
}

export async function getNeighbors(db: Connection, date: string) {
  validateDate(date);
  const [previous, next] = await db.batch<{ diary_date: string }>([
    db
      .prepare(
        "SELECT diary_date FROM diaries WHERE deleted_at IS NULL AND diary_date < ? ORDER BY diary_date DESC LIMIT 1",
      )
      .bind(date),
    db
      .prepare(
        "SELECT diary_date FROM diaries WHERE deleted_at IS NULL AND diary_date > ? ORDER BY diary_date ASC LIMIT 1",
      )
      .bind(date),
  ]);
  return {
    previous: previous.results[0]?.diary_date ?? null,
    next: next.results[0]?.diary_date ?? null,
  };
}

async function requestHash(date: string, request: MutationRequest): Promise<string> {
  const encoded = new TextEncoder().encode(
    JSON.stringify([
      date,
      request.mutationId,
      request.kind,
      request.id,
      request.expectedVersion,
      request.body ?? null,
      request.epoch,
      request.absenceToken ?? null,
    ]),
  );
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Each D1 batch is one serialized transaction. The receipt INSERT and the diary
 * change are inseparable. changes() gates the second statement on this batch's
 * newly inserted receipt, so an old successful create cannot recreate a purged
 * diary, even if that operation's response was lost years earlier.
 */
export async function mutateDiary(
  db: Connection,
  date: string,
  input: MutationRequest,
): Promise<MutationResponse> {
  validateDate(date);
  const request = validateMutation(input);
  const epoch = await getEpoch(db);
  if (request.epoch !== epoch) {
    const latest = await getDiaryState(db, date);
    throw new ApiError(
      409,
      "EPOCH_CHANGED",
      "復元によりデータベースの世代が変わりました。端末版とサーバー版を確認してください。",
      latest.diary,
      latest.epoch,
      latest.absenceToken,
    );
  }
  const hash = await requestHash(date, request);
  const prior = await db
    .prepare(
      "SELECT request_hash, result_version, diary_id FROM mutation_receipts WHERE mutation_id = ?",
    )
    .bind(request.mutationId)
    .first<Receipt>();
  if (prior) return acknowledge(prior, true);

  const now = new Date().toISOString();
  const id = request.kind === "create" ? crypto.randomUUID() : request.id!;
  const version = request.kind === "create" ? 1 : request.expectedVersion! + 1;
  const state = request.kind === "restore" || request.kind === "purge" ? "IS NOT NULL" : "IS NULL";
  const predicate =
    request.kind === "create"
      ? `NOT EXISTS (SELECT 1 FROM diaries WHERE diary_date = ?)
       AND COALESCE((SELECT mutation_id FROM mutation_receipts WHERE diary_date = ? ORDER BY rowid DESC LIMIT 1), '') = ?`
      : `EXISTS (SELECT 1 FROM diaries WHERE diary_date = ? AND id = ? AND version = ? AND deleted_at ${state})`;
  const predicates =
    request.kind === "create"
      ? [date, date, request.absenceToken ?? ""]
      : [date, id, request.expectedVersion!];
  const receiptInsert = db
    .prepare(`INSERT INTO mutation_receipts
    (mutation_id, request_hash, diary_id, diary_date, kind, result_version, epoch, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT value FROM app_meta WHERE key = 'database_epoch') = ? AND ${predicate}
    ON CONFLICT (mutation_id) DO NOTHING`)
    .bind(
      request.mutationId,
      hash,
      id,
      date,
      request.kind,
      version,
      epoch,
      now,
      epoch,
      ...predicates,
    );
  let change: D1PreparedStatement;
  if (request.kind === "create") {
    change = db
      .prepare(`INSERT INTO diaries (${columns}) SELECT ?, ?, ?, 1, NULL, ?, ? WHERE changes() = 1`)
      .bind(id, date, request.body!, now, now);
  } else if (request.kind === "purge") {
    change = db
      .prepare(
        "DELETE FROM diaries WHERE changes() = 1 AND id = ? AND diary_date = ? AND version = ? AND deleted_at IS NOT NULL",
      )
      .bind(id, date, request.expectedVersion!);
  } else {
    const set =
      request.kind === "update"
        ? "body = ?,"
        : request.kind === "trash"
          ? "deleted_at = ?,"
          : "deleted_at = NULL,";
    const values =
      request.kind === "update" ? [request.body!] : request.kind === "trash" ? [now] : [];
    change = db
      .prepare(`UPDATE diaries SET ${set} version = version + 1, updated_at = ?
      WHERE changes() = 1 AND id = ? AND diary_date = ? AND version = ? AND deleted_at ${state}`)
      .bind(...values, now, id, date, request.expectedVersion!);
  }
  const results = await db.batch([receiptInsert, change]);
  const receipt = await db
    .prepare(
      "SELECT request_hash, result_version, diary_id FROM mutation_receipts WHERE mutation_id = ?",
    )
    .bind(request.mutationId)
    .first<Receipt>();
  if (receipt) return acknowledge(receipt, results[0].meta.changes === 0);
  const latest = await getDiaryState(db, date);
  throw new ApiError(
    409,
    latest.epoch === epoch ? "CONFLICT" : "EPOCH_CHANGED",
    "サーバーの状態が変わりました。両方の内容を確認して解決してください。",
    latest.diary,
    latest.epoch,
    latest.absenceToken,
  );

  async function acknowledge(receipt: Receipt, replayed: boolean): Promise<MutationResponse> {
    if (receipt.request_hash !== hash) {
      const latest = await getDiaryState(db, date);
      throw new ApiError(
        409,
        "MUTATION_ID_REUSED",
        "同じ操作 ID に異なる内容が送信されました。本文を保持して再確認してください。",
        latest.diary,
        latest.epoch,
        latest.absenceToken,
      );
    }
    const latest = await getDiaryState(db, date);
    if (latest.epoch !== epoch) {
      throw new ApiError(
        409,
        "EPOCH_CHANGED",
        "復元によりデータベースの世代が変わりました。端末版とサーバー版を確認してください。",
        latest.diary,
        latest.epoch,
        latest.absenceToken,
      );
    }
    return {
      diary: latest.diary,
      epoch,
      mutationId: request.mutationId,
      appliedVersion: request.kind === "purge" ? null : receipt.result_version,
      appliedDiaryId: receipt.diary_id,
      absenceToken: latest.absenceToken,
      replayed,
    };
  }
}

// The browser assembles pages into ONE JSON download. Bounded pages avoid both
// the Worker memory ceiling and the Free plan's per-invocation D1 query limit.
// The durable receipt rowid is a global revision; any successful write changes
// it, so a concurrent edit aborts the export instead of mixing snapshots.
export async function getExportPage(
  db: Connection,
  after = "",
  snapshotToken?: string,
  noteAfter?: string,
) {
  if (after) validateDate(after);
  if ((after || noteAfter !== undefined) && !snapshotToken)
    throw new ApiError(
      400,
      "INVALID_INPUT",
      "エクスポートの継続条件がありません。最初から実行してください。",
    );
  if (noteAfter && !/^[A-Za-z0-9_-]{16,100}$/.test(noteAfter))
    throw new ApiError(400, "INVALID_INPUT", "メモの継続条件が正しくありません。");
  const [metadata, revisionResult, summaryRevisionResult, rows, noteRevisionResult, noteRows] =
    await db.batch<Row | { value: string } | { revision: number }>([
      db.prepare("SELECT value FROM app_meta WHERE key = 'database_epoch'"),
      db.prepare("SELECT COALESCE(MAX(rowid), 0) AS revision FROM mutation_receipts"),
      db.prepare("SELECT COALESCE(MAX(rowid), 0) AS revision FROM summary_mutation_receipts"),
      db
        .prepare(
          `SELECT d.*, s.summary AS ai_summary, s.source_version, s.source_epoch,
          s.revision AS summary_revision, s.updated_at AS summary_updated_at
          FROM diaries d LEFT JOIN diary_summaries s ON s.diary_id = d.id
          WHERE d.diary_date > ? AND ? = 1 ORDER BY d.diary_date ASC LIMIT 3`,
        )
        .bind(after, noteAfter === undefined ? 1 : 0),
      db.prepare("SELECT COALESCE(MAX(rowid), 0) AS revision FROM note_mutation_receipts"),
      db
        .prepare("SELECT * FROM notes WHERE id > ? AND ? = 1 ORDER BY id ASC LIMIT 3")
        .bind(noteAfter ?? "", noteAfter !== undefined ? 1 : 0),
    ]);
  const epoch = (metadata.results[0] as { value: string } | undefined)?.value;
  if (!epoch) throw new ApiError(503, "DATABASE_NOT_READY", "データベースの準備ができていません。");
  const revision = (revisionResult.results[0] as { revision: number }).revision;
  const summaryRevision = (summaryRevisionResult.results[0] as { revision: number }).revision;
  const noteRevision = (noteRevisionResult.results[0] as { revision: number }).revision;
  const currentToken = `${epoch}:${revision}:${summaryRevision}:${noteRevision}`;
  if (snapshotToken !== undefined && snapshotToken !== currentToken) {
    throw new ApiError(
      409,
      "EXPORT_CHANGED",
      "エクスポート中に記録が更新されました。編集が保存された後にもう一度実行してください。",
      undefined,
      epoch,
    );
  }
  const diaries = (
    rows.results as (Row & {
      ai_summary: string | null;
      source_version: number;
      source_epoch: string;
      summary_revision: number;
      summary_updated_at: string;
    })[]
  ).map((row) => ({
    ...toDiary(row),
    aiSummary:
      row.ai_summary === null
        ? null
        : {
            summary: row.ai_summary,
            sourceVersion: row.source_version,
            sourceEpoch: row.source_epoch,
            revision: row.summary_revision,
            updatedAt: row.summary_updated_at,
          },
  }));
  const notes: Note[] = (
    noteRows.results as unknown as {
      id: string;
      title: string;
      body: string;
      pinned: number;
      archived: number;
      version: number;
      deleted_at: string | null;
      created_at: string;
      updated_at: string;
    }[]
  ).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    version: row.version,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  return {
    formatVersion: 3,
    exportedAt: new Date().toISOString(),
    epoch,
    snapshotToken: currentToken,
    diaries,
    notes,
    nextNoteCursor: notes.length === 3 ? notes.at(-1)!.id : null,
    nextCursor: diaries.length === 3 ? diaries.at(-1)!.date : null,
  };
}
