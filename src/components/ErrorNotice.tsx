import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, Copy, ExternalLink, RefreshCw } from "lucide-react";
import type { UiError } from "../lib/ui-errors";

export function ErrorNotice({
  issue,
  retry,
  retryLabel = "もう一度試す",
  busy = false,
  onCopyReport,
  children,
  danger = false,
  retryAfterUntil = 0,
}: {
  issue: UiError;
  retry?: () => void;
  retryLabel?: string;
  busy?: boolean;
  onCopyReport: () => void;
  children?: ReactNode;
  danger?: boolean;
  retryAfterUntil?: number;
}) {
  const [clock, setClock] = useState(Date.now);
  const waiting = retryAfterUntil > clock;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const now = Date.now();
      setClock(now);
      if (retryAfterUntil > now)
        timer = setTimeout(update, Math.min(retryAfterUntil - now, 60_000));
    };
    update();
    return () => clearTimeout(timer);
  }, [retryAfterUntil]);
  return (
    <div
      className={`banner error-notice${danger ? " danger-banner" : ""}`}
      role="alert"
      aria-label={issue.title}
    >
      <AlertCircle size={20} aria-hidden="true" />
      <div>
        <strong className="issue-title">{issue.title}</strong>
        <p>{issue.message}</p>
        <div className="banner-actions issue-actions">
          {danger && children}
          {issue.recovery === "auth" && (
            <a className="button issue-primary" href="/" target="_blank" rel="noopener">
              ログイン画面を開く <ExternalLink size={15} />
            </a>
          )}
          {retry && issue.recovery !== "none" && (
            <button
              className={`button ${danger || issue.recovery === "auth" ? "issue-secondary" : "issue-primary"}`}
              disabled={busy || waiting}
              onClick={retry}
            >
              <RefreshCw size={15} className={busy ? "spinning" : undefined} />
              {waiting ? "再試行までお待ちください" : retryLabel}
            </button>
          )}
          {!danger && children}
        </div>
        {waiting && <p>サーバーからの案内により、再試行まで少し待っています。</p>}
        <button className="text-button issue-report" onClick={onCopyReport}>
          <Copy size={14} /> エラー情報をコピー
        </button>
      </div>
    </div>
  );
}
