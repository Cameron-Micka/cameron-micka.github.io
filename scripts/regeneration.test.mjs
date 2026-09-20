import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server;
let InputController;
let Engine;
let scene;
let company;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    appType: 'custom',
    server: { middlewareMode: true, hmr: { port: 24679 }, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  ({ InputController } = await server.ssrLoadModule(
    '/src/engine/InputController.ts',
  ));
  ({ Engine } = await server.ssrLoadModule('/src/engine/Engine.ts'));
  scene = await server.ssrLoadModule('/src/engine/Scene.ts');
  const { companySchema } = await server.ssrLoadModule(
    '/src/content/schema.ts',
  );
  company = companySchema.parse({
    slug: 'test',
    name: 'Test',
    role: 'Test',
    start: '2020',
    end: '2022',
    summary: '',
    seed: 'test',
    palette: { low: '#112233', mid: '#445566', high: '#aabbcc' },
    features: { rings: false, moons: 2 },
    pois: [{ slug: 'project', title: 'Project', accent: '#ffffff', body: '' }],
  });
});

after(async () => {
  await server?.close();
});

function inputProbe() {
  const picks = [];
  const drags = [];
  const controller = new InputController(
    new Proxy(
      {
        onPick: (...args) => picks.push(args),
        onBodyDragStart: () => true,
        onBodyDrag: () => drags.push('move'),
        onBodyDragEnd: () => drags.push('end'),
      },
      { get: (target, key) => target[key] ?? (() => {}) },
    ),
  );
  controller.el = {
    style: { cursor: '' },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture() {},
    hasPointerCapture: () => false,
  };
  controller.scheduleScrubEnd = () => {};
  const pointer = (x = 400, y = 300, button = 0) => ({
    clientX: x,
    clientY: y,
    button,
    pointerId: 1,
    pointerType: 'mouse',
  });
  const click = (x = 400, y = 300, button = 0) => {
    controller.onPointerDown(pointer(x, y, button));
    controller.onPointerUp(pointer(x, y, button));
  };
  const touch = (x = 400, y = 300, identifier = 1) => ({
    clientX: x,
    clientY: y,
    identifier,
  });
  const touchEvent = (type, touches, changedTouches) => ({
    type,
    touches,
    changedTouches,
    preventDefault() {},
  });
  const tap = (x = 400, y = 300) => {
    const t = touch(x, y);
    controller.onTouchStart(touchEvent('touchstart', [t], [t]));
    controller.onTouchEnd(touchEvent('touchend', [], [t]));
  };
  return { controller, picks, drags, pointer, click, touch, touchEvent, tap };
}

for (const freeMode of [false, true]) {
  for (const gesture of ['click', 'tap']) {
    test(`${gesture} pairs work in ${freeMode ? 'free' : 'timeline'} mode`, () => {
      const probe = inputProbe();
      probe.controller.setFreeMode(freeMode);
      probe[gesture]();
      probe[gesture]();
      probe[gesture]();
      assert.deepEqual(
        probe.picks.map((p) => p[2]),
        [false, true, false],
      );
      assert.deepEqual(probe.picks[0].slice(0, 2), [0, -0]);
    });
  }
}

test('double picks require matching input source, position and timing', (t) => {
  const { controller, click, tap, picks } = inputProbe();
  let now = 100;
  t.mock.method(performance, 'now', () => now);
  click();
  now += 351;
  click();
  click(420);
  tap(420);
  assert.ok(picks.every((p) => !p[2]));
  controller.onWindowBlur();
  tap(420);
  assert.equal(picks.at(-1)[2], false);
  tap(430);
  assert.equal(picks.at(-1)[2], true);
});

test('orbit and body drags do not count as clicks or bridge click pairs', () => {
  for (const freeMode of [false, true]) {
    const { controller, click, pointer, picks, drags } = inputProbe();
    controller.setFreeMode(freeMode);
    click();
    controller.onPointerDown(pointer());
    controller.onPointerMove(pointer(430));
    controller.onPointerMove(pointer());
    controller.onPointerUp(pointer());
    click();
    assert.deepEqual(
      picks.map((p) => p[2]),
      [false, false],
    );
    if (freeMode) assert.ok(drags.includes('move'));
  }
});

