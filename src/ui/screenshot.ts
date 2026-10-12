// Secret desktop-only screenshot tool.
//
// Ctrl+Alt+Shift+S stages the live page: <body> is laid out at exactly
// 1920x1080 CSS pixels (viewport-unit variables follow) and scaled down to fit
// the window, so everything on screen — camera, open story, scroll position —
// is kept. Pressing the shortcut again renders a lossless 1920x1080 PNG:
//  - the 3D scene is re-rendered at 2x (3840x2160) with the high quality
//    preset and box-filtered down in linear light (supersampled, not soft);
//  - the DOM is rasterized at 1:1 through an SVG foreignObject, so text and
//    UI land on whole pixels exactly as on a 1080p display.
// "Save to Desktop" opens a save dialog that starts in the Desktop folder
// (falling back to a regular download).

export const SHOT_WIDTH = 1920;
export const SHOT_HEIGHT = 1080;
const SUPERSAMPLE = 2;
const SHORTCUT_LABEL = 'Ctrl+Alt+Shift+S';
const STAGE_PADDING = 8;
const STAGE_BAR_HEIGHT = 40;
// Below these window sizes the site's breakpoints (max-width: 980px,
// max-height: 500px) would not evaluate as they do at 1920x1080.
const MIN_WINDOW_WIDTH = 981;
const MIN_WINDOW_HEIGHT = 501;
const STAGE_CLASS = 'screenshot-stage';
const TOP_LAYER_ATTR = 'data-screenshot-top-layer';

export interface ScreenshotScene {
  setScreenshotMode(on: boolean): void;
  captureFrame(supersample: number): HTMLCanvasElement | null;
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

// Largest scale at which the 1920x1080 stage fits below the stage bar.
export function stageScale(viewportWidth: number, viewportHeight: number) {
  const w = viewportWidth - STAGE_PADDING * 2;
  const h = viewportHeight - STAGE_BAR_HEIGHT - STAGE_PADDING;
  return Math.max(0.05, Math.min(1, w / SHOT_WIDTH, h / SHOT_HEIGHT));
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

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] =
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const LINEAR_STEPS = 16383;
let linearToSrgb: Uint8Array | null = null;
function linearToSrgbTable(): Uint8Array {
  if (linearToSrgb) return linearToSrgb;
  linearToSrgb = new Uint8Array(LINEAR_STEPS + 1);
  for (let i = 0; i <= LINEAR_STEPS; i++) {
    const l = i / LINEAR_STEPS;
    const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
    linearToSrgb[i] = Math.round(Math.min(1, Math.max(0, c)) * 255);
  }
  return linearToSrgb;
}

// Exact 2x2 box filter in linear light: the supersampled frame's anti-aliasing
// without the blur of a general-purpose resampler.
export function downsample2x(
  src: Uint8ClampedArray,
  width: number,
  height: number,
): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
  const w = Math.floor(width / 2);
  const h = Math.floor(height / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  const toSrgb = linearToSrgbTable();
  for (let y = 0; y < h; y++) {
    const r0 = y * 2 * width * 4;
    const r1 = r0 + width * 4;
    for (let x = 0; x < w; x++) {
      const a = r0 + x * 8;
      const b = r1 + x * 8;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const sum =
          SRGB_TO_LINEAR[src[a + c]!]! +
          SRGB_TO_LINEAR[src[a + 4 + c]!]! +
          SRGB_TO_LINEAR[src[b + c]!]! +
          SRGB_TO_LINEAR[src[b + 4 + c]!]!;
        out[o + c] = toSrgb[Math.round(sum * 0.25 * LINEAR_STEPS)]!;
      }
      out[o + 3] = Math.round(
        (src[a + 3]! + src[a + 7]! + src[b + 3]! + src[b + 7]!) / 4,
      );
    }
  }
  return { data: out, width: w, height: h };
}

function supportsScreenshots(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.self === window.top &&
    typeof matchMedia !== 'undefined' &&
    matchMedia('(pointer: fine)').matches
  );
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

function button(label: string, primary = false): HTMLButtonElement {
  const b = el(
    'button',
    `screenshot-btn${primary ? ' is-primary' : ''}`,
    label,
  );
  b.type = 'button';
  return b;
}

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Could not encode the image.')),
      'image/png',
    ),
  );
}

// Re-renders the 3D scene supersampled and returns it at stage resolution.
async function captureScene(
  scene: ScreenshotScene,
): Promise<HTMLCanvasElement | null> {
  const frame = scene.captureFrame(SUPERSAMPLE);
  if (!frame) return null;
  const ctx = frame.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const src = ctx.getImageData(0, 0, frame.width, frame.height);
  const small = downsample2x(src.data, src.width, src.height);
  const out = document.createElement('canvas');
  out.width = small.width;
  out.height = small.height;
  out
    .getContext('2d')
    ?.putImageData(new ImageData(small.data, small.width, small.height), 0, 0);
  return out;
}

