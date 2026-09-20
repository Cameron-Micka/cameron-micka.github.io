import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server;
let InputController;
let Engine;
let TinyEventEmitter;
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
  ({ TinyEventEmitter } = await server.ssrLoadModule(
    '/src/engine/TinyEventEmitter.ts',
  ));
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
  engine.regenerationTimes = new Map();
  engine.time = 0;
  engine.paused = false;
  engine.events = new TinyEventEmitter();
  engine.renderDirty = false;
  engine.flightPathDirty = false;
  engine.planetVisibility = () => 1;
  engine.bodyPointerRay = () => ({ origin: [0, 0, 10], dir: [0, 0, -1] });
  engine.moons = { pick: () => null, launch() {} };
  engine.jumpToPlanet = () => {};
  return engine;
}

function regenerate(engine) {
  engine.handlePick(0, 0);
  engine.handlePick(0, 0, true);
}

test('regenerated bodies scale in, overshoot and settle without changing model sizes', () => {
  const engine = engineProbe(true);
  const model = engine.models[0];
  const radius = model.radius;
  regenerate(engine);
  assert.ok(Math.abs(engine.bodyRadius(model) / radius - 0.15) < 1e-9);
  engine.time = 0.15;
  assert.ok(engine.bodyRadius(model) > radius * 0.8);
  engine.time = 0.3;
  assert.ok(engine.bodyRadius(model) > radius);
  engine.time = 0.5;
  assert.equal(engine.bodyRadius(model), radius);
  assert.equal(engine.regenerationTimes.size, 0);
  assert.equal(model.radius, radius);

  model.center = [30, 0, 0];
  regenerate(engine);
  const sunRadius = engine.sun.radius;
  assert.ok(Math.abs(engine.bodyRadius(engine.sun) / sunRadius - 0.15) < 1e-9);
  engine.time = 1;
  assert.equal(engine.bodyRadius(engine.sun), sunRadius);
  assert.equal(engine.sun.radius, sunRadius);
});

test('repeat regeneration restarts the animation and bodies animate independently', () => {
  const engine = engineProbe(true);
  const model = engine.models[0];
  regenerate(engine);
  engine.time = 0.2;
  regenerate(engine);
  assert.equal(engine.regenerationTimes.get(model), 0.2);
  model.center = [30, 0, 0];
  engine.time = 0.3;
  regenerate(engine);
  assert.equal(engine.regenerationTimes.get(engine.sun), 0.3);
  engine.time = 0.7;
  assert.equal(engine.bodyRadius(model), model.radius);
  assert.notEqual(engine.bodyRadius(engine.sun), engine.sun.radius);
  engine.time = 0.81;
  assert.equal(engine.bodyRadius(engine.sun), engine.sun.radius);
});

test('paused motion skips scale animation but still emits regeneration feedback', () => {
  const engine = engineProbe(true);
  const events = [];
  engine.events.on('bodyRegenerated', (event) => events.push(event));
  engine.paused = true;
  regenerate(engine);
  assert.equal(engine.bodyRadius(engine.models[0]), engine.models[0].radius);
  assert.equal(engine.regenerationTimes.size, 0);
  assert.deepEqual(events, [null]);
  engine.paused = false;
  regenerate(engine);
  assert.ok(engine.bodyRadius(engine.models[0]) < engine.models[0].radius);
  engine.paused = true;
  assert.equal(engine.bodyRadius(engine.models[0]), engine.models[0].radius);
  assert.equal(engine.regenerationTimes.size, 0);
});

test('only successful double picks emit regeneration feedback', () => {
  for (const freeCamera of [false, true]) {
    const engine = engineProbe(freeCamera);
    let count = 0;
    engine.events.on('bodyRegenerated', () => count++);
    engine.handlePick(0, 0);
    assert.equal(count, 0);
    engine.handlePick(0, 0, true);
    assert.equal(count, freeCamera ? 1 : 0);
    engine.models[0].center = [30, 0, 0];
    regenerate(engine);
    assert.equal(count, freeCamera ? 2 : 0);
    engine.openPoi = { company: 'test', poi: 'project' };
    regenerate(engine);
    assert.equal(count, freeCamera ? 2 : 0);
  }
});