test('touch drags, multitouch and cancellation cannot trigger double taps', () => {
  for (const freeMode of [false, true]) {
    for (const interruption of ['drag', 'multitouch', 'cancel']) {
      const { controller, tap, touch, touchEvent, picks } = inputProbe();
      controller.setFreeMode(freeMode);
      tap();
      const a = touch();
      controller.onTouchStart(touchEvent('touchstart', [a], [a]));
      if (interruption === 'drag') {
        const moved = touch(440);
        controller.onTouchMove(touchEvent('touchmove', [moved], [moved]));
      } else if (interruption === 'multitouch') {
        const b = touch(500, 300, 2);
        controller.onTouchStart(touchEvent('touchstart', [a, b], [b]));
      }
      controller.onTouchEnd(
        touchEvent(
          interruption === 'cancel' ? 'touchcancel' : 'touchend',
          [],
          [a],
        ),
      );
      tap();
      assert.deepEqual(
        picks.map((p) => p[2]),
        [false, false],
        `${freeMode}: ${interruption}`,
      );
    }
  }
});

test('secondary buttons and mode switches break click pairs', () => {
  const { controller, click, picks } = inputProbe();
  click();
  click(400, 300, 2);
  click();
  controller.setFreeMode(true);
  click();
  assert.deepEqual(
    picks.map((p) => p[2]),
    [false, false, false],
  );
});

