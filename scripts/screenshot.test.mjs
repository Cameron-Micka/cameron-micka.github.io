import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server;
let shot;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  shot = await server.ssrLoadModule('/src/ui/screenshot.ts');
});

after(async () => {
  await server?.close();
});

const key = (overrides) => ({
  code: 'KeyS',
  ctrlKey: true,
  altKey: true,
  shiftKey: true,
  metaKey: false,
  repeat: false,
  ...overrides,
});

test('only Ctrl+Alt+Shift+S triggers the screenshot shortcut', () => {
  assert.equal(shot.isScreenshotShortcut(key()), true);
  assert.equal(shot.isScreenshotShortcut(key({ altKey: false })), false);
  assert.equal(shot.isScreenshotShortcut(key({ ctrlKey: false })), false);
  assert.equal(shot.isScreenshotShortcut(key({ shiftKey: false })), false);
  assert.equal(shot.isScreenshotShortcut(key({ metaKey: true })), false);
  assert.equal(shot.isScreenshotShortcut(key({ repeat: true })), false);
  assert.equal(shot.isScreenshotShortcut(key({ code: 'KeyP' })), false);
});

test('stage fits a 16:9 1920x1080 frame below the bar', () => {
  const s = shot.stageScale(1512, 900);
  assert.ok(shot.SHOT_WIDTH * s <= 1512 - 16 + 1e-9);
  assert.ok(shot.SHOT_HEIGHT * s <= 900 - 40 - 8 + 1e-9);
  assert.ok(s > 0.75 && s < 0.8);
  assert.equal(shot.stageScale(4000, 3000), 1);
});

test('downsample2x box-filters 2x2 blocks in linear light', () => {
  const px = (r, g, b) => [r, g, b, 255];
  // 4x2 source: a flat block and a black/white checker block.
  const src = new Uint8ClampedArray([
    ...px(10, 20, 30),
    ...px(10, 20, 30),
    ...px(0, 0, 0),
    ...px(255, 255, 255),
    ...px(10, 20, 30),
    ...px(10, 20, 30),
    ...px(255, 255, 255),
    ...px(0, 0, 0),
  ]);
  const out = shot.downsample2x(src, 4, 2);
  assert.equal(out.width, 2);
  assert.equal(out.height, 1);
  // Flat colors survive exactly: no softening or shift.
  assert.deepEqual([...out.data.slice(0, 4)], [10, 20, 30, 255]);
  // 50% linear coverage is sRGB 188, not the gamma-naive 128.
  assert.deepEqual([...out.data.slice(4, 8)], [188, 188, 188, 255]);
});

test('filenames include the page and a sortable timestamp', () => {
  const date = new Date(2026, 9, 12, 7, 5, 3);
  assert.equal(
    shot.screenshotFilename(date, '/'),
    'cameron-micka-home-1920x1080-2026-10-12_07-05-03.png',
  );
  assert.equal(
    shot.screenshotFilename(date, '/photography/'),
    'cameron-micka-photography-1920x1080-2026-10-12_07-05-03.png',
  );
});
