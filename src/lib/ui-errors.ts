import { DraftRevisionConflict, type DraftProblem } from "./drafts";

export type ErrorOperation =
  | "session"
  | "list"
  | "open"
  | "export"
  | "sync"
  | "storage"
  | "operation";

/** Only HTTP status and a classification cross the UI boundary, never a server message. */
export class AppRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("アプリへの要求を完了できませんでした。");
    this.name = "AppRequestError";
  }
}

export interface UiError {
  title: string;
  message: string;
  recovery: "retry" | "auth" | "none";
  code: string;
  status?: number;
}

const titles: Record<ErrorOperation, string> = {
  session: "アプリに接続できません",
  list: "一覧を読み込めませんでした",
  open: "日記を読み込めませんでした",
  export: "ファイルを作成できませんでした",
  sync: "サーバーに保存できていません",
  storage: "この端末に保存できていません",
  operation: "操作を完了できませんでした",
};

const operations: Record<ErrorOperation, string> = {
  session: "アプリへの接続",
  list: "日記一覧の読み込み",
  open: "日記の読み込み",
  export: "日記の一括出力",
  sync: "日記のサーバー保存",
  storage: "日記の端末内保存",
  operation: "日記の操作",
};

const safeCodes = new Set([
  "AUTH_REQUIRED",
  "AUTH_NOT_CONFIGURED",
  "BODY_TOO_LARGE",
  "CONFLICT",
  "CSRF_REJECTED",
  "DATABASE_NOT_READY",
  "EPOCH_CHANGED",
  "EXPORT_CHANGED",
  "INVALID_CONTENT_TYPE",
  "INVALID_DATE",
  "INVALID_INPUT",
  "INVALID_LIMIT",
  "LOCAL_DRAFT_CHANGED",
  "LOCAL_STORAGE_FULL",
  "LOCAL_STORAGE_UNAVAILABLE",
  "NETWORK_UNAVAILABLE",
  "NOT_FOUND",
  "RATE_LIMITED",
  "RECOVERY_REQUIRED",
  "REQUEST_REJECTED",
  "REQUEST_TIMEOUT",
  "SAVE_REQUIRED",
  "SERVER_UNAVAILABLE",
  "TRASH_RESTORE_REQUIRED",
  "UNKNOWN_ERROR",
]);

const conflictTitle = "別の画面で日記が変更されています";
const recoveryTitle = "日記の保存状態を確認してください";

function httpStatus(value: number): number | undefined {
  return Number.isInteger(value) && value >= 400 && value <= 599 ? value : undefined;
}

function issue(
  operation: ErrorOperation,
  code: string,
  message: string,
  recovery: UiError["recovery"] = "retry",
  status?: number,
): UiError {
  return {
    title: titles[operation],
    message,
    recovery,
    code,
    ...(status === undefined ? {} : { status }),
  };
}

function localStorageIssue(full = false): UiError {
  return issue(
    "storage",
    full ? "LOCAL_STORAGE_FULL" : "LOCAL_STORAGE_UNAVAILABLE",
    full
      ? "端末の保存容量が足りません。本文はこの画面にだけ残っている可能性があります。画面を閉じず、まず本文をコピーするかファイルに保存してください。その後、端末の空き容量を確認してください。"
      : "本文はこの画面にだけ残っている可能性があります。画面を閉じたり日付を移動したりせず、まず本文をコピーするかファイルに保存してください。",
    "retry",
  );
}

function localConflictIssue(): UiError {
  return {
    title: conflictTitle,
    code: "LOCAL_DRAFT_CHANGED",
    recovery: "none",
    message:
      "別の画面に新しい下書きがあります。この画面の本文をコピーするかファイルに保存してから、ほかの画面の変更を確認してください。確認するまで、この画面を閉じないでください。",
  };
}

