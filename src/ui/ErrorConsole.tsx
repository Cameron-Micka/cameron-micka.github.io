import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  clearErrors,
  formatErrorReport,
  getErrors,
  installErrorCapture,
  subscribeErrors,
  type ErrorEntry,
} from './errorLog';
import { UI } from './strings';

const EMPTY: ErrorEntry[] = [];

// On-page console. Phones have no reachable devtools, so surfacing captured
// errors in the DOM is the only way to diagnose a failure on a real device.
export function ErrorConsole() {
  const entries = useSyncExternalStore(
    subscribeErrors,
    getErrors,
    () => EMPTY,
  );
  const [open, setOpen] = useState(false);
  const [dismissedAt, setDismissedAt] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    installErrorCapture();
  }, []);

  const errorCount = entries.filter((e) => e.level === 'error').length;
  const latestId = entries.length ? (entries[entries.length - 1]?.id ?? 0) : 0;

  // Auto-open on the first error, and again whenever a new one arrives after
  // the panel was dismissed.
  useEffect(() => {
    if (errorCount > 0 && latestId > dismissedAt) setOpen(true);
  }, [errorCount, latestId, dismissedAt]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  if (entries.length === 0) return null;

  const dismiss = () => {
    setDismissedAt(latestId);
    setOpen(false);
  };

  const copy = () => {
    const text = formatErrorReport();
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  if (!open) {
    return (
      <button
        type="button"
        className={`error-console-badge${errorCount ? ' has-errors' : ''}`}
        onClick={() => setOpen(true)}
      >
        {errorCount > 0
          ? `${errorCount} ${errorCount === 1 ? UI.errorLogOne : UI.errorLogMany}`
          : UI.errorLogTitle}
      </button>
    );
  }

  return (
    <div className="error-console" role="log" aria-label={UI.errorLogTitle}>
      <div className="error-console-head">
        <strong>{UI.errorLogTitle}</strong>
        <div className="error-console-actions">
          <button type="button" onClick={copy}>
            {copied ? UI.copied : UI.copy}
          </button>
          <button type="button" onClick={() => clearErrors()}>
            {UI.clear}
          </button>
          <button type="button" onClick={dismiss} aria-label={UI.close}>
            {UI.close}
          </button>
        </div>
      </div>
      <ul className="error-console-list">
        {entries.map((e) => (
          <li key={e.id} className={`error-console-item is-${e.level}`}>
            <span className="error-console-level">{e.level}</span>
            <span className="error-console-msg">
              {e.message}
              {e.count > 1 ? ` (x${e.count})` : ''}
            </span>
            {e.detail && <pre>{e.detail}</pre>}
          </li>
        ))}
      </ul>
    </div>
  );
}
