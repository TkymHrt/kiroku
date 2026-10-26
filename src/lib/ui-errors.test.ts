import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DraftRevisionConflict, type DraftProblem } from "./drafts";
import {
  AppRequestError,
  describeDraftProblem,
  describeError,
  errorReport,
  type ErrorOperation,
  type UiError,
} from "./ui-errors";

afterEach(() => vi.useRealTimers());

describe("plain-language error guidance", () => {
  it.each([
    ["session", "アプリに接続できません"],
    ["list", "一覧を読み込めませんでした"],
    ["open", "日記を読み込めませんでした"],
    ["export", "ファイルを作成できませんでした"],
    ["sync", "サーバーに保存できていません"],
  ] as const)(
    "explains a lost connection during %s without leaking browser exception text",
    (operation, title) => {
      const result = describeError(
        new TypeError("Failed to fetch: https://example.com/private?token=secret"),
        operation,
      );
      expect(result).toMatchObject({
        title,
        code: "NETWORK_UNAVAILABLE",
        recovery: "retry",
      });
      expect(result.message).toContain("インターネット接続");
      expect(JSON.stringify(result)).not.toMatch(/Failed to fetch|https:|token|secret/);
    },
  );

  it.each([401, 403])(
    "provides reauthentication for HTTP %s with the current operation title",
    (status) => {
      expect(describeError(new AppRequestError(status, "AUTH_REQUIRED"), "list")).toMatchObject({
        title: "一覧を読み込めませんでした",
        code: "AUTH_REQUIRED",
        recovery: "auth",
        status,
      });
    },
  );

  it("distinguishes temporary failures, limits and interrupted exports", () => {
    expect(describeError(new AppRequestError(429, "SECRET_UNKNOWN"), "export")).toMatchObject({
      code: "RATE_LIMITED",
      recovery: "retry",
      status: 429,
    });
    expect(describeError(new AppRequestError(503, "SERVER_ERROR"), "list")).toMatchObject({
      code: "SERVER_UNAVAILABLE",
      recovery: "retry",
    });
    expect(describeError(new AppRequestError(504, "SERVER_ERROR"), "open")).toMatchObject({
      code: "REQUEST_TIMEOUT",
      recovery: "retry",
    });
    expect(describeError(new AppRequestError(409, "EXPORT_CHANGED"), "export")).toMatchObject({
      code: "EXPORT_CHANGED",
      recovery: "retry",
    });
    expect(describeError(new AppRequestError(409, "EXPORT_CHANGED"), "export").message).toContain(
      "保存が終わってから",
    );
  });

  it.each([
    [413, "BODY_TOO_LARGE", "none"],
    [400, "INVALID_DATE", "none"],
    [400, "INVALID_INPUT", "none"],
    [400, "INVALID_LIMIT", "none"],
    [415, "INVALID_CONTENT_TYPE", "none"],
    [403, "CSRF_REJECTED", "auth"],
    [503, "AUTH_NOT_CONFIGURED", "none"],
    [503, "DATABASE_NOT_READY", "retry"],
    [409, "CONFLICT", "none"],
    [409, "EPOCH_CHANGED", "none"],
    [409, "RECOVERY_REQUIRED", "none"],
  ] as const)(
    "maps the known %s %s condition to an actionable explanation",
    (status, code, recovery) => {
      const result = describeError(new AppRequestError(status, code), "operation");
      expect(result).toMatchObject({ code, recovery, status });
      expect(result.message).toMatch(/[ぁ-んァ-ン一-龯]/);
      expect(result.message).not.toContain(code);
    },
  );

  it("protects oversized text before asking the user to shorten it", () => {
    const result = describeError(new AppRequestError(413, "BODY_TOO_LARGE"), "sync");
    expect(result.message).toContain("1,000,000バイト");
    expect(result.message.indexOf("まず本文をコピー")).toBeLessThan(
      result.message.indexOf("本文を短く"),
    );
    expect(result.recovery).toBe("none");
  });

  it("distinguishes storage exhaustion and concurrent local edits from server or network failure", () => {
    const full = describeError(new DOMException("secret text", "QuotaExceededError"), "storage");
    expect(full).toMatchObject({
      code: "LOCAL_STORAGE_FULL",
      recovery: "retry",
    });
    expect(full.message).toContain("空き容量");
    expect(full.message).toContain("画面を閉じず");
    expect(describeError(new Error("unknown storage internals"), "storage")).toMatchObject({
      code: "LOCAL_STORAGE_UNAVAILABLE",
      recovery: "retry",
    });
    const conflict = describeError(new DraftRevisionConflict(null), "storage");
    expect(conflict).toMatchObject({
      code: "LOCAL_DRAFT_CHANGED",
      recovery: "none",
    });
    expect(conflict.message).toContain("新しい下書き");
    expect(conflict.message).not.toContain("空き容量");
  });

  it("keeps local save guards actionable without exposing arbitrary Japanese exceptions", () => {
    expect(
      describeError(
        new Error(
          "端末内保存が完了していません。本文をコピーまたはMarkdown保存してから移動してください。",
        ),
        "open",
      ).code,
    ).toBe("LOCAL_STORAGE_UNAVAILABLE");
    expect(
      describeError(new Error("保存または競合解決を完了してから操作してください。"), "operation"),
    ).toMatchObject({ code: "SAVE_REQUIRED", recovery: "none" });
    expect(
      describeError(
        new Error("サーバー版が再び更新されました。新しい内容を確認してください。"),
        "operation",
      ),
    ).toMatchObject({ code: "CONFLICT", recovery: "none" });
    expect(
      describeError(
        new Error(
          "サーバー版はゴミ箱内にあります。サーバー版を採用して復元し、退避した本文を統合してください。",
        ),
        "operation",
      ),
    ).toMatchObject({ code: "TRASH_RESTORE_REQUIRED", recovery: "none" });
    const result = describeError(
      new Error("個人の日記とメールアドレス: secret@example.com"),
      "operation",
    );
    expect(result.code).toBe("UNKNOWN_ERROR");
    expect(JSON.stringify(result)).not.toContain("secret@example.com");
  });
});