// Cross-origin stylesheets (Google Fonts) are unreadable to the rasterizer;
// re-importing them from a same-origin <style> lets it embed the web fonts.
async function importCrossOriginStyles(): Promise<HTMLStyleElement | null> {
  const hrefs = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  )
    .map((link) => link.href)
    .filter((href) => href && new URL(href).origin !== location.origin);
  if (!hrefs.length) return null;
  const style = document.createElement('style');
  style.textContent = hrefs
    .map((h) => `@import url(${JSON.stringify(h)});`)
    .join('\n');
  const loaded = new Promise<void>((resolve) => {
    style.addEventListener('load', () => resolve(), { once: true });
    style.addEventListener('error', () => resolve(), { once: true });
  });
  document.head.append(style);
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 5000))]);
  return style;
}

async function renderPage(scene: ScreenshotScene | null): Promise<Blob> {
  const root = document.getElementById('root');
  const sceneCanvas = document.querySelector<HTMLCanvasElement>(
    'canvas.scene-canvas',
  );
  const cleanups: (() => void)[] = [];
  try {
    const [{ domToCanvas }, sceneFrame] = await Promise.all([
      import('modern-screenshot'),
      scene && sceneCanvas?.isConnected ? captureScene(scene) : null,
    ]);

    // Freeze the captured frame over the live canvas; the rasterizer embeds
    // it in place of the (unreadable) WebGPU/WebGL canvas.
    if (sceneFrame && sceneCanvas) {
      const url = URL.createObjectURL(await toBlob(sceneFrame));
      const img = el('img', 'screenshot-scene-frame');
      img.alt = '';
      img.src = url;
      await img.decode();
      sceneCanvas.after(img);
      cleanups.push(() => {
        img.remove();
        URL.revokeObjectURL(url);
      });
    }

    const fonts = await importCrossOriginStyles();
    if (fonts) cleanups.push(() => fonts.remove());
    await document.fonts.ready;

    // Swap #root's scroll offset for an equivalent negative margin so the
    // clone (which cannot carry scroll positions) matches what is on screen.
    if (root && root.scrollTop > 0) {
      const top = root.scrollTop;
      const previous = root.getAttribute('style');
      root.style.overflow = 'visible';
      root.style.height = 'auto';
      root.style.minHeight = `${SHOT_HEIGHT + top}px`;
      root.style.marginTop = `${-top}px`;
      cleanups.push(() => {
        if (previous === null) root.removeAttribute('style');
        else root.setAttribute('style', previous);
        root.scrollTop = top;
      });
    }

    // Modal dialogs live in the top layer outside <body>'s transform; mark
    // them so their clones can be put back into the unscaled frame.
    let topLayer: Element[] = [];
    try {
      topLayer = Array.from(document.querySelectorAll(':modal'));
    } catch {
      // :modal is unsupported; no top-layer dialogs to fix up.
    }
    topLayer.forEach((node) => node.setAttribute(TOP_LAYER_ATTR, ''));
    cleanups.push(() =>
      topLayer.forEach((node) => node.removeAttribute(TOP_LAYER_ATTR)),
    );

    const canvas = await domToCanvas(document.body, {
      width: SHOT_WIDTH,
      height: SHOT_HEIGHT,
      scale: 1,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      style: { transform: 'none', left: '0px', top: '0px' },
      filter: (node) => node !== sceneCanvas,
      onCloneNode: (clone) => {
        if (!(clone instanceof Element)) return;
        clone
          .querySelectorAll<HTMLElement>(`[${TOP_LAYER_ATTR}]`)
          .forEach((node) => {
            node.style.transform = 'none';
            node.style.left = '0px';
            node.style.top = '0px';
            node.style.zIndex = '2147483647';
          });
      },
    });
    if (canvas.width !== SHOT_WIDTH || canvas.height !== SHOT_HEIGHT) {
      throw new Error(
        `Rendered ${canvas.width}x${canvas.height} instead of ${SHOT_WIDTH}x${SHOT_HEIGHT}.`,
      );
    }
    return await toBlob(canvas);
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup();
  }
}

interface SaveFilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    startIn: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
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

function topModal(): Element | null {
  try {
    return Array.from(document.querySelectorAll(':modal')).pop() ?? null;
  } catch {
    return null;
  }
}

function showSaveToast(blob: Blob, name: string): () => void {
  const previewUrl = URL.createObjectURL(blob);
  const toast = el('div', 'screenshot-ui screenshot-toast');
  toast.setAttribute('role', 'alertdialog');
  toast.setAttribute('aria-label', 'Screenshot ready');
  const preview = el('img', 'screenshot-toast-preview');
  preview.src = previewUrl;
  preview.alt = 'Screenshot preview';
  const status = el(
    'div',
    'screenshot-toast-status',
    `Screenshot ready \u00b7 ${SHOT_WIDTH} \u00d7 ${SHOT_HEIGHT} PNG`,
  );
  const actions = el('div', 'screenshot-toast-actions');
  const save = button('Save to Desktop', true);
  const discard = button('Discard');
  actions.append(save, discard);
  toast.append(preview, status, actions);
  // Outside <body> so it is neither scaled by the stage nor captured — unless
  // a modal dialog is open, which makes everything outside it inert.
  (topModal() ?? document.documentElement).append(toast);
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
        status.textContent = `Save failed: ${errorText(err)}`;
        save.disabled = false;
      });
  });
  return close;
}

