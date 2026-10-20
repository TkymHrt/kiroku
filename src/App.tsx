import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  Copy,
  Download,
  ExternalLink,
  Home,
  LoaderCircle,
  LogOut,
  PenLine,
  Settings,
  ShieldCheck,
  Trash2,
  Undo2,
  X,
  AlertCircle,
} from "lucide-react";
import { DatePicker } from "./components/DatePicker";
import { ErrorNotice } from "./components/ErrorNotice";
import {
  AppRequestError,
  describeError,
  describeDraftProblem,
  errorReport,
  type ErrorOperation,
  type UiError,
} from "./lib/ui-errors";
import { DiarySyncEngine, type SaveStatus } from "./lib/sync";
import {
  bodyBytes,
  isDiaryDate,
  MAX_BODY_BYTES,
  tokyoToday,
  type DiaryListResponse,
  type DiarySummary,
} from "./lib/types";
const MarkdownEditor = lazy(() =>
  import("./components/MarkdownEditor").then((module) => ({
    default: module.MarkdownEditor,
  })),
);
const MarkdownPreview = lazy(() =>
  import("./components/MarkdownPreview").then((module) => ({
    default: module.MarkdownPreview,
  })),
);

type Page = "list" | "diary" | "trash" | "settings";
type DisplayIssue = {
  error: UiError;
  operation: ErrorOperation;
  retry?: () => Promise<void>;
};
type CopyContent = { text: string; title: string };
const stateLabels: Record<SaveStatus, string> = {
  saved: "保存済み",
  "local-saving": "端末保存中",
  local: "端末保存済み",
  syncing: "同期中",
  unsynced: "未同期",
  auth: "ログインが必要",
  conflict: "内容の確認が必要",
  error: "保存できていません",
};
const dateObject = (date: string) => new Date(`${date}T12:00:00+09:00`);
const weekdayTone = (date: string) => `weekday-tone weekday-tone-${dateObject(date).getUTCDay()}`;
const prettyDate = (
  date: string,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  },
) =>
  new Intl.DateTimeFormat("ja-JP", {
    ...options,
    timeZone: "Asia/Tokyo",
  }).format(dateObject(date));

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function downloadText(body: string, filename: string, type = "text/markdown;charset=utf-8") {
  downloadBlob(new Blob([body], { type }), filename);
}

function SaveState({
  status,
  empty = false,
  label,
}: {
  status: SaveStatus;
  empty?: boolean;
  label?: string;
}) {
  const Icon =
    status === "saved"
      ? CheckCheck
      : status === "syncing" || status === "local-saving"
        ? LoaderCircle
        : status === "local"
          ? Check
          : status === "unsynced"
            ? CloudOff
            : AlertCircle;
  return (
    <span className={`save-state state-${status}`} role="status">
      <Icon
        size={15}
        className={status === "syncing" || status === "local-saving" ? "spinning" : ""}
      />
      {label ?? (empty ? "まだ記録されていません" : stateLabels[status])}
    </span>
  );
}

