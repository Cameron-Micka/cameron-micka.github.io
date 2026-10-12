// Secret desktop-only screenshot tool.
//
// Ctrl+Alt+Shift+S opens a stage holding the current page in a true
// 1920x1080 iframe (so vw/vh units and media queries lay out exactly as on a
// 1080p display), scaled down to fit the window. Compose the shot inside it,
// then press the shortcut again: the tab is captured, the stage cropped out
// to a 1920x1080 PNG, and "Save to Desktop" opens a save dialog that starts
// in the Desktop folder (falling back to a regular download).

export const SHOT_WIDTH = 1920;
export const SHOT_HEIGHT = 1080;
const SHORTCUT_LABEL = 'Ctrl+Alt+Shift+S';
const STAGE_PADDING = 8;
const STAGE_BAR_HEIGHT = 36;
// Lets the "sharing this tab" infobar appear and the stage re-fit before
// the frame is grabbed.
const CAPTURE_SETTLE_MS = 700;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function isScreenshotShortcut(e: KeyboardEvent): boolean {
  return (
    e.code === 'KeyS' &&
    e.ctrlKey &&
    e.altKey &&
    e.shiftKey &&
    !e.metaKey &&
    !e.repeat
  );
}

// Largest scale at which the 1920x1080 stage fits inside the window.
export function stageScale(viewportWidth: number, viewportHeight: number) {
  const w = viewportWidth - STAGE_PADDING * 2;
  const h = viewportHeight - STAGE_BAR_HEIGHT - STAGE_PADDING * 2;
  return Math.max(0.05, Math.min(w / SHOT_WIDTH, h / SHOT_HEIGHT));
}

// Maps an element's CSS-pixel rect into the captured video frame, which is
// the tab viewport at some (possibly non-uniform) resolution.
export function cropToVideo(
  rect: Rect,
  viewport: { width: number; height: number },
  video: { width: number; height: number },
): Rect {
  const sx = video.width / viewport.width;
  const sy = video.height / viewport.height;
  const left = Math.max(0, rect.left * sx);
  const top = Math.max(0, rect.top * sy);
  return {
    left,
    top,
    width: Math.min(video.width - left, rect.width * sx),
    height: Math.min(video.height - top, rect.height * sy),
  };
}

