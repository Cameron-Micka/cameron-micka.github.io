import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server;
let Engine;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  ({ Engine } = await server.ssrLoadModule('/src/engine/Engine.ts'));
});

after(async () => {
  await server?.close();
});

function orbitProbe(t) {
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  // Exercise the real orbit handlers without constructing a canvas or renderer.
  const engine = Object.assign(Object.create(Engine.prototype), {
    openPoi: null,
    settings: { freeCamera: false },
    models: [{}],
    orientations: [[0, 0, 0, 1]],
    cloudPace: [1],
    cloudTimes: [0],
    scrubCurrent: 0,
    paused: false,
  });
  engine.onOrbitStart();
  return {
    engine,
    move(dx, dy, elapsed) {
      now += elapsed;
      engine.onOrbit(dx, dy);
    },
    release(delay = 0, cancelled = false) {
      now += delay;
      engine.onOrbitEnd(cancelled);
    },
    speed() {
      return Math.hypot(...engine.orbitVelocity);
    },
    coast(dt) {
      now += dt * 1000;
      engine.updateRotations(dt, now);
    },
  };
}

function near(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `${actual} should be close to ${expected}`,
  );
}

test('the same drag distance produces more momentum when swiped faster', (t) => {
  const probe = orbitProbe(t);
  probe.move(40, 0, 100);
  probe.release();
  const slowSpeed = probe.speed();
  probe.coast(0.1);
  const slowAngle = 2 * Math.atan2(
    probe.engine.orientations[0][1],
    probe.engine.orientations[0][3],
  );

  probe.engine.onOrbitStart();
  probe.engine.orientations[0] = [0, 0, 0, 1];
  probe.move(40, 0, 25);
  probe.release();
  near(probe.speed(), slowSpeed * 4);
  probe.coast(0.1);
  const fastAngle = 2 * Math.atan2(
    probe.engine.orientations[0][1],
    probe.engine.orientations[0][3],
  );
  assert.ok(fastAngle > slowAngle);
});

test('velocity tracking is consistent from 60 Hz through 240 Hz', (t) => {
  const probe = orbitProbe(t);
  for (const hz of [60, 120, 240]) {
    probe.engine.onOrbitStart();
    for (let i = 0; i < hz / 10; i++) {
      probe.move(800 / hz, 0, 1000 / hz);
    }
    near(probe.speed(), 8);
    // Acceleration uses elapsed time rather than the number of events.
    for (let i = 0; i < hz / 10; i++) {
      probe.move(1600 / hz, 0, 1000 / hz);
    }
    near(probe.speed(), 16 - 8 * Math.exp(-0.1 / 0.04));
  }
});

test('a tiny final movement does not wipe out a fast flick', (t) => {
  const probe = orbitProbe(t);
  probe.move(20, 0, 20);
  const speed = probe.speed();
  probe.move(0.1, 0, 5);
  probe.release();
  assert.ok(probe.speed() > speed * 0.8);
  assert.ok(probe.speed() < speed);
});

test('a deliberate reversal changes the fling direction', (t) => {
  const probe = orbitProbe(t);
  probe.move(20, 0, 20);
  for (let i = 0; i < 5; i++) probe.move(-20, 0, 20);
  probe.release();
  assert.ok(probe.engine.orbitVelocity[1] < 0);
});

test('coasting is frame-rate independent and gradually comes to rest', (t) => {
  const probe = orbitProbe(t);
  const results = [];
  for (const hz of [30, 60, 144]) {
    probe.engine.onOrbitStart();
    probe.engine.orientations[0] = [0, 0, 0, 1];
    probe.move(20, 10, 20);
    probe.release();
    const initialSpeed = probe.speed();
    for (let i = 0; i < hz / 2; i++) probe.coast(1 / hz);
    assert.ok(probe.speed() < initialSpeed);
    results.push([...probe.engine.orientations[0], probe.speed()]);
  }
  for (const result of results.slice(1)) {
    result.forEach((value, i) => near(value, results[0][i]));
  }
  for (let i = 0; i < 240; i++) probe.coast(1 / 60);
  near(probe.speed(), 0);
});

test('holding still, cancellation, and grabbing again stop momentum', (t) => {
  const probe = orbitProbe(t);
  probe.move(20, 0, 20);
  probe.release(150);
  near(probe.speed(), 0);
  probe.engine.onOrbitStart();
  probe.move(20, 0, 20);
  probe.release(0, true);
  near(probe.speed(), 0);
  probe.engine.onOrbitStart();
  probe.move(20, 0, 20);
  probe.release();
  assert.ok(probe.speed() > 0);
  probe.engine.onOrbitStart();
  near(probe.speed(), 0);
  probe.release();
  near(probe.speed(), 0);
});

test('reduced motion allows direct rotation but no release momentum', (t) => {
  const probe = orbitProbe(t);
  probe.engine.paused = true;
  probe.move(20, 10, 20);
  assert.notDeepEqual(probe.engine.orientations[0], [0, 0, 0, 1]);
  probe.release();
  near(probe.speed(), 0);
});

test('extreme input remains bounded and diagonal flings follow the drag axis', (t) => {
  const probe = orbitProbe(t);
  probe.move(100, 100, 0);
  assert.ok(probe.speed() <= 20 + 1e-9);
  assert.ok(probe.engine.orbitVelocity.every(Number.isFinite));
  const orientation = [...probe.engine.orientations[0]];
  probe.coast(0.01);
  assert.deepEqual(probe.engine.orientations[0], orientation);
  probe.release();
  probe.coast(0.1);
  const axis = orientation.slice(0, 3);
  const length = Math.hypot(...axis);
  axis.forEach((value, i) =>
    near(probe.engine.orbitVelocity[i] / probe.speed(), value / length),
  );
});
