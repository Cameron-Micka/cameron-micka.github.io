import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createModuleTestServer } from './lib/vite-test-server.mjs';

let server;
let OrbitCamera;
let rotateAround;

before(async () => {
  server = await createModuleTestServer();
  ({ OrbitCamera, rotateAround } = await server.ssrLoadModule(
    '/src/engine/gltf/OrbitCamera.ts',
  ));
});

after(async () => {
  await server?.close();
});

class Canvas extends EventTarget {
  clientHeight = 600;
  setPointerCapture() {}
  send(type, properties) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, properties);
    this.dispatchEvent(event);
    return event;
  }
}

test('orbit and roll maintain distance and valid camera matrices', () => {
  const camera = new OrbitCamera(new Canvas(), () => {});
  camera.position = [0, 0, 10];
  camera.orbit(Math.PI / 2);
  assert.ok(Math.abs(camera.position[0] - 10) < 1e-6);
  assert.ok(Math.abs(camera.position[2]) < 1e-6);
  camera.up = rotateAround([0, 1, 0], [1, 0, 0], 0.72);
  camera.orbit(0.1, 0.4);
  assert.ok(Math.abs(Math.hypot(...camera.position) - 10) < 1e-6);
  camera.update(4 / 3);
  assert.ok(camera.viewProjection.every(Number.isFinite));
  assert.equal(camera.projection[11], -1);
  camera.projectionOffsetY = 0.2;
  camera.update(4 / 3);
  assert.ok(Math.abs(camera.projection[9] + 0.2) < 1e-6);
  assert.ok(
    Math.abs(camera.viewProjection[13] / camera.viewProjection[15] - 0.2) <
      1e-6,
  );
  camera.dispose();
});

test('zoom clamps distance and pan moves target and camera together', () => {
  let changes = 0;
  const camera = new OrbitCamera(new Canvas(), () => changes++);
  camera.position = [0, 0, 10];
  camera.minDistance = 2;
  camera.maxDistance = 20;
  camera.zoom(100);
  assert.equal(camera.position[2], 20);
  camera.zoom(0.001);
  assert.equal(camera.position[2], 2);
  camera.pan(100, 30);
  assert.ok(camera.target[0] < 0);
  assert.ok(camera.target[1] > 0);
  assert.deepEqual(
    camera.position.map((value, i) => value - camera.target[i]),
    [0, 0, 2],
  );
  assert.equal(changes, 3);
  camera.dispose();
});

test('mouse orbit, two-pointer pinch, cancellation and teardown stop stale gestures', () => {
  const canvas = new Canvas();
  let changes = 0;
  const camera = new OrbitCamera(canvas, () => changes++);
  camera.position = [0, 0, 10];
  canvas.send('pointerdown', {
    pointerId: 1,
    button: 0,
    clientX: 50,
    clientY: 50,
  });
  canvas.send('pointermove', { pointerId: 1, clientX: 80, clientY: 60 });
  assert.equal(changes, 1);
  const oldDistance = Math.hypot(...camera.position);
  canvas.send('pointerdown', {
    pointerId: 2,
    button: 0,
    clientX: 180,
    clientY: 60,
  });
  canvas.send('pointermove', { pointerId: 2, clientX: 280, clientY: 60 });
  assert.ok(
    Math.hypot(...camera.position.map((value, i) => value - camera.target[i])) <
      oldDistance,
  );
  canvas.send('pointercancel', { pointerId: 1 });
  canvas.send('lostpointercapture', { pointerId: 2 });
  const settled = changes;
  canvas.send('pointermove', { pointerId: 1, clientX: 300, clientY: 70 });
  assert.equal(changes, settled);
  camera.dispose();
  canvas.send('wheel', { deltaY: 100, deltaMode: 0 });
  canvas.send('pointerdown', {
    pointerId: 3,
    button: 0,
    clientX: 0,
    clientY: 0,
  });
  canvas.send('pointermove', { pointerId: 3, clientX: 200, clientY: 0 });
  assert.equal(changes, settled);
});

test('wheel input handles pixel, line and page units without unbounded jumps', () => {
  for (const mode of [0, 1, 2]) {
    const canvas = new Canvas();
    const camera = new OrbitCamera(canvas, () => {});
    camera.position = [0, 0, 10];
    const event = canvas.send('wheel', { deltaY: 1, deltaMode: mode });
    assert.equal(event.defaultPrevented, true);
    assert.ok(camera.position[2] > 10 && camera.position[2] <= 10 * Math.E);
    camera.dispose();
  }
});