let activeScene: ScreenshotScene | null = null;
let staged = false;

// The 3D experience registers its engine while mounted.
export function registerScreenshotScene(scene: ScreenshotScene): () => void {
  activeScene = scene;
  if (staged) scene.setScreenshotMode(true);
  return () => {
    if (activeScene === scene) activeScene = null;
  };
}

interface Stage {
  capture: () => void;
  close: () => void;
}

function openStage(
  onClosed: () => void,
  onCaptured: (blob: Blob) => void,
): Stage {
  const html = document.documentElement;
  const root = document.getElementById('root');
  const scrollTop = window.scrollY;

  const bar = el('div', 'screenshot-ui screenshot-stage-bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Screenshot stage');
  const status = el('span', 'screenshot-stage-status');
  const captureBtn = button('Capture', true);
  const exitBtn = button('Exit');
  bar.append(status, captureBtn, exitBtn);
  html.append(bar);

  const idleStatus = () => {
    const small =
      window.innerWidth < MIN_WINDOW_WIDTH ||
      window.innerHeight < MIN_WINDOW_HEIGHT;
    status.textContent = small
      ? `Window too small: enlarge to at least ${MIN_WINDOW_WIDTH} \u00d7 ${MIN_WINDOW_HEIGHT} so the layout matches 1080p`
      : `${SHOT_WIDTH} \u00d7 ${SHOT_HEIGHT} live stage \u00b7 ${SHORTCUT_LABEL} to capture \u00b7 Esc to exit`;
    bar.classList.toggle('is-warning', small);
  };

  const fit = () => {
    const s = stageScale(window.innerWidth, window.innerHeight);
    const left = Math.round((window.innerWidth - SHOT_WIDTH * s) / 2);
    html.style.setProperty('--shot-scale', String(s));
    html.style.setProperty('--shot-left', `${left}px`);
    html.style.setProperty('--shot-top', `${STAGE_BAR_HEIGHT}px`);
    if (!busy) idleStatus();
  };

  let busy = false;
  let closed = false;
  fit();
  html.classList.add(STAGE_CLASS);
  if (root) root.scrollTop = scrollTop;
  activeScene?.setScreenshotMode(true);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || busy || e.defaultPrevented) return;
    // Let open dialogs (story, settings, lightbox) handle Escape first.
    if (document.body.querySelector('dialog[open], [role="dialog"]')) return;
    e.preventDefault();
    close();
  };
  window.addEventListener('resize', fit);
  window.addEventListener('keydown', onKeyDown);
  exitBtn.addEventListener('click', () => close());
  captureBtn.addEventListener('click', () => capture());

  const close = () => {
    if (closed || busy) return;
    closed = true;
    staged = false;
    window.removeEventListener('resize', fit);
    window.removeEventListener('keydown', onKeyDown);
    const top = root?.scrollTop ?? 0;
    html.classList.remove(STAGE_CLASS);
    ['--shot-scale', '--shot-left', '--shot-top'].forEach((p) =>
      html.style.removeProperty(p),
    );
    bar.remove();
    window.scrollTo({ top, behavior: 'instant' });
    activeScene?.setScreenshotMode(false);
    onClosed();
  };

  const capture = () => {
    if (busy || closed) return;
    busy = true;
    bar.classList.add('is-busy');
    captureBtn.disabled = exitBtn.disabled = true;
    status.textContent = 'Capturing\u2026';
    renderPage(activeScene)
      .then((blob) => onCaptured(blob))
      .catch((err: unknown) => {
        console.error('Screenshot capture failed:', err);
        status.textContent = `Capture failed: ${errorText(err)}`;
      })
      .finally(() => {
        busy = false;
        bar.classList.remove('is-busy');
        captureBtn.disabled = exitBtn.disabled = false;
        if (!status.textContent?.startsWith('Capture failed')) idleStatus();
      });
  };

  staged = true;
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
    e.stopPropagation();
    if (!stage) {
      stage = openStage(
        () => {
          stage = null;
        },
        (blob) => {
          closeToast?.();
          closeToast = showSaveToast(
            blob,
            screenshotFilename(new Date(), location.pathname),
          );
        },
      );
      return;
    }
    closeToast?.();
    closeToast = null;
    stage.capture();
  };

  // Capture phase so the scene's own key handling never sees the shortcut.
  window.addEventListener('keydown', onKeyDown, true);
  return () => {
    window.removeEventListener('keydown', onKeyDown, true);
    closeToast?.();
    stage?.close();
  };
}