test('rendering, shadows and moon collisions share animated body radii', () => {
  const engine = engineProbe(true);
  const model = engine.models[0];
  regenerate(engine);
  engine.regenerationTimes.set(engine.sun, 0);
  engine.scrubCurrent = 0;
  engine.cloudTimes = [];
  engine.orientations = [];
  engine.sceneCenter = [0, 0, 0];
  engine.camera = {
    frustum: { intersectsSphere: () => true },
  };
  engine.activeQuality = { shadows: true };
  let frame;
  engine.renderer = { render: (value) => (frame = value) };
  let collisionBodies;
  engine.moons.update = (planets, _time, _dt, sun) => {
    collisionBodies = { planets, sun };
  };
  engine.renderFrame(0);
  assert.equal(frame.planets[0].radius, engine.bodyRadius(model));
  assert.equal(frame.sun.radius, engine.bodyRadius(engine.sun));
  assert.equal(frame.shadowCasters[0].radius, frame.planets[0].radius);
  assert.equal(collisionBodies.planets[0].radius, frame.planets[0].radius);
  assert.equal(collisionBodies.sun.radius, frame.sun.radius);
  assert.equal(model.radius, scene.buildPlanetModels([company])[0].radius);
  engine.time = 0.5;
  engine.renderFrame(0);
  assert.equal(frame.planets[0].radius, model.radius);
  assert.equal(frame.sun.radius, engine.sun.radius);
});

test('picking and dragging miss the empty area around a scaling body', () => {
  const engine = engineProbe(true);
  const model = engine.models[0];
  regenerate(engine);
  engine.sun.center = [100, 0, -40];
  const seed = model.seed;
  engine.bodyPointerRay = () => ({
    origin: [model.radius * 0.5, 0, 10],
    dir: [0, 0, -1],
  });
  regenerate(engine);
  assert.equal(model.seed, seed);
  assert.equal(engine.startBodyDrag(0, 0), false);
  engine.time = 0.5;
  regenerate(engine);
  assert.notEqual(model.seed, seed);
});

for (const freeCamera of [false, true]) {
  test(`picking ${freeCamera ? 'regenerates only the same nearest body' : 'never regenerates bodies'} in ${freeCamera ? 'free' : 'timeline'} mode`, () => {
    const engine = engineProbe(freeCamera);
    const model = engine.models[0];
    const seed = model.seed;
    const sunBefore = structuredClone(engine.sun);
    engine.handlePick(0, 0);
    assert.equal(model.seed, seed);
    engine.handlePick(0, 0, true);
    assert.equal(model.seed !== seed, freeCamera);
    assert.deepEqual(engine.sun, sunBefore);
    assert.equal(engine.renderDirty, freeCamera);
    assert.equal(engine.flightPathDirty, freeCamera);

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
    if (freeCamera) {
      assert.notDeepEqual(engine.sun.color, sunBefore.color);
      assert.notEqual(engine.sun.radius, sunBefore.radius);
    } else {
      assert.deepEqual(engine.sun, sunBefore);
      assert.equal(engine.lastPickedBody, null);
    }
  });
}

test('hidden planets, moons, empty space and modals do not regenerate planets', () => {
  for (const blocker of ['hidden', 'moon', 'empty', 'modal']) {
    const engine = engineProbe(true);
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

test('timeline double picks still focus planets and launch moons', () => {
  const engine = engineProbe();
  const focused = [];
  engine.jumpToPlanet = (index) => focused.push(index);
  engine.handlePick(0, 0);
  engine.handlePick(0, 0, true);
  assert.deepEqual(focused, [0, 0]);
  const moon = { center: [0, 0, 5], radius: 0.2 };
  const launched = [];
  engine.moons.pick = () => moon;
  engine.moons.launch = (body) => launched.push(body);
  engine.handlePick(0, 0);
  engine.handlePick(0, 0, true);
  assert.deepEqual(launched, [moon, moon]);
  assert.deepEqual(focused, [0, 0]);
});

test('a foreground sun blocks planet and POI picks without regenerating in timeline mode', () => {
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
  assert.equal(engine.sun.radius, 2);
});

test('regeneration picks use the CRT-adjusted ray and visible planet radius', () => {
  const engine = engineProbe(true);
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
