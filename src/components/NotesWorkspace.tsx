import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Copy,
  Download,
  ListTodo,
  LoaderCircle,
  Pin,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
  X,
  AlertCircle,
} from "lucide-react";
import { type DiarySyncEngine, type SaveStatus } from "../lib/sync";
import {
  decodeNote,
  encodeNote,
  emptyNote,
  noteTitle,
  summarizeNote,
  type Note,
  type NoteContent,
  type NoteListResponse,
  type NoteScope,
  type NoteSummary,
} from "../lib/notes";

const MarkdownEditor = lazy(() =>
  import("./MarkdownEditor").then((module) => ({ default: module.MarkdownEditor })),
);
const MarkdownPreview = lazy(() =>
  import("./MarkdownPreview").then((module) => ({ default: module.MarkdownPreview })),
);
const labels: Record<SaveStatus, string> = {
  saved: "保存済み",
  "local-saving": "端末保存中",
  local: "端末保存済み",
  syncing: "同期中",
  unsynced: "未同期",
  auth: "ログインが必要",
  conflict: "内容の確認が必要",
  error: "保存できていません",
};
const scopeLabels: Record<NoteScope, string> = {
  active: "メモ",
  archived: "しまったメモ",
  trash: "メモのゴミ箱",
};
function NoteSaveState({ status, empty = false }: { status: SaveStatus; empty?: boolean }) {
  const Icon =
    status === "saved"
      ? CheckCheck
      : status === "local"
        ? Check
        : status === "syncing" || status === "local-saving"
          ? LoaderCircle
          : status === "unsynced"
            ? CloudOff
            : AlertCircle;
  return (
    <span className={`save-state state-${status}`} role="status">
      <Icon
        size={15}
        className={status === "syncing" || status === "local-saving" ? "spinning" : undefined}
      />
      {empty ? "まだメモは作成されていません" : labels[status]}
    </span>
  );
}
function saveMarkdown(content: NoteContent, id: string) {
  const url = URL.createObjectURL(
    new Blob([content.body], { type: "text/markdown;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `note-${id}.md`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
function noteDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

export function NotesWorkspace({
  engine,
  newRequest,
  onEditingChange,
  onAuthenticate,
}: {
  engine: DiarySyncEngine;
  newRequest: number;
  onEditingChange: (editing: boolean) => void;
  onAuthenticate: () => Promise<void>;
}) {
  const [tick, setTick] = useState(0);
  const [scope, setScope] = useState<NoteScope>("active");
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<NoteSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<NoteContent>(emptyNote);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [opening, setOpening] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [manualCopy, setManualCopy] = useState(false);
  const [merge, setMerge] = useState<NoteContent | null>(null);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    label: string;
    action: () => Promise<void>;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const listSequence = useRef(0);
  const openSequence = useRef(0);
  const titleInput = useRef<HTMLInputElement>(null);
  const latestContent = useRef(content);
  latestContent.current = content;

  useEffect(() => engine.subscribe(() => setTick((value) => value + 1)), [engine]);
  useEffect(() => {
    onEditingChange(selected !== null);
    return () => onEditingChange(false);
  }, [selected, onEditingChange]);
  useEffect(() => {
    if (!selected || opening) return;
    const draft = engine.getDraft(selected);
    if (draft) setContent(decodeNote(draft.body));
  }, [selected, opening, tick, engine]);
  useEffect(() => {
    if (confirmation) dialog.current?.showModal();
  }, [confirmation]);

  async function load(append = false) {
    const sequence = ++listSequence.current;
    setLoading(true);
    try {
      const response = await fetch("/api/notes/query", {
        method: "POST",
        credentials: "same-origin",
        redirect: "manual",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Kiroku-CSRF": "1" },
        body: JSON.stringify({ scope, query, cursor: append ? cursor : "" }),
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
        throw new Error();
      const page = (await response.json()) as NoteListResponse;
      if (sequence !== listSequence.current) return;
      setRemote((previous) =>
        append
          ? [
              ...previous,
              ...page.items.filter((item) => !previous.some((old) => old.id === item.id)),
            ]
          : page.items,
      );
      setCursor(page.nextCursor);
      setListError(false);
    } catch {
      if (sequence === listSequence.current) setListError(true);
    } finally {
      if (sequence === listSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    setRemote([]);
    setCursor(null);
    const timer = setTimeout(
      () => {
        void load();
      },
      query ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- This counter cancels in-flight requests, rather than tracking a DOM node.
      ++listSequence.current;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Query and scope define a list request; continuations are explicit.
  }, [scope, query]);

  async function work(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch {
      setMessage(
        "操作を完了できませんでした。メモの内容を保持しています。保存状態を確認して再試行してください。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string, fresh = false) {
    await engine.flushLocal();
    const sequence = ++openSequence.current;
    setSelected(id);
    setFresh(fresh);
    setContent(decodeNote(engine.getDraft(id)?.body ?? ""));
    setMode(fresh ? "edit" : "preview");
    setMerge(null);
    setMessage("");
    setOpening(true);
    try {
      await engine.open(id);
    } finally {
      if (sequence === openSequence.current) {
        setContent(decodeNote(engine.getDraft(id)?.body ?? ""));
        setOpening(false);
      }
    }
    window.scrollTo({ top: 0 });
  }
  useEffect(() => {
    if (newRequest) void work(() => open(crypto.randomUUID(), true));
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- A new request is an explicit creation gesture from the application chrome.
  }, [newRequest]);

  const items = useMemo(() => {
    const entries = new Map(remote.map((note) => [note.id, note]));
    for (const draft of engine.getDrafts()) {
      if (draft.tombstone && !draft.dirty) {
        entries.delete(draft.date);
        continue;
      }
      const saved = entries.get(draft.date);
      if (!draft.body && !draft.diary && !draft.dirty) continue;
      if (saved && !draft.dirty && !draft.pending && (draft.diary?.version ?? 0) <= saved.version)
        continue;
      const data = decodeNote(draft.body);
      const note: Note = {
        ...data,
        id: draft.date,
        version: draft.diary?.version ?? 0,
        deletedAt: draft.diary?.deletedAt ?? null,
        createdAt: draft.diary?.createdAt ?? draft.updatedAt,
        updatedAt: draft.updatedAt,
      };
      const belongs =
        scope === "trash"
          ? !!note.deletedAt
          : !note.deletedAt && note.archived === (scope === "archived");
      const matches = `${note.title}\n${note.body}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase());
      if (belongs && matches && (note.title || note.body || draft.diary))
        entries.set(note.id, summarizeNote(note));
      else entries.delete(note.id);
    }
    return [...entries.values()].sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.id.localeCompare(a.id),
    );
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- The engine is an external mutable store; tick invalidates its snapshot.
  }, [remote, tick, engine, scope, query]);
  const draft = selected ? engine.getDraft(selected) : undefined;
  const deleted = !!draft?.diary?.deletedAt;
  const problem = draft?.problem;
  const conflict = problem?.kind === "conflict" || problem?.kind === "recovery";
  const status = selected ? engine.getStatus(selected) : "saved";
  const unavailable = !!problem && !draft?.diary && !draft?.body && problem.kind !== "storage";
  const server = problem?.server ? decodeNote(problem.server.body) : null;
  const unsynced = engine.getDrafts().filter((item) => item.dirty || item.pending).length;
  function edit(next: NoteContent) {
    if (!selected) return;
    setContent(next);
    latestContent.current = next;
    void engine
      .edit(selected, encodeNote(next))
      .catch(() =>
        setMessage(
          "端末に保存できていません。画面を閉じずにコピーまたはMarkdown保存で退避してください。",
        ),
      );
  }
  async function back() {
    await engine.flushLocal();
    ++openSequence.current;
    setSelected(null);
    setMerge(null);
    setMessage("");
    await load();
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(latestContent.current.body);
      setMessage("本文をコピーしました。");
    } catch {
      setManualCopy(true);
    }
  }
  function confirmMutation(kind: "trash" | "restore" | "purge") {
    const label =
      kind === "trash" ? "ゴミ箱へ移動" : kind === "restore" ? "復元する" : "完全削除する";
    setConfirmation({
      title:
        kind === "purge"
          ? "このメモを完全削除しますか"
          : kind === "restore"
            ? "メモを復元しますか"
            : "メモをゴミ箱へ移動しますか",
      description:
        kind === "purge"
          ? "アプリからは元に戻せません。復旧履歴や手元のバックアップに内容が残る場合があります。"
          : kind === "restore"
            ? "保存状態を確認して、メモを元の場所へ戻します。"
            : "保存を確認してから一覧から外します。ゴミ箱から復元できます。",
      label,
      action: async () => {
        await engine.mutate(selected!, kind);
        const result = engine.getDraft(selected!);
        if (result?.problem || result?.pending) return;
        if (kind !== "restore") await back();
      },
    });
  }
  function resolve(choice: "server" | "local" | "merge") {
    setConfirmation({
      title: "選んだ内容でメモを保存しますか",
      description:
        "端末版とサーバー版を確認してください。残したい内容は先にコピーまたはMarkdown保存で退避できます。",
      label:
        choice === "server"
          ? "サーバー版を採用"
          : choice === "local"
            ? "端末版を採用"
            : "統合した内容を保存",
      action: async () => {
        await engine.resolve(selected!, choice, merge ? encodeNote(merge) : undefined);
        setMerge(null);
      },
    });
  }
  const backups = (
    <>
      <button className="button" onClick={() => void copy()}>
        <Copy size={16} />
        本文をコピー
      </button>
      <button className="button" onClick={() => saveMarkdown(content, selected!)}>
        <Download size={16} />
        Markdown保存
      </button>
    </>
  );

  return (
    <section
      className={selected ? "notes-workspace note-is-open" : "notes-workspace"}
      aria-label="メモ"
    >
      {!selected ? (
        <>
          <h1 className="sr-only">{scopeLabels[scope]}</h1>
          <div className="notes-tools">
            <label className="notes-search">
              <Search size={18} aria-hidden="true" />
              <span className="sr-only">メモを検索</span>
              <input
                type="search"
                placeholder="タイトル・本文を検索"
                value={query}
                maxLength={100}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button aria-label="検索をクリア" onClick={() => setQuery("")}>
                  <X size={16} />
                </button>
              )}
            </label>
            <div className="notes-scope" aria-label="メモの表示範囲">
              {(["active", "archived", "trash"] as const).map((value) => (
                <button key={value} aria-pressed={scope === value} onClick={() => setScope(value)}>
                  {value === "active" ? "メモ" : value === "archived" ? "しまったメモ" : "ゴミ箱"}
                </button>
              ))}
            </div>
          </div>
          {listError && (
            <div className="banner" role="alert">
              <CloudOff size={19} />
              <div>
                一覧を読み込めません。端末にあるメモは表示しています。
                <div className="banner-actions">
                  <button className="text-button" onClick={() => void load()}>
                    一覧を読み直す
                  </button>
                  <button className="text-button" onClick={() => void work(onAuthenticate)}>
                    ログインを確認
                  </button>
                </div>
              </div>
            </div>
          )}
          {unsynced > 0 && (
            <div className="sync-notice">
              <CloudOff size={17} />
              <span>{unsynced}件の変更を端末に保持しています。</span>
              <button className="text-button" onClick={() => void work(() => engine.retry())}>
                同期を再試行
              </button>
            </div>
          )}
          <div className="notes-list" aria-busy={loading}>
            {items.map((note, index) => {
              const heading = index === 0 || note.pinned !== items[index - 1].pinned;
              return (
                <div key={note.id}>
                  {heading && scope === "active" && (
                    <h2 className="notes-group-heading">
                      {note.pinned ? (
                        <>
                          <Pin size={14} />
                          固定
                        </>
                      ) : (
                        "最近のメモ"
                      )}
                    </h2>
                  )}
                  <button
                    className="note-row"
                    onClick={() => void work(() => open(note.id))}
                    aria-label={`${noteTitle({ title: note.title, body: note.excerpt })}をひらく`}
                  >
                    <span className="note-row-content">
                      <span className="note-row-title">
                        {noteTitle({ title: note.title, body: note.excerpt })}
                      </span>
                      {note.excerpt && <span className="note-row-excerpt">{note.excerpt}</span>}
                      <span className="note-row-meta">
                        {note.taskCount > 0 && (
                          <span
                            className={
                              note.taskCount === note.completedCount
                                ? "note-tasks-done"
                                : "note-tasks"
                            }
                          >
                            <ListTodo size={14} />
                            {note.taskCount === note.completedCount
                              ? "すべてチェック済み"
                              : `未完了 ${note.taskCount - note.completedCount}件`}
                          </span>
                        )}
                        {engine.getDraft(note.id) && engine.getStatus(note.id) !== "saved" && (
                          <NoteSaveState status={engine.getStatus(note.id)} />
                        )}
                        <time dateTime={note.updatedAt}>{noteDate(note.updatedAt)}</time>
                      </span>
                    </span>
                    <ChevronRight size={18} />
                  </button>
                </div>
              );
            })}
            {!items.length && !loading && !listError && (
              <div className="notes-empty">
                <h2>
                  {query
                    ? "一致するメモがありません"
                    : scope === "archived"
                      ? "しまったメモはありません"
                      : scope === "trash"
                        ? "メモのゴミ箱は空です"
                        : "メモはまだありません"}
                </h2>
                {(query || scope !== "active") && (
                  <p>
                    {query
                      ? "別の言葉で検索してみてください。"
                      : scope === "archived"
                        ? "用件が済んだメモをしまうと、ここから見返せます。"
                        : "削除したメモは、ここから復元できます。"}
                  </p>
                )}
              </div>
            )}
            {loading && (
              <div className="loading-line">
                <LoaderCircle size={18} className="spinning" />
                読み込み中
              </div>
            )}
            {cursor && (
              <button
                className="button load-more"
                disabled={loading}
                onClick={() => void load(true)}
              >
                続きを読み込む
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="note-heading">
            <button className="text-button note-back" onClick={() => void work(back)}>
              <ChevronLeft size={18} />
              {scopeLabels[scope]}に戻る
            </button>
            <NoteSaveState
              status={status}
              empty={!draft?.diary && !draft?.body && !problem && !opening}
            />
          </div>
          {opening && (
            <div className="loading-line">
              <LoaderCircle size={18} className="spinning" />
              メモをひらいています
            </div>
          )}
          {problem && (
            <div
              className={`banner ${problem.kind === "storage" ? "danger-banner" : ""}`}
              role="alert"
            >
              <AlertCircle size={19} />
              <div>
                <strong>{conflict ? "両方の内容を確認してください" : labels[status]}</strong>
                <p>
                  {problem.message
                    .replaceAll("日記", "メモ")
                    .replaceAll("日付を開き直し", "メモを開き直し")}
                </p>
                <div className="banner-actions">
                  {backups}
                  {!conflict && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void work(
                          problem.kind === "auth" ? onAuthenticate : () => engine.retry(selected),
                        )
                      }
                    >
                      <RefreshCw size={16} />
                      再試行
                    </button>
                  )}
                  {problem.kind === "auth" && (
                    <a className="button" href="/" target="_blank" rel="noopener noreferrer">
                      ログイン画面を開く
                    </a>
                  )}
                </div>
                {draft?.unsyncedSince &&
                  Date.now() - Date.parse(draft.unsyncedSince) >= 86_400_000 && (
                    <p>
                      未同期の状態が続いています。コピーやMarkdown保存で手元にも残してください。
                    </p>
                  )}
              </div>
            </div>
          )}
          {deleted && (
            <div className="banner">
              <Trash2 size={19} />
              <div>
                このメモはゴミ箱にあります。
                <div className="banner-actions">
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => confirmMutation("restore")}
                  >
                    <Undo2 size={16} />
                    復元する
                  </button>
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={() => confirmMutation("purge")}
                  >
                    完全削除する
                  </button>
                </div>
              </div>
            </div>
          )}
          {!problem &&
            draft?.unsyncedSince &&
            Date.now() - Date.parse(draft.unsyncedSince) >= 86_400_000 && (
              <div className="banner" role="status">
                <CloudOff size={19} />
                <div>
                  未同期の状態が続いています。手元にもメモを退避してください。
                  <div className="banner-actions">
                    {backups}
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => void work(() => engine.retry(selected))}
                    >
                      同期を再試行
                    </button>
                  </div>
                </div>
              </div>
            )}
          {conflict && (
            <div className="note-conflict">
              <div className="conflict-columns">
                <section>
                  <h2>この端末のメモ</h2>
                  <h3>{noteTitle(content)}</h3>
                  <p className="muted">
                    {content.pinned ? "固定あり" : "固定なし"}・
                    {content.archived ? "しまったメモ" : "通常のメモ"}
                  </p>
                  <pre>{content.body || "（本文は空です）"}</pre>
                  <button className="button" disabled={busy} onClick={() => resolve("local")}>
                    端末版を採用
                  </button>
                </section>
                <section>
                  <h2>サーバーのメモ</h2>
                  <h3>{server ? noteTitle(server) : "メモはありません"}</h3>
                  {server && (
                    <p className="muted">
                      {server.pinned ? "固定あり" : "固定なし"}・
                      {server.archived ? "しまったメモ" : "通常のメモ"}
                      {problem.server?.deletedAt ? "・ゴミ箱" : ""}
                    </p>
                  )}
                  <pre>{server?.body ?? "削除・復旧後の状態を確認してください。"}</pre>
                  <button className="button" disabled={busy} onClick={() => resolve("server")}>
                    サーバー版を採用
                  </button>
                </section>
              </div>
              {!merge ? (
                <button className="button" onClick={() => setMerge({ ...content })}>
                  手動で内容をまとめる
                </button>
              ) : (
                <div className="note-merge">
                  <label>
                    統合するタイトル
                    <input
                      value={merge.title}
                      maxLength={200}
                      onChange={(event) => setMerge({ ...merge, title: event.target.value })}
                    />
                  </label>
                  <label>
                    統合する本文
                    <textarea
                      value={merge.body}
                      onChange={(event) => setMerge({ ...merge, body: event.target.value })}
                    />
                  </label>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => resolve("merge")}
                  >
                    統合した内容を保存
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="note-title-area">
            {mode === "edit" && !deleted ? (
              <input
                ref={titleInput}
                className="note-title-input"
                aria-label="メモのタイトル"
                placeholder="タイトル（任意）"
                maxLength={200}
                value={content.title}
                disabled={opening || unavailable}
                onChange={(event) => edit({ ...latestContent.current, title: event.target.value })}
              />
            ) : (
              <h1 className="note-title">{noteTitle(content)}</h1>
            )}
            <div className="note-properties">
              {!deleted && (
                <>
                  <button
                    className={`text-button ${content.pinned ? "is-pinned" : ""}`}
                    aria-pressed={content.pinned}
                    disabled={opening || unavailable || (!content.title && !content.body)}
                    onClick={() => edit({ ...latestContent.current, pinned: !content.pinned })}
                  >
                    <Pin size={15} />
                    {content.pinned ? "固定中" : "固定する"}
                  </button>
                  <button
                    className="text-button"
                    disabled={opening || unavailable || (!content.title && !content.body)}
                    onClick={() => {
                      const next = { ...latestContent.current, archived: !content.archived };
                      edit(next);
                      void work(back);
                    }}
                  >
                    {content.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                    {content.archived ? "メモに戻す" : "しまう"}
                  </button>
                </>
              )}
              <span className="note-updated">
                {draft?.diary ? `${noteDate(draft.diary.updatedAt)} 更新` : "新しいメモ"}
              </span>
            </div>
          </div>
          <div className="editor-surface note-editor">
            <div className="editor-top">
              <div className="mode-tabs" role="tablist" aria-label="メモの表示">
                <button role="tab" aria-selected={mode === "edit"} onClick={() => setMode("edit")}>
                  編集
                </button>
                <button
                  role="tab"
                  aria-selected={mode === "preview"}
                  onClick={() => setMode("preview")}
                >
                  プレビュー
                </button>
              </div>
              <div className="editor-actions">
                <button aria-label="本文をコピー" title="本文をコピー" onClick={() => void copy()}>
                  <Copy size={17} />
                </button>
                <button
                  aria-label="Markdown保存"
                  title="Markdown保存"
                  onClick={() => saveMarkdown(content, selected)}
                >
                  <Download size={17} />
                </button>
              </div>
            </div>
            <Suspense fallback={<div className="loading-line">本文を準備しています</div>}>
              <MarkdownEditor
                key={selected}
                label="メモの本文"
                autoFocus={fresh}
                value={content.body}
                hidden={mode !== "edit"}
                readOnly={deleted || opening || unavailable}
                onChange={(body) => edit({ ...latestContent.current, body })}
              />
              {mode === "preview" && (
                <MarkdownPreview
                  comfortableTasks
                  label="メモのプレビュー"
                  body={content.body}
                  readOnly={deleted || opening || unavailable}
                  onChange={(body) => edit({ ...latestContent.current, body })}
                />
              )}
            </Suspense>
          </div>
          {!deleted && draft?.diary && (
            <div className="note-footer">
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() => confirmMutation("trash")}
              >
                <Trash2 size={16} />
                ゴミ箱へ移動
              </button>
            </div>
          )}
        </>
      )}
      {message && (
        <div className="note-message" role="status">
          {message}
          <button
            className="icon-button"
            aria-label="お知らせを閉じる"
            onClick={() => setMessage("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {manualCopy && (
        <div className="note-manual-copy">
          <label>
            本文を選択してコピー
            <textarea readOnly value={content.body} onFocus={(event) => event.target.select()} />
          </label>
          <button className="button" onClick={() => setManualCopy(false)}>
            閉じる
          </button>
        </div>
      )}
      {confirmation && (
        <dialog
          ref={dialog}
          className="dialog"
          aria-label={confirmation.title}
          onCancel={() => setConfirmation(null)}
        >
          <div className="dialog-heading">
            <h2>{confirmation.title}</h2>
            <button
              className="icon-button"
              aria-label="閉じる"
              onClick={() => setConfirmation(null)}
            >
              <X size={19} />
            </button>
          </div>
          <p>{confirmation.description}</p>
          <div className="dialog-actions">
            <button className="button" disabled={busy} onClick={() => setConfirmation(null)}>
              キャンセル
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  await confirmation.action();
                  setConfirmation(null);
                })
              }
            >
              {confirmation.label}
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