export function screenshotFilename(date: Date, pathname: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  const page =
    pathname
      .replace(/^\/+|\/+$/g, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase() || 'home';
  return `cameron-micka-${page}-${SHOT_WIDTH}x${SHOT_HEIGHT}-${stamp}.png`;
}

function supportsScreenshots(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.self === window.top &&
    typeof matchMedia !== 'undefined' &&
    matchMedia('(pointer: fine)').matches &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function'
  );
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const nextPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

function nextVideoFrame(video: HTMLVideoElement): Promise<void> {
  if ('requestVideoFrameCallback' in video) {
    return new Promise((resolve) =>
      video.requestVideoFrameCallback(() => resolve()),
    );
  }
  return delay(100);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

// Chromium-only options; not yet in TypeScript's DOM lib.
type CaptureOptions = DisplayMediaStreamOptions & {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
  monitorTypeSurfaces?: 'include' | 'exclude';
};

interface SaveFilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    startIn: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
}

async function captureTab(target: HTMLElement): Promise<Blob> {
  const options: CaptureOptions = {
    video: { displaySurface: 'browser', frameRate: 30 },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'exclude',
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  const video = document.createElement('video');
  try {
    const track = stream.getVideoTracks()[0];
    if (!track || track.getSettings().displaySurface !== 'browser') {
      throw new Error('Choose "This tab" when asked what to share.');
    }
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await delay(CAPTURE_SETTLE_MS);
    await nextPaint();
    await nextVideoFrame(video);

    const crop = cropToVideo(
      target.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { width: video.videoWidth, height: video.videoHeight },
    );
    const canvas = document.createElement('canvas');
    canvas.width = SHOT_WIDTH;
    canvas.height = SHOT_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      video,
      crop.left,
      crop.top,
      crop.width,
      crop.height,
      0,
      0,
      SHOT_WIDTH,
      SHOT_HEIGHT,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!blob) throw new Error('Could not encode the screenshot.');
    return blob;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
}

// Returns false when the user cancels the save dialog.
async function saveBlob(blob: Blob, name: string): Promise<boolean> {
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        startIn: 'desktop',
        types: [
          { description: 'PNG image', accept: { 'image/png': ['.png'] } },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return false;
      }
      throw err;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

function showSaveToast(blob: Blob, name: string): () => void {
  const previewUrl = URL.createObjectURL(blob);
  const toast = el('div', 'screenshot-toast');
  toast.setAttribute('role', 'dialog');
  toast.setAttribute('aria-label', 'Screenshot ready');
  const preview = el('img', 'screenshot-toast-preview');
  preview.src = previewUrl;
  preview.alt = 'Screenshot preview';
  const status = el(
    'div',
    'screenshot-toast-status',
    `Screenshot ready \u00b7 ${SHOT_WIDTH} \u00d7 ${SHOT_HEIGHT}`,
  );
  const actions = el('div', 'screenshot-toast-actions');
  const save = el('button', 'screenshot-btn is-primary', 'Save to Desktop');
  const discard = el('button', 'screenshot-btn', 'Discard');
  save.type = discard.type = 'button';
  actions.append(save, discard);
  toast.append(preview, status, actions);
  document.body.append(toast);
  save.focus();

  const close = () => {
    toast.remove();
    URL.revokeObjectURL(previewUrl);
    window.removeEventListener('keydown', onKeyDown, true);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKeyDown, true);
  discard.addEventListener('click', close);
  save.addEventListener('click', () => {
    save.disabled = true;
    saveBlob(blob, name)
      .then((saved) => {
        if (saved) close();
        else save.disabled = false;
      })
      .catch((err: unknown) => {
        console.error('Screenshot save failed:', err);
        status.textContent = `Save failed: ${err instanceof Error ? err.message : String(err)}`;
        save.disabled = false;
      });
  });
  return close;
}

interface Stage {
  capture: () => void;
  close: () => void;
}

function openStage(
  onKeyDown: (e: KeyboardEvent) => void,
  onClosed: () => void,
  onCaptured: (blob: Blob, name: string) => void,
): Stage {
  const root = el('div', 'screenshot-stage');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Screenshot stage');
  const bar = el('div', 'screenshot-stage-bar');
  const status = el('span', 'screenshot-stage-status');
  const defaultStatus = `${SHOT_WIDTH} \u00d7 ${SHOT_HEIGHT} \u00b7 Compose the shot, then press ${SHORTCUT_LABEL} to capture`;
  status.textContent = defaultStatus;
  const cancel = el('button', 'screenshot-btn', 'Cancel');
  cancel.type = 'button';
  bar.append(status, cancel);
  const viewport = el('div', 'screenshot-stage-viewport');
  const frame = el('iframe', 'screenshot-stage-frame');
  frame.title = 'Screenshot stage';
  frame.width = String(SHOT_WIDTH);
  frame.height = String(SHOT_HEIGHT);
  frame.src = location.href;
  viewport.append(frame);
  root.append(bar, viewport);
  document.body.append(root);

  const fit = () => {
    const s = stageScale(window.innerWidth, window.innerHeight);
    viewport.style.width = `${SHOT_WIDTH * s}px`;
    viewport.style.height = `${SHOT_HEIGHT * s}px`;
    frame.style.transform = `scale(${s})`;
  };
  fit();

  // The shortcut fires inside the iframe while composing; listen there too.
  // Re-attached on every load since the stage page can reload itself.
  const onFrameLoad = () => {
    frame.contentWindow?.addEventListener('keydown', onKeyDown);
    frame.focus();
  };
  const onRootKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) {
      e.preventDefault();
      close();
    }
  };
  frame.addEventListener('load', onFrameLoad);
  window.addEventListener('resize', fit);
  window.addEventListener('keydown', onRootKeyDown);
  cancel.addEventListener('click', () => close());

  let busy = false;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('resize', fit);
    window.removeEventListener('keydown', onRootKeyDown);
    frame.removeEventListener('load', onFrameLoad);
    try {
      frame.contentWindow?.removeEventListener('keydown', onKeyDown);
    } catch {
      // The frame may already be navigating away.
    }
    root.remove();
    onClosed();
  };

  const capture = () => {
    if (busy || closed) return;
    busy = true;
    root.classList.add('is-capturing');
    status.textContent = 'Share "This tab" to capture\u2026';
    captureTab(viewport)
      .then((blob) => {
        close();
        onCaptured(blob, screenshotFilename(new Date(), location.pathname));
      })
      .catch((err: unknown) => {
        const cancelled =
          err instanceof DOMException && err.name === 'NotAllowedError';
        if (!cancelled) console.error('Screenshot capture failed:', err);
        status.textContent = cancelled
          ? defaultStatus
          : `Capture failed: ${err instanceof Error ? err.message : String(err)}`;
      })
      .finally(() => {
        busy = false;
        root.classList.remove('is-capturing');
      });
  };

  return { capture, close };
}

// Installs the shortcut on desktop browsers; returns an uninstaller.
export function installScreenshotShortcut(): () => void {
  if (!supportsScreenshots()) return () => {};
  let stage: Stage | null = null;
  let closeToast: (() => void) | null = null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (!isScreenshotShortcut(e)) return;
    e.preventDefault();
    if (stage) {
      stage.capture();
      return;
    }
    closeToast?.();
    stage = openStage(
      onKeyDown,
      () => {
        stage = null;
      },
      (blob, name) => {
        closeToast = showSaveToast(blob, name);
      },
    );
  };

  window.addEventListener('keydown', onKeyDown);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    stage?.close();
    closeToast?.();
  };
}
