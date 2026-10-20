/** Wire format shared by the browser and the Workers API. Dates are Tokyo civil days. */
export interface Diary {
  id: string;
  date: string;
  body: string;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DiarySummary = Omit<Diary, "body">;
export type MutationKind = "create" | "update" | "trash" | "restore" | "purge";

export interface MutationRequest {
  mutationId: string;
  kind: MutationKind;
  id: string | null;
  expectedVersion: number | null;
  body?: string;
  epoch: string;
  /** Required for create: last observed mutation for an absent date, null for a never-used date. */
  absenceToken?: string | null;
}

export interface MutationResponse {
  diary: Diary | null;
  epoch: string;
  absenceToken: string | null;
  mutationId: string;
  appliedVersion: number | null;
  appliedDiaryId: string;
  replayed: boolean;
}

export interface DiaryResponse {
  diary: Diary | null;
  epoch: string;
  absenceToken: string | null;
}
export interface DiaryListResponse {
  items: DiarySummary[];
  nextCursor: string | null;
  epoch: string;
}
export interface ApiProblem {
  code: string;
  message: string;
  diary?: Diary | null;
  epoch?: string;
  absenceToken?: string | null;
}
export const MAX_BODY_BYTES = 1_000_000;
export const bodyBytes = (body: string): number => new TextEncoder().encode(body).byteLength;

export function tokyoToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join("-");
}

export function isDiaryDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