export function describeError(error: unknown, operation: ErrorOperation): UiError {
  if (error instanceof DraftRevisionConflict) return localConflictIssue();

  const name = error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED")
    return localStorageIssue(true);

  // These are app-owned, fixed messages from guards in the sync engine. Unrecognized
  // messages, including other Japanese text, never become user copy or diagnostics.
  if (error instanceof Error && !(error instanceof AppRequestError)) {
    switch (error.message) {
      case "Invalid server response":
        return issue(
          operation,
          "SERVER_UNAVAILABLE",
          "アプリからの応答を確認できませんでした。少し待ってからもう一度お試しください。編集中の本文はそのままにしてください。",
        );
      case "端末内保存が完了していません。本文をコピーまたはMarkdown保存してから移動してください。":
        return localStorageIssue();
      case "別の画面に新しい端末内下書きがあります。この画面の本文をコピーまたはMarkdown保存し、ほかの画面の変更を確認してから再読み込みしてください。":
        return localConflictIssue();
      case "保存または競合解決を完了してから操作してください。":
        return issue(
          operation,
          "SAVE_REQUIRED",
          "まだ保存できていない変更があります。まず本文をコピーするかファイルに保存してください。保存エラーや、両方の本文を確認する案内があれば解決してから操作してください。",
          "none",
        );
      case "サーバー版が再び更新されました。新しい内容を確認してください。":
        return {
          ...describeDraftProblem({ kind: "conflict", message: "" }),
          message:
            "確認中に、別の画面で日記が更新されました。もう一度、端末とサーバーの両方の本文を確認してから、残す内容を選んでください。",
        };
      case "サーバー版はゴミ箱内にあります。サーバー版を採用して復元し、退避した本文を統合してください。":
        return issue(
          operation,
          "TRASH_RESTORE_REQUIRED",
          "この日記はゴミ箱にあります。まずこの画面の本文をコピーするかファイルに保存してください。その後、サーバー側の内容を選んで日記を復元し、退避した本文を追加してください。",
          "none",
        );
    }
  }

  if (operation === "storage") return localStorageIssue();
  if (error instanceof AppRequestError) {
    const status = httpStatus(error.status);
    const code = safeCodes.has(error.code)
      ? error.code
      : error.code.startsWith("INVALID_")
        ? "INVALID_INPUT"
        : "";
    switch (code) {
      case "CSRF_REJECTED":
        return issue(
          operation,
          code,
          "開いている画面の認証を確認できませんでした。再ログインして、この画面に戻ってからもう一度お試しください。下書きは削除されません。",
          "auth",
          status,
        );
      case "AUTH_NOT_CONFIGURED":
        return issue(
          operation,
          code,
          "アプリの認証設定に問題があり、利用できません。エラー情報をコピーして、アプリの設定を確認してください。",
          "none",
          status,
        );
      case "DATABASE_NOT_READY":
        return issue(
          operation,
          code,
          "日記の保存先を利用できません。少し待ってからもう一度お試しください。解決しない場合は、エラー情報をコピーして確認に使えます。",
          "retry",
          status,
        );
      case "EXPORT_CHANGED":
        return issue(
          operation,
          code,
          "ファイルの作成中に日記が更新されました。編集の保存が終わってから、もう一度ファイルを作成してください。",
          "retry",
          status,
        );
      case "BODY_TOO_LARGE":
        return issue(
          operation,
          code,
          "本文が保存できる上限（1,000,000バイト）を超えています。まず本文をコピーするかファイルに保存し、その後、本文を短くしてください。本文は自動で切り詰められません。",
          "none",
          status,
        );
      case "CONFLICT":
        return {
          ...describeDraftProblem({ kind: "conflict", message: "" }),
          ...(status === undefined ? {} : { status }),
        };
      case "EPOCH_CHANGED":
      case "RECOVERY_REQUIRED":
        return {
          ...describeDraftProblem({ kind: "recovery", message: "" }),
          code,
          ...(status === undefined ? {} : { status }),
        };
      case "INVALID_DATE":
        return issue(
          operation,
          code,
          "日付を確認できませんでした。カレンダーから日付を選び直してください。",
          "none",
          status,
        );
      case "INVALID_INPUT":
      case "INVALID_LIMIT":
      case "INVALID_CONTENT_TYPE":
        return issue(
          operation,
          code,
          "送信内容を確認できませんでした。編集中の本文をコピーするかファイルに保存し、入力内容と保存状態を確認してください。",
          "none",
          status,
        );
    }
    if (status === 401 || status === 403 || code === "AUTH_REQUIRED") {
      return issue(
        operation,
        "AUTH_REQUIRED",
        "ログインの有効期限が切れたか、本人確認が必要です。再ログインしてこの画面に戻り、保存状態を確認してください。下書きは削除されません。",
        "auth",
        status,
      );
    }
    if (status === 429)
      return issue(
        operation,
        "RATE_LIMITED",
        "アクセスが集中しています。少し待ってからもう一度お試しください。編集中の本文はそのままにしてください。",
        "retry",
        status,
      );
    if (status === 408 || status === 504)
      return issue(
        operation,
        "REQUEST_TIMEOUT",
        "接続に時間がかかり、結果を確認できませんでした。少し待ってからもう一度お試しください。",
        "retry",
        status,
      );
    if (status !== undefined && status >= 500)
      return issue(
        operation,
        "SERVER_UNAVAILABLE",
        "アプリの保存先に一時的につながりません。少し待ってからもう一度お試しください。編集中の本文はそのままにしてください。",
        "retry",
        status,
      );
    if (status === 404)
      return issue(
        operation,
        "NOT_FOUND",
        "対象の日記を確認できませんでした。編集中の本文があれば退避してから、一覧で日記の状態を確認してください。",
        "none",
        status,
      );
    if (status === 409)
      return {
        ...describeDraftProblem({ kind: "conflict", message: "" }),
        status,
      };
    if (status !== undefined)
      return issue(
        operation,
        "REQUEST_REJECTED",
        "操作内容を確認できませんでした。編集中の本文があればコピーするかファイルに保存してから、入力内容と日記の状態を確認してください。",
        "none",
        status,
      );
  }

  if (error instanceof TypeError || name === "AbortError" || name === "TimeoutError") {
    return issue(
      operation,
      "NETWORK_UNAVAILABLE",
      "アプリに接続できません。インターネット接続を確認して、もう一度お試しください。編集中の本文はそのままにしてください。",
    );
  }
  return issue(
    operation,
    "UNKNOWN_ERROR",
    "操作を続けられませんでした。少し待ってからもう一度お試しください。解決しない場合は、エラー情報をコピーして確認に使えます。",
  );
}

