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

test('stage fits a 16:9 1920x1080 frame inside the window', () => {
  const s = shot.stageScale(1512, 900);
  assert.ok(shot.SHOT_WIDTH * s <= 1512 - 16 + 1e-9);
  assert.ok(shot.SHOT_HEIGHT * s <= 900 - 36 - 16 + 1e-9);
  assert.ok(s > 0.7 && s < 0.8);
});

test('crop maps CSS pixels into the captured frame', () => {
  const crop = shot.cropToVideo(
    { left: 100, top: 50, width: 1280, height: 720 },
    { width: 1500, height: 900 },
    { width: 3000, height: 1800 },
  );
  assert.deepEqual(crop, { left: 200, top: 100, width: 2560, height: 1440 });

  const clamped = shot.cropToVideo(
    { left: -10, top: 0, width: 1600, height: 900 },
    { width: 1500, height: 900 },
    { width: 1500, height: 900 },
  );
  assert.deepEqual(clamped, { left: 0, top: 0, width: 1500, height: 900 });
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
