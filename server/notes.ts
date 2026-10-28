import {
  type Note,
  type NoteContent,
  type NoteMutation,
  type NoteMutationResponse,
  type NoteScope,
  type NoteState,
  type NoteSummary,
  summarizeNote,
} from "../src/lib/notes";
import { ApiError, errorResponse } from "./errors";
import { getEpoch } from "./diaries";
import { validateMutation } from "./validation";

type Connection = Pick<D1Database, "prepare" | "batch">;
interface NoteRow {
  id: string;
  title: string;
  body: string;
  pinned: number;
  archived: number;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  excerpt: string;
  task_count: number;
  completed_count: number;
}
const idPattern = /^[A-Za-z0-9_-]{16,100}$/;
export function validateNoteId(id: string): string {
  if (!idPattern.test(id))
    throw new ApiError(400, "INVALID_INPUT", "メモの指定が正しくありません。");
  return id;
}
function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    version: row.version,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
class NoteConflict extends ApiError {
  constructor(
    code: string,
    message: string,
    readonly state: NoteState,
  ) {
    super(409, code, message);
  }
}
export function noteErrorResponse(error: unknown): Response {
  if (error instanceof NoteConflict)
    return Response.json(
      { code: error.code, message: error.message, ...error.state },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  return errorResponse(error);
}
export function validateNoteMutation(value: unknown): NoteMutation {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(400, "INVALID_INPUT", "メモの保存内容が正しくありません。");
  const { content, ...base } = value as Record<string, unknown>;
  if (base.kind === "create" || base.kind === "update") {
    if (!content || typeof content !== "object" || Array.isArray(content))
      throw new ApiError(400, "INVALID_INPUT", "メモの内容がありません。");
    const note = content as NoteContent;
    if (
      Object.keys(note).some((key) => !["title", "body", "pinned", "archived"].includes(key)) ||
      typeof note.title !== "string" ||
      note.title.length > 200 ||
      typeof note.body !== "string" ||
      typeof note.pinned !== "boolean" ||
      typeof note.archived !== "boolean"
    )
      throw new ApiError(
        400,
        "INVALID_INPUT",
        "タイトルは200文字以内で入力してください。メモの形式も確認してください。",
      );
    if ("body" in base) throw new ApiError(400, "INVALID_INPUT", "メモの形式が正しくありません。");
    validateMutation({ ...base, body: note.body || note.title.trim() });
  } else {
    if (content !== undefined)
      throw new ApiError(400, "INVALID_INPUT", "メモの操作内容が正しくありません。");
    validateMutation(base);
  }
  return value as NoteMutation;
}
export async function readNoteJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json")
    throw new ApiError(415, "INVALID_CONTENT_TYPE", "JSONで送信してください。");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "INVALID_INPUT", "送信内容がありません。");
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    length += item.value.length;
    if (length > 6_020_000) {
      await reader.cancel();
      throw new ApiError(
        413,
        "BODY_TOO_LARGE",
        "送信内容が大きすぎます。端末のメモを保持してください。",
      );
    }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError(400, "INVALID_INPUT", "送信内容を読み取れません。");
  }
}
export async function getNoteState(db: Connection, id: string): Promise<NoteState> {
  validateNoteId(id);
  const results = await db.batch([
    db.prepare("SELECT * FROM notes WHERE id = ?").bind(id),
    db.prepare("SELECT value FROM app_meta WHERE key = 'database_epoch'"),
    db
      .prepare(
        "SELECT mutation_id FROM note_mutation_receipts WHERE note_id = ? ORDER BY rowid DESC LIMIT 1",
      )
      .bind(id),
  ]);
  const epoch = (results[1].results[0] as { value: string } | undefined)?.value;
  if (!epoch) throw new ApiError(503, "DATABASE_NOT_READY", "データベースの準備ができていません。");
  const row = results[0].results[0] as NoteRow | undefined;
  return {
    note: row ? toNote(row) : null,
    epoch,
    absenceToken:
      (results[2].results[0] as { mutation_id: string } | undefined)?.mutation_id ?? null,
  };
}
export async function mutateNote(
  db: Connection,
  id: string,
  value: unknown,
): Promise<NoteMutationResponse> {
  validateNoteId(id);
  const request = validateNoteMutation(value);
  const epoch = await getEpoch(db);
  const conflict = async (code = "CONFLICT") =>
    new NoteConflict(
      code,
      "メモの状態が変わりました。端末版とサーバー版を確認してください。",
      await getNoteState(db, id),
    );
  if (request.epoch !== epoch) throw await conflict("EPOCH_CHANGED");
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify([
            id,
            request.mutationId,
            request.kind,
            request.id,
            request.expectedVersion,
            request.content
              ? [
                  request.content.title,
                  request.content.body,
                  request.content.pinned,
                  request.content.archived,
                ]
              : null,
            epoch,
            request.absenceToken ?? null,
          ]),
        ),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  type Receipt = { request_hash: string; result_version: number; note_id: string };
  const receipt = () =>
    db
      .prepare(
        "SELECT request_hash, result_version, note_id FROM note_mutation_receipts WHERE mutation_id = ?",
      )
      .bind(request.mutationId)
      .first<Receipt>();
  const acknowledge = async (prior: Receipt, replayed: boolean): Promise<NoteMutationResponse> => {
    if (prior.request_hash !== hash || prior.note_id !== id)
      throw await conflict("MUTATION_ID_REUSED");
    const latest = await getNoteState(db, id);
    if (latest.epoch !== epoch) throw await conflict("EPOCH_CHANGED");
    return {
      ...latest,
      mutationId: request.mutationId,
      appliedVersion: request.kind === "purge" ? null : prior.result_version,
      appliedNoteId: id,
      replayed,
    };
  };
  const prior = await receipt();
  if (prior) return acknowledge(prior, true);
  const now = new Date().toISOString();
  const version = request.kind === "create" ? 1 : request.expectedVersion! + 1;
  const deleted =
    request.kind === "restore" || request.kind === "purge" ? "IS NOT NULL" : "IS NULL";
  // A note UUID is never reused, including after purge. The absence token is still checked.
  const predicate =
    request.kind === "create"
      ? "NOT EXISTS (SELECT 1 FROM notes WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM note_mutation_receipts WHERE note_id = ?) AND ? = ''"
      : `EXISTS (SELECT 1 FROM notes WHERE id = ? AND id = ? AND version = ? AND deleted_at ${deleted})`;
  const conditions =
    request.kind === "create"
      ? [id, id, request.absenceToken ?? ""]
      : [id, request.id!, request.expectedVersion!];
  const insert = db
    .prepare(
      `INSERT INTO note_mutation_receipts (mutation_id, request_hash, note_id, kind, result_version, epoch, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT value FROM app_meta WHERE key = 'database_epoch') = ? AND ${predicate} ON CONFLICT (mutation_id) DO NOTHING`,
    )
    .bind(request.mutationId, hash, id, request.kind, version, epoch, now, epoch, ...conditions);
  let change: D1PreparedStatement;
  if (request.kind === "create" || request.kind === "update") {
    const content = request.content!;
    const summary = summarizeNote({
      ...content,
      id,
      version,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const values = [
      content.title,
      content.body,
      Number(content.pinned),
      Number(content.archived),
      summary.excerpt,
      summary.taskCount,
      summary.completedCount,
    ];
    change =
      request.kind === "create"
        ? db
            .prepare(
              "INSERT INTO notes (id, title, body, pinned, archived, excerpt, task_count, completed_count, version, deleted_at, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ? WHERE changes() = 1",
            )
            .bind(id, ...values, now, now)
        : db
            .prepare(
              "UPDATE notes SET title = ?, body = ?, pinned = ?, archived = ?, excerpt = ?, task_count = ?, completed_count = ?, version = version + 1, updated_at = ? WHERE changes() = 1 AND id = ? AND version = ? AND deleted_at IS NULL",
            )
            .bind(...values, now, id, request.expectedVersion!);
  } else if (request.kind === "purge") {
    change = db
      .prepare(
        "DELETE FROM notes WHERE changes() = 1 AND id = ? AND version = ? AND deleted_at IS NOT NULL",
      )
      .bind(id, request.expectedVersion!);
  } else {
    change = db
      .prepare(
        `UPDATE notes SET deleted_at = ?, version = version + 1, updated_at = ? WHERE changes() = 1 AND id = ? AND version = ? AND deleted_at ${deleted}`,
      )
      .bind(request.kind === "trash" ? now : null, now, id, request.expectedVersion!);
  }
  const result = await db.batch([insert, change]);
  const saved = await receipt();
  if (saved) return acknowledge(saved, result[0].meta.changes === 0);
  throw await conflict((await getEpoch(db)) === epoch ? "CONFLICT" : "EPOCH_CHANGED");
}
export async function listNotes(db: Connection, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiError(400, "INVALID_INPUT", "一覧の指定が正しくありません。");
  const {
    scope = "active",
    query = "",
    cursor = "",
  } = input as { scope?: NoteScope; query?: string; cursor?: string };
  if (
    !["active", "archived", "trash"].includes(scope) ||
    typeof query !== "string" ||
    query.length > 100 ||
    typeof cursor !== "string" ||
    cursor.length > 300
  )
    throw new ApiError(400, "INVALID_INPUT", "検索条件を確認してください。");
  let seek: [number, string, string] | null = null;
  if (cursor) {
    try {
      const parsed: unknown = JSON.parse(atob(cursor));
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 3 ||
        ![0, 1].includes(parsed[0]) ||
        typeof parsed[1] !== "string" ||
        typeof parsed[2] !== "string"
      )
        throw new Error();
      seek = parsed as [number, string, string];
    } catch {
      throw new ApiError(400, "INVALID_INPUT", "一覧を最初から読み直してください。");
    }
  }
  const state =
    scope === "trash"
      ? "deleted_at IS NOT NULL"
      : `deleted_at IS NULL AND archived = ${scope === "archived" ? 1 : 0}`;
  const rows = await db
    .prepare(
      `SELECT id, title, pinned, archived, excerpt, task_count, completed_count, version, deleted_at, created_at, updated_at FROM notes WHERE ${state} AND (instr(lower(title), lower(?)) > 0 OR instr(lower(body), lower(?)) > 0) ${seek ? "AND (pinned, updated_at, id) < (?, ?, ?)" : ""} ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT 31`,
    )
    .bind(query, query, ...(seek ?? []))
    .all<NoteRow>();
  const items: NoteSummary[] = rows.results.slice(0, 30).map((row) => {
    const { body: _body, ...note } = toNote(row);
    return {
      ...note,
      excerpt: row.excerpt,
      taskCount: row.task_count,
      completedCount: row.completed_count,
    };
  });
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.results.length > 30 && last
        ? btoa(JSON.stringify([Number(last.pinned), last.updatedAt, last.id]))
        : null,
    epoch: await getEpoch(db),
  };
}