export function describeDraftProblem(problem: DraftProblem): UiError {
  switch (problem.kind) {
    case "auth":
      return issue(
        "sync",
        "AUTH_REQUIRED",
        "ログインの有効期限が切れたか、本人確認が必要です。下書きはこの端末に残っています。再ログインしてこの画面に戻り、保存状態を確認してください。",
        "auth",
      );
    case "network":
      return issue(
        "sync",
        "NETWORK_UNAVAILABLE",
        "本文はこの端末に保存されています。インターネット接続が戻ると、自動でサーバーへの保存をやり直します。保存を再試行することもできます。",
      );
    case "validation":
      return issue(
        "sync",
        "INVALID_INPUT",
        "本文の長さや内容を確認してください。本文は端末に残っています。まず本文をコピーするかファイルに保存してから、必要な修正を行ってください。",
        "none",
      );
    case "storage":
      return localStorageIssue();
    case "conflict":
      return {
        title: conflictTitle,
        code: "CONFLICT",
        recovery: "none",
        message:
          "端末とサーバーに異なる内容があります。どちらも自動で上書きせずに残しています。この下にある両方の本文を見て、残す内容を選んでください。",
      };
    case "recovery":
      return {
        title: recoveryTitle,
        code: "RECOVERY_REQUIRED",
        recovery: "none",
        message:
          "保存先の日記の状態が変わったため、自動保存を止めています。この下にある端末とサーバーの両方の本文を見て、残す内容を選んでください。",
      };
  }
}

/** An allowlist keeps diagnostic copying useful without exporting diary or account data. */
export function errorReport(error: UiError, operation: ErrorOperation): string {
  const code = safeCodes.has(error.code) ? error.code : "UNKNOWN_ERROR";
  const status = httpStatus(error.status ?? 0);
  const safeTitle = [...Object.values(titles), conflictTitle, recoveryTitle].includes(error.title)
    ? error.title
    : titles[operation];
  return [
    "きろく エラー情報",
    `操作: ${operations[operation]}`,
    `分類: ${code}`,
    ...(status === undefined ? [] : [`HTTP: ${status}`]),
    `コピー日時: ${new Date().toISOString()}`,
    `表示: ${safeTitle}`,
  ].join("\n");
}
