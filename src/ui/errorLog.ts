// Captures runtime errors so they can be shown on the page itself. Mobile
// browsers have no reachable devtools console, so without this a failure on a
// phone is indistinguishable from a blank screen.

export type ErrorLevel = 'error' | 'warn';

export interface ErrorEntry {
  id: number;
  level: ErrorLevel;
  message: string;
  detail: string;
  count: number;
  time: number;
}

const MAX_ENTRIES = 25;

let entries: ErrorEntry[] = [];
let nextId = 1;
let installed = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getErrors(): ErrorEntry[] {
  return entries;
}

export function clearErrors(): void {
  if (entries.length === 0) return;
  entries = [];
  emit();
}

export function recordError(
  level: ErrorLevel,
  message: string,
  detail = '',
): void {
  const msg = message.trim() || 'Unknown error';
  const last = entries[entries.length - 1];
  // Collapse a repeating error (e.g. one thrown every frame) into a counter so
  // the overlay stays readable.
  if (last && last.level === level && last.message === msg && last.detail === detail) {
    entries = [...entries.slice(0, -1), { ...last, count: last.count + 1, time: Date.now() }];
    emit();
    return;
  }
  const entry: ErrorEntry = {
    id: nextId++,
    level,
    message: msg,
    detail,
    count: 1,
    time: Date.now(),
  };
  entries = [...entries, entry].slice(-MAX_ENTRIES);
  emit();
}

function describe(value: unknown): { message: string; detail: string } {
  if (value instanceof Error) {
    return { message: `${value.name}: ${value.message}`, detail: value.stack ?? '' };
  }
  if (typeof value === 'string') return { message: value, detail: '' };
  try {
    return { message: JSON.stringify(value) ?? String(value), detail: '' };
  } catch {
    return { message: String(value), detail: '' };
  }
}

function formatArgs(args: unknown[]): { message: string; detail: string } {
  const parts: string[] = [];
  let detail = '';
  for (const arg of args) {
    const d = describe(arg);
    parts.push(d.message);
    if (d.detail && !detail) detail = d.detail;
  }
  return { message: parts.join(' '), detail };
}

// Installs global capture. Safe to call more than once; only the first call
// takes effect. No-ops during SSG where `window` is absent.
export function installErrorCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    if (event.error) {
      const d = describe(event.error);
      recordError('error', d.message, d.detail);
    } else {
      const where = event.filename
        ? ` (${event.filename}:${event.lineno}:${event.colno})`
        : '';
      recordError('error', `${event.message}${where}`);
    }
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const d = describe(event.reason);
    recordError('error', `Unhandled promise rejection: ${d.message}`, d.detail);
  });

  const nativeError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const { message, detail } = formatArgs(args);
    recordError('error', message, detail);
    nativeError(...args);
  };

  const nativeWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const { message, detail } = formatArgs(args);
    recordError('warn', message, detail);
    nativeWarn(...args);
  };
}

// Plain-text dump of the log, for the overlay's copy/share button.
export function formatErrorReport(): string {
  const head = [
    `URL: ${typeof location !== 'undefined' ? location.href : 'n/a'}`,
    `User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`,
    typeof screen !== 'undefined'
      ? `Screen: ${screen.width}x${screen.height} @${window.devicePixelRatio}x`
      : '',
    `Time: ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join('\n');
  const body = entries
    .map((e) => {
      const times = e.count > 1 ? ` (x${e.count})` : '';
      return `[${e.level}]${times} ${e.message}${e.detail ? `\n${e.detail}` : ''}`;
    })
    .join('\n\n');
  return `${head}\n\n${body}`;
}