describe("durable draft guidance", () => {
  it.each([
    ["network", "NETWORK_UNAVAILABLE", "retry"],
    ["auth", "AUTH_REQUIRED", "auth"],
    ["validation", "INVALID_INPUT", "none"],
    ["storage", "LOCAL_STORAGE_UNAVAILABLE", "retry"],
    ["conflict", "CONFLICT", "none"],
    ["recovery", "RECOVERY_REQUIRED", "none"],
  ] as const)(
    "provides safe guidance for %s without displaying the persisted raw problem message",
    (kind, code, recovery) => {
      const problem: DraftProblem = {
        kind,
        message: "Failed to fetch secret diary token=private https://private.example",
        epoch: "sensitive-epoch",
      };
      const result = describeDraftProblem(problem);
      expect(result).toMatchObject({ code, recovery });
      expect(JSON.stringify(result)).not.toMatch(/Failed|secret|token|private|sensitive-epoch/);
    },
  );

  it("makes saved local text and text that may exist only on screen clearly different", () => {
    expect(describeDraftProblem({ kind: "network", message: "" }).message).toContain(
      "この端末に保存されています",
    );
    expect(describeDraftProblem({ kind: "storage", message: "" }).message).toContain(
      "この画面にだけ残っている可能性",
    );
    for (const kind of ["conflict", "recovery"] as const) {
      const message = describeDraftProblem({ kind, message: "" }).message;
      expect(message).toContain("両方の本文");
      expect(message).toContain("この下にある");
    }
  });
});

describe("privacy-preserving error copying", () => {
  it("copies only the safe operational facts needed for troubleshooting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T05:06:07.000Z"));
    const result = errorReport(
      describeError(new AppRequestError(503, "SERVER_ERROR"), "export"),
      "export",
    );
    expect(result).toBe(
      [
        "きろく エラー情報",
        "操作: 日記の一括出力",
        "分類: SERVER_UNAVAILABLE",
        "HTTP: 503",
        "コピー日時: 2026-10-18T05:06:07.000Z",
        "表示: ファイルを作成できませんでした",
      ].join("\n"),
    );
  });

  it("never reflects unknown API codes, arbitrary titles, messages, URL, email, tokens or stacks", () => {
    const privateText =
      "diary-private https://private.example?token=abc secret@example.com at app.ts:42";
    const malicious: UiError = {
      title: privateText,
      message: privateText,
      code: privateText,
      status: 503,
      recovery: "retry",
    };
    const report = errorReport(malicious, "operation");
    expect(report).toContain("分類: UNKNOWN_ERROR");
    expect(report).toContain("表示: 操作を完了できませんでした");
    expect(report).not.toMatch(/diary-private|https:|token|secret@|app.ts|abc/);
    const request = describeError(new AppRequestError(400, `INVALID_${privateText}`), "operation");
    expect(request.code).toBe("INVALID_INPUT");
    expect(errorReport(request, "operation")).not.toContain(privateText);
  });

  it("copies no invalid status or fallback exception details for every operation", () => {
    for (const operation of [
      "session",
      "list",
      "open",
      "export",
      "sync",
      "storage",
      "operation",
    ] satisfies ErrorOperation[]) {
      const exception = new Error("private diary");
      exception.stack = "private stack with token";
      const result = errorReport(describeError(exception, operation), operation);
      expect(result).not.toMatch(/private|stack|token|HTTP:/);
    }
    const invalid = describeError(new AppRequestError(NaN, "private"), "list");
    expect(errorReport(invalid, "list")).not.toMatch(/NaN|private|HTTP:/);
  });
});
