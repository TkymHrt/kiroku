import type { Diary } from "../src/lib/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public diary?: Diary | null,
    public epoch?: string,
    public absenceToken?: string | null,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      {
        code: error.code,
        message: error.message,
        ...(error.diary !== undefined ? { diary: error.diary } : {}),
        ...(error.epoch ? { epoch: error.epoch } : {}),
        ...(error.absenceToken !== undefined ? { absenceToken: error.absenceToken } : {}),
      },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  // Database errors can contain SQL parameters. Do not log the exception or expose it.
  return Response.json(
    {
      code: "TEMPORARY_FAILURE",
      message: "サーバー保存に失敗しました。端末の本文を保持して再試行します。",
    },
    { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } },
  );
}