function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="dialog"
      aria-label={title}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button aria-label="閉じる" className="icon-button" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function App() {
  const engineRef = useRef<DiarySyncEngine | null>(null);
  if (!engineRef.current) engineRef.current = new DiarySyncEngine();
  const engine = engineRef.current;
  const [tick, setTick] = useState(0);
  const [session, setSession] = useState<"loading" | "ready" | "locked" | "error">("loading");
  const [email, setEmail] = useState("");
  const [page, setPage] = useState<Page>("list");
  const [date, setDate] = useState(tokyoToday());
  const [dateInput, setDateInput] = useState(tokyoToday());
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [items, setItems] = useState<DiarySummary[]>([]);
  const [trashItems, setTrashItems] = useState<DiarySummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [trashCursor, setTrashCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [localError, setLocalError] = useState<UiError | null>(null);
  const [notice, setNotice] = useState("");
  const [issue, setIssue] = useState<DisplayIssue | null>(null);
  const [listFailure, setListFailure] = useState({ list: false, trash: false });
  const [needsAuth, setNeedsAuth] = useState(false);
  const [toast, setToast] = useState("");
  const [manualCopy, setManualCopy] = useState<CopyContent | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    label: string;
    action: () => Promise<void>;
  } | null>(null);
  const [neighbors, setNeighbors] = useState<{
    previous: string | null;
    next: string | null;
  }>({ previous: null, next: null });
  const [merge, setMerge] = useState<string | null>(null);
  const openSequence = useRef(0);
  const activeDate = useRef<string | null>(null);
  const localFailure = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sessionChannel = useRef<BroadcastChannel | null>(null);
  const authSequence = useRef(0);
  const copyField = useRef<HTMLTextAreaElement>(null);

  function lockDisplay() {
    ++authSequence.current;
    engine.stop();
    activeDate.current = null;
    // Commit the locked DOM before navigating to Access logout (including bfcache).
    flushSync(() => {
      setBody("");
      setMerge(null);
      setManualCopy(null);
      setConfirm(null);
      setPage("list");
      setSession("locked");
    });
  }

  const protect = (error: unknown) => {
    localFailure.current = true;
    setLocalError(describeError(error, "storage"));
  };
  const displayError = (
    error: unknown,
    operation: ErrorOperation = "operation",
    retry?: () => Promise<void>,
  ) => setIssue({ error: describeError(error, operation), operation, retry });
  const work = async (
    action: () => Promise<void>,
    operation: ErrorOperation = "operation",
    retry?: () => Promise<void>,
  ) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      displayError(error, operation, retry);
    } finally {
      setBusy(false);
    }
  };

  async function api<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "manual",
      credentials: "same-origin",
    });
    if (response.status === 401 || response.status === 403 || response.type === "opaqueredirect") {
      if (sessionRef.current === "ready") setNeedsAuth(true);
      else {
        engine.stop();
        setSession("locked");
      }
      throw new AppRequestError(response.status || 401, "AUTH_REQUIRED");
    }
    if (!response.ok) {
      let code = "SERVER_ERROR";
      try {
        const data = (await response.json()) as { code?: unknown };
        if (typeof data.code === "string") code = data.code;
      } catch {}
      throw new AppRequestError(response.status, code);
    }
    if (!response.headers.get("content-type")?.includes("application/json")) {
      if (sessionRef.current === "ready") setNeedsAuth(true);
      throw new AppRequestError(401, "AUTH_REQUIRED");
    }
    return response.json() as Promise<T>;
  }

  async function loadList(trash = false, append = false) {
    setLoading(true);
    try {
      const after = trash ? trashCursor : cursor;
      const response = await api<DiaryListResponse>(
        `/api/diaries?trash=${trash ? "1" : "0"}${append && after ? `&before=${encodeURIComponent(after)}` : ""}`,
      );
      const assign = trash ? setTrashItems : setItems;
      assign((previous) =>
        append
          ? [
              ...previous,
              ...response.items.filter((item) => !previous.some((p) => p.date === item.date)),
            ]
          : response.items,
      );
      (trash ? setTrashCursor : setCursor)(response.nextCursor);
      setListFailure((previous) => ({
        ...previous,
        [trash ? "trash" : "list"]: false,
      }));
      setNotice("");
      setIssue((previous) => (previous?.operation === "list" ? null : previous));
    } catch (error) {
      setListFailure((previous) => ({
        ...previous,
        [trash ? "trash" : "list"]: true,
      }));
      displayError(error, "list", () => loadList(trash, append));
    } finally {
      setLoading(false);
    }
  }

  async function authenticate() {
    const sequence = ++authSequence.current;
    setSession("loading");
    setIssue(null);
    try {
      const current = await api<{ authenticated: boolean; email: string }>("/api/session");
      if (!current.authenticated) throw new AppRequestError(401, "AUTH_REQUIRED");
      if (sequence !== authSequence.current) return;
      setEmail(current.email);
      await engine.start();
      if (sequence !== authSequence.current) {
        engine.stop();
        return;
      }
      setSession("ready");
      await loadList();
      if (activeDate.current) {
        await engine.open(activeDate.current);
        setBody(engine.getDraft(activeDate.current)?.body ?? "");
      }
    } catch (error) {
      if (sequence !== authSequence.current) return;
      engine.stop();
      setSession("error");
      displayError(error, "session", authenticate);
    }
  }

  useEffect(() => {
    const unsubscribe = engine.subscribe(() => setTick((value) => value + 1));
    void authenticate();
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("kiroku-session");
      sessionChannel.current = channel;
      channel.onmessage = (event) => {
        if (event.data === "logout") lockDisplay();
      };
    }
    const focus = () => {
      if (sessionRef.current !== "ready") return;
      void api<{ authenticated: boolean }>("/api/session").catch((error) => {
        // Losing connectivity while writing is handled by the save notice.
        if (error instanceof AppRequestError && error.status === 401)
          displayError(error, "session", resumeAfterLogin);
      });
    };
    window.addEventListener("focus", focus);
    return () => {
      unsubscribe();
      engine.stop();
      sessionChannel.current?.close();
      sessionChannel.current = null;
      window.removeEventListener("focus", focus);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Mount owns this subscription; callbacks read the current session and active date through refs.
  }, []);

  useEffect(() => {
    if (page === "diary" && !localFailure.current && !opening) {
      const draft = engine.getDraft(date);
      if (draft) setBody(draft.body);
    }
  }, [engine, tick, date, page, opening]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timeout);
  }, [toast]);

  async function canLeave(): Promise<boolean> {
    try {
      await engine.flushLocal();
      if (localFailure.current)
        throw new Error(
          "この画面の本文を端末に保存できていません。コピーまたはMarkdown保存で退避してから端末保存を再試行してください。",
        );
      return true;
    } catch (error) {
      protect(error);
      return false;
    }
  }

  async function navigate(target: Page) {
    if (!(await canLeave())) return;
    ++openSequence.current;
    setOpening(false);
    activeDate.current = null;
    setPage(target);
    setMerge(null);
    setNotice("");
    setIssue(null);
    if (target === "list" || target === "trash") await loadList(target === "trash");
    window.scrollTo({ top: 0 });
  }

  async function openDiary(target: string) {
    if (!isDiaryDate(target)) {
      displayError(new AppRequestError(400, "INVALID_DATE"), "open");
      return;
    }
    if (!(await canLeave())) return;
    const sequence = ++openSequence.current;
    activeDate.current = target;
    setDate(target);
    setDateInput(target);
    setMode("edit");
    setMerge(null);
    setPage("diary");
    setOpening(true);
    setNotice("");
    setIssue(null);
    setBody(engine.getDraft(target)?.body ?? "");
    let draft;
    try {
      draft = await engine.open(target);
    } catch (error) {
      if (sequence === openSequence.current) {
        setOpening(false);
        protect(error);
      }
      return;
    }
    if (sequence !== openSequence.current) return;
    setBody(draft.body);
    setOpening(false);
    window.scrollTo({ top: 0 });
    try {
      const response = await api<{
        previous: string | null;
        next: string | null;
      }>(`/api/diaries/${target}/neighbors`);
      if (sequence === openSequence.current) setNeighbors(response);
    } catch {
      if (sequence === openSequence.current) setNeighbors({ previous: null, next: null });
    }
  }

  function edit(next: string) {
    setBody(next);
    void engine.edit(date, next).catch(protect);
  }

  const drafts = engine.getDrafts();
  const current = engine.getDraft(date);
  const status = localError ? "error" : engine.getStatus(date);
  const deleted = !!current?.diary?.deletedAt;
  const unsynced = drafts.filter((draft) => draft.dirty || draft.pending);
  const byteCount = bodyBytes(body);
  const conflict = current?.problem && ["conflict", "recovery"].includes(current.problem.kind);
  const ageWarning =
    !!current?.unsyncedSince && Date.now() - Date.parse(current.unsyncedSince) >= 86_400_000;

  function mergedList(trash: boolean): DiarySummary[] {
    const result = new Map((trash ? trashItems : items).map((item) => [item.date, item]));
    for (const draft of drafts) {
      if (draft.tombstone) {
        result.delete(draft.date);
        continue;
      }
      if (draft.diary) {
        const listed = result.get(draft.date);
        const pending =
          draft.dirty ||
          draft.pending ||
          draft.problem?.kind === "conflict" ||
          draft.problem?.kind === "recovery" ||
          (draft.diary.id === listed?.id && draft.diary.version >= listed.version);
        if (!pending) continue;
        if (!!draft.diary.deletedAt === trash) result.set(draft.date, draft.diary);
        else result.delete(draft.date);
      } else if (!trash && (draft.body || draft.pending || draft.problem?.kind === "conflict")) {
        result.set(draft.date, {
          id: "",
          date: draft.date,
          version: 0,
          deletedAt: null,
          createdAt: draft.updatedAt,
          updatedAt: draft.updatedAt,
        });
      }
    }
    return [...result.values()].sort((a, b) => b.date.localeCompare(a.date));
  }

  const localDates = mergedList(false).map((item) => item.date);
  const previous = [
    ...localDates.filter((day) => day < date),
    ...(neighbors.previous ? [neighbors.previous] : []),
  ]
    .sort()
    .at(-1);
  const next = [
    ...localDates.filter((day) => day > date),
    ...(neighbors.next ? [neighbors.next] : []),
  ].sort()[0];

  async function copyText(text: string, title: string, success: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast(success);
    } catch {
      setManualCopy({ text, title });
    }
  }

  async function copy(text = body) {
    await copyText(text, "本文を選択してコピー", "Markdown全文をコピーしました。");
  }

  async function copyReport(error: UiError, operation: ErrorOperation) {
    await copyText(
      errorReport(error, operation),
      "エラー情報を選択してコピー",
      "エラー情報をコピーしました。本文やログイン情報は含みません。",
    );
  }

  async function resumeAfterLogin() {
    await api("/api/session");
    setNeedsAuth(false);
    await engine.retry();
    setIssue(null);
    setNotice("");
    if (page === "list" || page === "trash") await loadList(page === "trash");
  }

  async function retryStorage() {
    try {
      await engine.retry(date);
      await engine.flushLocal(date);
      localFailure.current = false;
      setLocalError(null);
      setIssue(null);
    } catch (error) {
      protect(error);
    }
  }

  async function exportDiaries() {
    type ExportPage = {
      formatVersion: number;
      exportedAt: string;
      epoch: string;
      snapshotToken: string;
      diaries: unknown[];
      nextCursor: string | null;
    };
    const first = await api<ExportPage>("/api/export");
    const header = JSON.stringify({
      formatVersion: first.formatVersion,
      exportedAt: first.exportedAt,
      epoch: first.epoch,
    });
    const parts: BlobPart[] = [header.slice(0, -1) + ',"diaries":[\n'];
    let count = 0;
    const append = (diaries: unknown[]) => {
      for (const diary of diaries)
        parts.push(
          new Blob([(count++ ? ",\n" : "") + JSON.stringify(diary)], {
            type: "application/json",
          }),
        );
    };
    append(first.diaries);
    let after = first.nextCursor;
    while (after) {
      const nextPage = await api<ExportPage>(
        `/api/export?after=${encodeURIComponent(after)}&snapshotToken=${encodeURIComponent(first.snapshotToken)}`,
      );
      if (nextPage.epoch !== first.epoch || nextPage.snapshotToken !== first.snapshotToken)
        throw new AppRequestError(409, "EXPORT_CHANGED");
      append(nextPage.diaries);
      after = nextPage.nextCursor;
    }
    parts.push("\n]}");
    downloadBlob(
      new Blob(parts, { type: "application/json;charset=utf-8" }),
      `kiroku-export-${tokyoToday()}.json`,
    );
    setIssue(null);
    setToast("JSONファイルを出力しました。");
  }

  function backupActions(emphasize = false) {
    return (
      <>
        <button
          className={`button ${emphasize ? "issue-primary" : "issue-secondary"}`}
          onClick={() => void copy()}
        >
          <Copy size={15} />
          本文をコピー
        </button>
        <button
          className="button issue-secondary"
          onClick={() => downloadText(body, `diary-${date}.md`)}
        >
          <Download size={15} />
          Markdown保存
        </button>
      </>
    );
  }

  async function applyMutation(kind: "trash" | "restore" | "purge") {
    await engine.mutate(date, kind);
    const result = engine.getDraft(date);
    if (result?.problem || result?.pending) {
      // The date's actionable save notice owns the failure and recovery steps.
      if (!result?.problem) setNotice("操作をこの端末に保存しました。接続が戻ると処理を続けます。");
      return;
    }
    if (kind === "purge" || kind === "trash") await navigate(kind === "purge" ? "trash" : "list");
    else {
      setBody(result?.body ?? "");
      setToast("日記を復元しました。");
    }
  }

  function resolveConflict(choice: "server" | "local" | "merge") {
    setConfirm({
      title: "この内容で競合を解決しますか",
      description:
        choice === "server"
          ? "端末版をサーバー版で置き換えます。残したい端末版は先にコピーまたはMarkdown保存してください。"
          : "サーバーの最新状態を再確認して、選んだ本文を保存します。",
      label:
        choice === "server"
          ? "サーバー版を採用"
          : choice === "local"
            ? "端末版を採用"
            : "統合した本文を保存",
      action: async () => {
        await engine.resolve(date, choice, merge ?? undefined);
        setBody(engine.getDraft(date)?.body ?? "");
        setMerge(null);
        setNotice("");
        setIssue(null);
      },
    });
  }

  function askLogout() {
    setConfirm({
      title: "ログアウトしますか",
      description: `${unsynced.length ? "未同期の下書きがあります。ログアウト後もこの端末に残ります。" : "この端末に保存された下書きは保持されます。"}共有する前に端末の状態を確認してください。`,
      label: "ログアウト",
      action: async () => {
        if (!(await canLeave())) return;
        sessionChannel.current?.postMessage("logout");
        lockDisplay();
        if (email !== "local-development") window.location.assign("/cdn-cgi/access/logout");
      },
    });
  }

  const list = mergedList(page === "trash");
  const readFailure = current?.problem?.kind === "network" && !current.dirty && !current.pending;
  const draftIssue = readFailure
    ? {
        ...describeError(new TypeError(), "open"),
        message: current.diary
          ? "この端末にある本文を表示しています。最新の本文を確認できていないため、接続を確認して日記を読み直してください。"
          : "サーバーの日記を確認できていません。インターネット接続を確認して、日記を読み直してください。",
      }
    : current?.problem
      ? describeDraftProblem(current.problem)
      : null;
  const authIssue = needsAuth
    ? {
        error: describeError(new AppRequestError(401, "AUTH_REQUIRED"), "session"),
        operation: "session" as const,
        retry: resumeAfterLogin,
      }
    : null;
  const globalIssue = issue ?? authIssue;
  const retryLabels: Record<ErrorOperation, string> = {
    session: "もう一度接続する",
    list: "一覧を読み直す",
    open: "日記を読み直す",
    export: "もう一度エクスポート",
    sync: "保存を再試行",
    storage: "端末保存を再試行",
    operation: "もう一度試す",
  };
  function renderIssue(display: DisplayIssue, sessionScreen = false) {
    const authentication = display.error.recovery === "auth";
    const retry = authentication && !sessionScreen ? resumeAfterLogin : display.retry;
    const retryAction = retry
      ? async () => {
          await retry();
          setIssue((previous) => (previous === display ? null : previous));
        }
      : undefined;
    return (
      <ErrorNotice
        issue={display.error}
        busy={busy}
        retry={retryAction ? () => void work(retryAction, display.operation, retry) : undefined}
        retryLabel={
          authentication
            ? sessionScreen
              ? "ログイン後に再確認"
              : "ログイン後に保存を再開"
            : retryLabels[display.operation]
        }
        onCopyReport={() => void copyReport(display.error, display.operation)}
      >
        {page === "diary" && !sessionScreen ? backupActions() : null}
      </ErrorNotice>
    );
  }
  const copyDialog =
    manualCopy !== null ? (
      <Modal title={manualCopy.title} close={() => setManualCopy(null)}>
        <p>
          自動でコピーできませんでした。下の内容をすべて選択し、長押しまたは右クリックでコピーしてください。
        </p>
        <textarea
          ref={copyField}
          className="copy-fallback"
          aria-label={manualCopy.title}
          value={manualCopy.text}
          readOnly
          rows={10}
          autoFocus
          onFocus={(event) => event.target.select()}
        />
        <div className="dialog-actions">
          <button
            className="button"
            onClick={() => {
              copyField.current?.focus();
              copyField.current?.select();
            }}
          >
            すべて選択
          </button>
          <button className="button primary" onClick={() => setManualCopy(null)}>
            閉じる
          </button>
        </div>
      </Modal>
    ) : null;
  let lastMonth = "";

  if (session !== "ready")
    return (
      <main className="session-page">
        <h1>きろく</h1>
        {session === "loading" ? (
          <p className="with-icon">
            <LoaderCircle size={18} className="spinning" />
            認証と端末内の下書きを確認中
          </p>
        ) : (
          <>
            {session === "error" && issue ? (
              renderIssue(issue, true)
            ) : (
              <>
                <h2>ログインして日記をひらく</h2>
                <p>保存済みの下書きはこの端末に残っています。ログイン後に日記を表示できます。</p>
                <div className="session-actions">
                  <a className="button primary" href="/" target="_blank" rel="noopener">
                    ログイン画面を開く
                    <ExternalLink size={16} />
                  </a>
                  <button className="button" onClick={() => void authenticate()}>
                    ログイン後に再確認
                  </button>
                </div>
              </>
            )}
            {(unsynced.length > 0 || localFailure.current) && (
              <p className="warning-text">
                未同期の本文があります。ブラウザのデータを消さないでください。
              </p>
            )}
          </>
        )}
        {toast && (
          <div className="toast" role="status">
            <Check size={17} />
            {toast}
          </div>
        )}
        {copyDialog}
      </main>
    );

  return (
    <div className={`app-shell ${page === "diary" ? "is-editing" : ""}`}>
      <aside className="sidebar">
        <button
          className="brand"
          aria-label="きろく 日記一覧へ"
          onClick={() => void navigate("list")}
        >
          きろく
        </button>
        <button
          className="button primary today-button"
          onClick={() => void openDiary(tokyoToday())}
        >
          <PenLine size={18} />
          今日の日記
          <ChevronRight size={16} />
        </button>
        <nav aria-label="メインナビゲーション">
          <button
            className={page === "list" || page === "diary" ? "nav-item active" : "nav-item"}
            onClick={() => void navigate("list")}
            aria-current={page === "list" || page === "diary" ? "page" : undefined}
          >
            <Home size={19} />
            日記一覧
          </button>
          <button
            className={page === "trash" ? "nav-item active" : "nav-item"}
            onClick={() => void navigate("trash")}
            aria-current={page === "trash" ? "page" : undefined}
          >
            <Trash2 size={19} />
            ゴミ箱
          </button>
          <button
            className={page === "settings" ? "nav-item active" : "nav-item"}
            onClick={() => void navigate("settings")}
            aria-current={page === "settings" ? "page" : undefined}
          >
            <Settings size={19} />
            設定
          </button>
        </nav>
        <div className="sidebar-bottom">
          <p className="with-icon">
            <ShieldCheck size={16} />
            自分だけの記録
          </p>
          <p>
            {unsynced.length
              ? `${unsynced.length}件がサーバー未同期`
              : email === "local-development"
                ? "ローカル開発環境"
                : "Cloudflare Accessで保護"}
          </p>
          <button className="text-button" onClick={askLogout}>
            <LogOut size={15} />
            ログアウト
          </button>
        </div>
      </aside>

      <div className="workspace">
        <main className={`main-content ${page === "diary" ? "diary-content" : ""}`}>
          {globalIssue &&
            !(
              page === "diary" &&
              (localError || (draftIssue && globalIssue.error.recovery === "auth"))
            ) &&
            renderIssue(globalIssue)}
          {notice && (
            <div className="banner" role="status">
              <CloudOff size={19} />
              <div>{notice}</div>
            </div>
          )}

          {(page === "list" || page === "trash") && (
            <>
              <h1 className="sr-only">{page === "trash" ? "ゴミ箱" : "日記一覧"}</h1>
              {page === "list" && (
                <div className="list-tools">
                  <DatePicker
                    value={dateInput}
                    label="日付を指定"
                    triggerText="日付からひらく"
                    onChange={(target) => {
                      setDateInput(target);
                      void openDiary(target);
                    }}
                  />
                </div>
              )}
              {page === "trash" && (
                <details className="inline-help">
                  <summary>ゴミ箱について</summary>
                  <p>
                    日記をひらくと復元・完全削除できます。自動では完全削除しません。同じ日付の日記を書く場合は、まず復元してください。
                  </p>
                </details>
              )}
              {unsynced.length > 0 && page === "list" && (
                <div className="sync-notice">
                  <CloudOff size={17} />
                  <span>{unsynced.length}件の変更を端末に保持しています。</span>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void work(() => engine.retry())}
                  >
                    同期を再試行
                  </button>
                </div>
              )}
              <div className="diary-list" aria-busy={loading}>
                {list.map((item) => {
                  const month = item.date.slice(0, 7);
                  const heading = month !== lastMonth;
                  lastMonth = month;
                  const draft = engine.getDraft(item.date);
                  return (
                    <div key={item.date}>
                      {heading && (
                        <h2 className="month-heading">
                          {prettyDate(item.date, {
                            year: "numeric",
                            month: "long",
                          })}
                        </h2>
                      )}
                      <button
                        className="diary-row"
                        onClick={() => void openDiary(item.date)}
                        aria-label={`${prettyDate(item.date)}の日記をひらく`}
                      >
                        <span className="day-number" aria-hidden="true">
                          {item.date.slice(8)}
                        </span>
                        <span className="row-date">
                          <span>
                            <span className={`weekday ${weekdayTone(item.date)}`}>
                              {prettyDate(item.date, { weekday: "long" })}
                            </span>
                            {item.date === tokyoToday() && <span className="today-tag">今日</span>}
                          </span>
                          <SaveState
                            label={
                              draft?.problem?.kind === "network" && !draft.dirty && !draft.pending
                                ? "読み込みできていません"
                                : undefined
                            }
                            status={draft ? engine.getStatus(item.date) : "saved"}
                          />
                        </span>
                        <ChevronRight size={19} />
                      </button>
                    </div>
                  );
                })}
                {!list.length && !loading && !listFailure[page === "trash" ? "trash" : "list"] && (
                  <div className="empty-state">
                    <p>{page === "trash" ? "ゴミ箱は空です" : "日記はまだありません"}</p>
                    {page === "list" && (
                      <button
                        className="button primary"
                        onClick={() => void openDiary(tokyoToday())}
                      >
                        今日の日記をひらく
                      </button>
                    )}
                  </div>
                )}
                {loading && (
                  <div className="loading-line">
                    <LoaderCircle size={19} className="spinning" />
                    読み込み中
                  </div>
                )}
                {(page === "trash" ? trashCursor : cursor) && (
                  <button
                    className="button load-more"
                    disabled={loading}
                    onClick={() => void loadList(page === "trash", true)}
                  >
                    続きを読み込む
                  </button>
                )}
              </div>
            </>
          )}

          {page === "diary" && (
            <>
              <div className="diary-heading">
                <button
                  className="icon-button back-button"
                  aria-label={`${deleted ? "ゴミ箱" : "日記一覧"}に戻る`}
                  title={`${deleted ? "ゴミ箱" : "日記一覧"}に戻る`}
                  onClick={() => void navigate(deleted ? "trash" : "list")}
                >
                  <ChevronLeft size={21} />
                </button>
                <div className="diary-date-group">
                  <h1 className="diary-date-title">
                    <DatePicker
                      value={date}
                      label="日付を変更"
                      compact
                      disabled={opening}
                      onChange={(target) => void openDiary(target)}
                    />
                  </h1>
                  <span className="diary-weekday">
                    <span className={weekdayTone(date)}>
                      {prettyDate(date, { weekday: "short" })}
                    </span>
                    {date === tokyoToday() ? " · 今日" : ""}
                  </span>
                </div>
                <button
                  className="icon-button diary-step"
                  aria-label="前の日記"
                  title="前の日記"
                  disabled={!previous || opening}
                  onClick={() => previous && void openDiary(previous)}
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  className="icon-button diary-step"
                  aria-label="次の日記"
                  title="次の日記"
                  disabled={!next || opening}
                  onClick={() => next && void openDiary(next)}
                >
                  <ChevronRight size={20} />
                </button>
                <SaveState
                  status={readFailure ? "unsynced" : status}
                  label={
                    opening ? "読み込み中" : readFailure ? "読み込みできていません" : undefined
                  }
                  empty={
                    !current?.diary && !body && !current?.dirty && !current?.problem && !opening
                  }
                />
              </div>
              {deleted && (
                <div className="banner">
                  <Trash2 size={19} />
                  <div>
                    この日記はゴミ箱にあります。編集するには復元してください。
                    <div className="banner-actions">
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          setConfirm({
                            title: "日記を復元しますか",
                            description: "サーバーの更新番号を確認して、通常の一覧に戻します。",
                            label: "復元する",
                            action: () => applyMutation("restore"),
                          })
                        }
                      >
                        <Undo2 size={16} />
                        復元する
                      </button>
                      <button
                        className="text-button danger"
                        disabled={busy}
                        onClick={() =>
                          setConfirm({
                            title: "この日記を完全削除しますか",
                            description:
                              "アプリからは元に戻せません。D1の復旧履歴や手元のバックアップには内容が残る場合があります。未同期の本文は先に退避してください。",
                            label: "完全削除する",
                            action: () => applyMutation("purge"),
                          })
                        }
                      >
                        完全削除
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {localError && (
                <ErrorNotice
                  issue={localError}
                  danger
                  busy={busy}
                  retry={() => void work(retryStorage, "storage")}
                  retryLabel="端末保存を再試行"
                  onCopyReport={() => void copyReport(localError, "storage")}
                >
                  {backupActions(true)}
                </ErrorNotice>
              )}
              {draftIssue && !conflict && !localError && byteCount <= MAX_BODY_BYTES && (
                <ErrorNotice
                  issue={draftIssue}
                  retryAfterUntil={current?.retryAfterUntil}
                  danger={current?.problem?.kind === "storage"}
                  busy={busy}
                  retry={() =>
                    void work(
                      current?.problem?.kind === "auth"
                        ? resumeAfterLogin
                        : () => engine.retry(date),
                      "sync",
                    )
                  }
                  retryLabel={
                    current?.problem?.kind === "auth"
                      ? "ログイン後に保存を再開"
                      : readFailure
                        ? "日記を読み直す"
                        : "保存を再試行"
                  }
                  onCopyReport={() => void copyReport(draftIssue, readFailure ? "open" : "sync")}
                >
                  {backupActions(current?.problem?.kind === "storage")}
                </ErrorNotice>
              )}
              {ageWarning && (
                <div className="banner">
                  <CloudOff size={19} />
                  <div>
                    24時間以上サーバーに保存されていません。本文をコピーまたはMarkdown保存して、手元にも退避してください。
                    <div className="banner-actions">{backupActions()}</div>
                  </div>
                </div>
              )}
              {byteCount > MAX_BODY_BYTES && (
                <ErrorNotice
                  issue={describeError(new AppRequestError(413, "BODY_TOO_LARGE"), "sync")}
                  danger
                  onCopyReport={() =>
                    void copyReport(
                      describeError(new AppRequestError(413, "BODY_TOO_LARGE"), "sync"),
                      "sync",
                    )
                  }
                >
                  {backupActions(true)}
                </ErrorNotice>
              )}
              {conflict && current && (
                <section className="conflict-panel" aria-label="競合の解決">
                  <h2>
                    <AlertCircle size={20} />
                    両方の記録を確認してください
                  </h2>
                  <p>{draftIssue?.message}</p>
                  {draftIssue && (
                    <button
                      className="text-button issue-report"
                      onClick={() => void copyReport(draftIssue, "sync")}
                    >
                      <Copy size={14} />
                      エラー情報をコピー
                    </button>
                  )}
                  <div className="conflict-version">
                    <h3>この端末の本文</h3>
                    <pre>{body || "（空の本文）"}</pre>
                    <div className="banner-actions">
                      <button className="text-button" onClick={() => void copy()}>
                        コピー
                      </button>
                      <button
                        className="text-button"
                        onClick={() => downloadText(body, `diary-${date}-local.md`)}
                      >
                        Markdown保存
                      </button>
                    </div>
                  </div>
                  <div className="conflict-version">
                    <h3>
                      サーバーの本文
                      {current.problem!.server?.deletedAt
                        ? "（ゴミ箱）"
                        : !current.problem!.server
                          ? "（日記なし・完全削除済みの可能性）"
                          : ""}
                    </h3>
                    <pre>{current.problem!.server?.body || "（空の本文）"}</pre>
                    <div className="banner-actions">
                      <button
                        className="text-button"
                        onClick={() => void copy(current.problem!.server?.body ?? "")}
                      >
                        コピー
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          downloadText(
                            current.problem!.server?.body ?? "",
                            `diary-${date}-server.md`,
                          )
                        }
                      >
                        Markdown保存
                      </button>
                    </div>
                  </div>
                  {merge !== null && (
                    <label className="merge-label">
                      統合するMarkdown
                      <textarea
                        value={merge}
                        onChange={(event) => setMerge(event.target.value)}
                        rows={10}
                      />
                    </label>
                  )}
                  <div className="conflict-actions">
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => resolveConflict("server")}
                    >
                      サーバー版を採用
                    </button>
                    <button
                      className="button"
                      disabled={busy || !!current.problem!.server?.deletedAt}
                      onClick={() => resolveConflict("local")}
                    >
                      端末版を採用
                    </button>
                    {merge === null ? (
                      <button className="button primary" onClick={() => setMerge(body)}>
                        手動で統合する
                      </button>
                    ) : (
                      <button
                        className="button primary"
                        disabled={busy || !!current.problem!.server?.deletedAt}
                        onClick={() => resolveConflict("merge")}
                      >
                        統合した本文を保存
                      </button>
                    )}
                  </div>
                  {current.problem!.server?.deletedAt && (
                    <p className="muted">
                      端末版を退避してからサーバー版を採用し、日記を復元して本文を統合してください。
                    </p>
                  )}
                </section>
              )}
              <div className="editor-surface">
                <div className="editor-top">
                  <div className="mode-tabs" role="tablist" aria-label="表示モード">
                    <button
                      role="tab"
                      id="edit-tab"
                      aria-selected={mode === "edit"}
                      aria-controls="edit-panel"
                      onClick={() => setMode("edit")}
                    >
                      編集
                    </button>
                    <button
                      role="tab"
                      id="preview-tab"
                      aria-selected={mode === "preview"}
                      aria-controls="preview-panel"
                      onClick={() => setMode("preview")}
                    >
                      プレビュー
                    </button>
                  </div>
                  <div className="editor-actions">
                    <button
                      aria-label="本文をコピー"
                      title="本文をコピー"
                      onClick={() => void copy()}
                    >
                      <Copy size={18} />
                    </button>
                    <button
                      aria-label="Markdownファイルを保存"
                      title="Markdownファイルを保存"
                      onClick={() => downloadText(body, `diary-${date}.md`)}
                    >
                      <Download size={18} />
                    </button>
                  </div>
                </div>
                {opening ? (
                  <div className="editor-loading">
                    <LoaderCircle size={21} className="spinning" />
                    日記を開いています
                  </div>
                ) : (
                  <Suspense
                    fallback={
                      <div className="editor-loading">
                        <LoaderCircle size={21} className="spinning" />
                        エディタを準備しています
                      </div>
                    }
                  >
                    <div
                      id="edit-panel"
                      role="tabpanel"
                      aria-labelledby="edit-tab"
                      hidden={mode !== "edit"}
                    >
                      <MarkdownEditor
                        key={date}
                        value={body}
                        onChange={edit}
                        hidden={mode !== "edit"}
                        readOnly={deleted}
                      />
                    </div>
                    <div
                      id="preview-panel"
                      role="tabpanel"
                      aria-labelledby="preview-tab"
                      hidden={mode !== "preview"}
                    >
                      {mode === "preview" && (
                        <MarkdownPreview body={body} onChange={edit} readOnly={deleted} />
                      )}
                    </div>
                  </Suspense>
                )}
                <div className="editor-footer">
                  <span>Markdown</span>
                  <span className={byteCount > MAX_BODY_BYTES ? "warning-text" : ""}>
                    {byteCount.toLocaleString("ja-JP")} / 1,000,000 bytes
                  </span>
                </div>
              </div>
              <div className="below-editor">
                {current?.diary && !deleted && (
                  <button
                    className="text-button danger"
                    disabled={busy || opening}
                    onClick={() =>
                      setConfirm({
                        title: "ゴミ箱へ移動しますか",
                        description:
                          "この日記を通常の一覧から外します。ゴミ箱から復元できます。未同期の本文は保存を確認してから移動します。",
                        label: "ゴミ箱へ移動",
                        action: () => applyMutation("trash"),
                      })
                    }
                  >
                    <Trash2 size={15} />
                    ゴミ箱へ移動
                  </button>
                )}
              </div>
            </>
          )}

          {page === "settings" && (
            <>
              <h1 className="sr-only">設定</h1>
              <section className="settings-section">
                <h2>
                  <Download size={20} />
                  データのエクスポート
                </h2>
                <p>保存済みの日記を、ゴミ箱も含めてJSONで持ち出せます。</p>
                <p className="muted">
                  完全削除済みの日記と、この端末だけにある未同期の変更は含みません。未同期の本文は日記画面から個別にコピー・Markdown保存できます。
                </p>
                {unsynced.length > 0 && (
                  <p className="warning-text">
                    現在、{unsynced.length}件の未同期データがあります。
                  </p>
                )}
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void work(exportDiaries, "export", exportDiaries)}
                >
                  <Download size={17} />
                  JSONを一括エクスポート
                </button>
              </section>
              <section className="settings-section">
                <h2>
                  <Cloud size={20} />
                  保存について
                </h2>
                <dl className="settings-details">
                  <dt>サーバー</dt>
                  <dd>Cloudflare D1</dd>
                  <dt>端末内下書き</dt>
                  <dd>このブラウザのIndexedDB</dd>
                  <dt>未同期の日記</dt>
                  <dd>
                    {unsynced.length}件
                    <button
                      className="text-button inline-button"
                      disabled={busy}
                      onClick={() => void work(() => engine.retry())}
                    >
                      同期を再試行
                    </button>
                  </dd>
                  <dt>記録の日付</dt>
                  <dd>日本時間（Asia/Tokyo）</dd>
                  <dt>本文の上限</dt>
                  <dd>1日あたり1,000,000バイト</dd>
                </dl>
                <p className="muted">
                  ブラウザのデータを消すと、未同期の下書きも削除されます。長く同期できない場合は、手動で退避してください。
                </p>
              </section>
              <section className="settings-section">
                <h2>
                  <ShieldCheck size={20} />
                  アクセス
                </h2>
                <p>
                  {email === "local-development"
                    ? "ローカル開発環境です。公開環境では本人のCloudflare Access認証が必要です。"
                    : email}
                </p>
                <p className="muted">
                  本人専用端末での利用を前提としています。下書きの追加パスフレーズ暗号化は行っていません。
                </p>
                <button className="button" onClick={askLogout}>
                  <LogOut size={16} />
                  ログアウト
                </button>
              </section>
            </>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {copyDialog}
      {confirm && (
        <Modal title={confirm.title} close={() => !busy && setConfirm(null)}>
          <p>{confirm.description}</p>
          <div className="dialog-actions">
            <button className="button" disabled={busy} onClick={() => setConfirm(null)}>
              キャンセル
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  try {
                    await confirm.action();
                  } finally {
                    setConfirm(null);
                  }
                })
              }
            >
              {busy && <LoaderCircle size={16} className="spinning" />}
              {confirm.label}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
