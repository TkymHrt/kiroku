import type { MutationRequest } from "../src/lib/types";
import { ApiError } from "./errors";

export const MAX_BODY_BYTES = 1_000_000;
const MAX_JSON_BYTES = 6_010_000;
const identifier = /^[A-Za-z0-9_-]{16,100}$/;

export function validateDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < "0001-01-01" || date > "9999-12-31") {
    throw new ApiError(400, "INVALID_DATE", "日付を YYYY-MM-DD で指定してください。");
  }
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new ApiError(400, "INVALID_DATE", "有効な日付を指定してください。");
  }
  return date;
}

export function validateMutation(value: unknown): MutationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const request = value as Record<string, unknown>;
  const allowed = ["mutationId", "kind", "id", "expectedVersion", "body", "epoch", "absenceToken"];
  if (Object.keys(request).some((key) => !allowed.includes(key))) invalid();
  if (typeof request.mutationId !== "string" || !identifier.test(request.mutationId)) invalid();
  if (typeof request.epoch !== "string" || !identifier.test(request.epoch)) invalid();
  if (!["create", "update", "trash", "restore", "purge"].includes(String(request.kind))) invalid();
  if (request.kind === "create") {
    if (
      request.id !== null ||
      request.expectedVersion !== null ||
      typeof request.body !== "string" ||
      request.body === ""
    )
      invalid();
    if (
      !("absenceToken" in request) ||
      (request.absenceToken !== null &&
        (typeof request.absenceToken !== "string" || !identifier.test(request.absenceToken)))
    )
      invalid();
  } else {
    if (request.absenceToken !== undefined) invalid();
    if (
      typeof request.id !== "string" ||
      !identifier.test(request.id) ||
      !Number.isSafeInteger(request.expectedVersion) ||
      Number(request.expectedVersion) < 1
    )
      invalid();
    if (request.kind === "update" && typeof request.body !== "string") invalid();
    if (request.kind !== "update" && request.body !== undefined) invalid();
  }
  if (
    typeof request.body === "string" &&
    new TextEncoder().encode(request.body).byteLength > MAX_BODY_BYTES
  ) {
    throw new ApiError(
      413,
      "BODY_TOO_LARGE",
      "本文が 1,000,000 バイトを超えています。本文をコピーまたは Markdown 保存して退避してください。",
    );
  }
  return request as unknown as MutationRequest;
}

function invalid(): never {
  throw new ApiError(400, "INVALID_INPUT", "保存内容または更新条件が正しくありません。");
}

export async function readMutation(request: Request): Promise<MutationRequest> {
  if (
    request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
    "application/json"
  ) {
    throw new ApiError(415, "INVALID_CONTENT_TYPE", "JSON で送信してください。");
  }
  const reader = request.body?.getReader();
  if (!reader) invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new ApiError(
        413,
        "BODY_TOO_LARGE",
        "送信内容が大きすぎます。端末の本文を保持してください。",
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    invalid();
  }
  return validateMutation(parsed);
}