test('planet regeneration changes appearance but preserves career data and attachments', () => {
  const [model] = scene.buildPlanetModels([company]);
  const original = structuredClone(model);
  const companyBefore = structuredClone(company);
  for (let i = 0; i < 10; i++) {
    const seed = model.seed;
    scene.regeneratePlanet(model, () => 0.25);
    assert.notEqual(model.seed % 100000, seed % 100000);
    assert.deepEqual(company, companyBefore);
    for (const key of [
      'company',
      'radius',
      'center',
      'index',
      'z',
      'poiDirs',
      'moonSpecs',
      'satelliteSpecs',
    ]) {
      assert.deepEqual(model[key], original[key], key);
    }
    const instance = scene.instanceFromModel(model, 0, 0, [0, 0, 0, 1], 1, 1);
    assert.equal(instance.seed, model.seed);
    assert.equal(instance.hasRing, true);
    assert.equal(instance.oceans, true);
    assert.notDeepEqual(instance.paletteMid, original.paletteMid);
    for (const palette of [
      instance.paletteLow,
      instance.paletteMid,
      instance.paletteHigh,
    ]) {
      assert.ok(palette.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
    }
  }
  assert.deepEqual(scene.buildPlanetModels([company])[0], original);
});

test('sun regeneration always changes size and color within bounded ranges', () => {
  const sun = { center: [0, 0, -40], radius: 20, color: [1, 0.66, 0.3] };
  for (const random of [0, 0.25, 0.5, 0.999999, 0.999999]) {
    const old = structuredClone(sun);
    scene.regenerateSun(sun, () => random);
    assert.notDeepEqual(sun.color, old.color);
    assert.ok(Math.abs(sun.radius - old.radius) >= 2);
    assert.ok(sun.radius >= 12 && sun.radius <= 28);
    assert.deepEqual(sun.center, old.center);
  }
});

function engineProbe(freeCamera = false) {
  const engine = Object.create(Engine.prototype);
  engine.models = scene.buildPlanetModels([company]);
  engine.sun = { center: [0, 0, -40], radius: 20, color: [1, 0.66, 0.3] };
  engine.settings = { freeCamera };
  engine.openPoi = null;
  engine.focusedIndex = -1;
  engine.lastPickedBody = null;
  engine.renderDirty = false;
  engine.flightPathDirty = false;
  engine.planetVisibility = () => 1;
  engine.bodyPointerRay = () => ({ origin: [0, 0, 10], dir: [0, 0, -1] });
  engine.moons = { pick: () => null, launch() {} };
  engine.jumpToPlanet = () => {};
  return engine;
}

for (const freeCamera of [false, true]) {
  test(`picking regenerates only the same nearest body in ${freeCamera ? 'free' : 'timeline'} mode`, () => {
    const engine = engineProbe(freeCamera);
    const model = engine.models[0];
    const seed = model.seed;
    const sunBefore = structuredClone(engine.sun);
    engine.handlePick(0, 0);
    assert.equal(model.seed, seed);
    engine.handlePick(0, 0, true);
    assert.notEqual(model.seed, seed);
    assert.deepEqual(engine.sun, sunBefore);
    assert.equal(engine.renderDirty, true);
    assert.equal(engine.flightPathDirty, true);

    engine.handlePick(0, 0);
    model.center = [20, 0, 0];
    engine.handlePick(0, 0, true);
    assert.deepEqual(
      engine.sun,
      sunBefore,
      'different bodies cannot form a pair',
    );
    engine.handlePick(0, 0);
    engine.handlePick(0, 0, true);
    assert.notDeepEqual(engine.sun.color, sunBefore.color);
    assert.notEqual(engine.sun.radius, sunBefore.radius);
  });
}

test('hidden planets, moons, empty space and modals do not regenerate planets', () => {
  for (const blocker of ['hidden', 'moon', 'empty', 'modal']) {
    const engine = engineProbe();
    const before = structuredClone(engine.models);
    if (blocker === 'hidden') engine.planetVisibility = () => 0;
    if (blocker === 'moon') {
      engine.moons.pick = () => ({ center: [0, 0, 5], radius: 0.2 });
    }
    if (blocker === 'empty') {
      engine.bodyPointerRay = () => ({ origin: [50, 0, 10], dir: [0, 0, -1] });
    }
    if (blocker === 'modal')
      engine.openPoi = { company: 'test', poi: 'project' };
    engine.handlePick(0, 0);
    engine.handlePick(0, 0, true);
    assert.deepEqual(engine.models, before, blocker);
  }
});

test('foreground POIs retain single-click priority over regeneration', () => {
  const engine = engineProbe();
  const model = engine.models[0];
  const seed = model.seed;
  engine.focusedIndex = 0;
  engine.orientations = [[0, 0, 0, 1]];
  engine.camera = { proj: new Float32Array(16).fill(1), position: [0, 0, 10] };
  model.poiDirs[0].dir = [0, 0, 1];
  const opened = [];
  engine.openPoiRef = (...args) => opened.push(args);
  engine.handlePick(0, 0);
  engine.handlePick(0, 0, true);
  assert.equal(model.seed, seed);
  assert.equal(engine.lastPickedBody, null);
  assert.deepEqual(opened[0], ['test', 'project']);
});

test('a foreground sun blocks planet and POI picks', () => {
  const engine = engineProbe();
  const model = engine.models[0];
  const seed = model.seed;
  engine.sun.center = [0, 0, 6];
  engine.sun.radius = 2;
  engine.focusedIndex = 0;
  engine.orientations = [[0, 0, 0, 1]];
  engine.camera = { proj: new Float32Array(16).fill(1), position: [0, 0, 10] };
  model.poiDirs[0].dir = [0, 0, 1];
  engine.openPoiRef = () => assert.fail('occluded POI opened');
  engine.jumpToPlanet = () => assert.fail('occluded planet focused');
  engine.handlePick(0, 0);
  engine.handlePick(0, 0, true);
  assert.equal(model.seed, seed);
  assert.notEqual(engine.sun.radius, 2);
});

test('regeneration picks use the CRT-adjusted ray and visible planet radius', () => {
  const engine = engineProbe();
  delete engine.bodyPointerRay;
  engine.camera = {
    invViewProj: new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]),
  };
  engine.settings.crt = true;
  const model = engine.models[0];
  const x = 0.8;
  const scaledX = (x * (1 + 0.08 * x * x * 0.25)) / (1 + 0.08 * 0.5);
  model.center = [scaledX, 0, 10];
  model.radius = 0.005;
  engine.planetVisibility = () => 0.5;
  const seed = model.seed;
  engine.handlePick(x, 0);
  engine.handlePick(x, 0, true);
  assert.notEqual(model.seed, seed);
  const nextSeed = model.seed;
  engine.handlePick(x + 0.004, 0);
  engine.handlePick(x + 0.004, 0, true);
  assert.equal(model.seed, nextSeed, 'outside the faded disc must miss');
});
