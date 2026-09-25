import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { createModuleTestServer } from './lib/vite-test-server.mjs';

let server;
let companies;
let schema;
let scene;
let ring;
let quat;
let mat4;
let Engine;
let Moons;
let Camera;
let QUALITY_PRESETS;
let asset;

before(async () => {
  server = await createModuleTestServer();
  [
    { companies },
    schema,
    scene,
    ring,
    { quat },
    { mat4 },
    { Engine },
    { Moons },
    { Camera },
    { QUALITY_PRESETS },
  ] = await Promise.all([
    server.ssrLoadModule('/src/content/companies.ts'),
    server.ssrLoadModule('/src/content/schema.ts'),
    server.ssrLoadModule('/src/engine/Scene.ts'),
    server.ssrLoadModule('/src/engine/OrbitingModels.ts'),
    server.ssrLoadModule('/src/engine/math/quat.ts'),
    server.ssrLoadModule('/src/engine/math/mat4.ts'),
    server.ssrLoadModule('/src/engine/Engine.ts'),
    server.ssrLoadModule('/src/engine/Moons.ts'),
    server.ssrLoadModule('/src/engine/Camera.ts'),
    server.ssrLoadModule('/src/engine/QualityManager.ts'),
  ]);
  const { parseGlb } = await server.ssrLoadModule('/src/engine/gltf/loader.ts');
  asset = parseGlb(
    new Uint8Array(
      await readFile(
        new URL('../public/models/broken-ring.glb', import.meta.url),
      ),
    ),
  );
});

after(async () => {
  await server?.close();
});

function company(enabled = true, slug = 'microsoft') {
  const microsoft = companies.find((company) => company.slug === 'microsoft');
  return schema.companySchema.parse({
    ...microsoft,
    slug,
    features: { ...microsoft.features, ringWorld: enabled },
  });
}

function planet(overrides = {}) {
  const [model] = scene.buildPlanetModels([company()]);
  return {
    ...scene.instanceFromModel(model, 0, 0, quat.identity(), 1, 1),
    ...overrides,
  };
}

function frame(instances, visible = true) {
  return {
    ringWorlds: instances,
    view: mat4.create(),
    viewProj: mat4.create(),
    cameraPos: [5, 2, 10],
    keyLightDir: [0.4, 0.85, -0.45],
    frustum: { intersectsSphere: () => visible },
    wireframe: false,
  };
}

function near(a, b, epsilon = 1e-5) {
  assert.ok(Math.abs(a - b) < epsilon, `${a} differs from ${b}`);
}

test('ringWorld defaults false, rejects invalid flags, and is enabled only for Microsoft', () => {
  const authored = company();
  delete authored.features.ringWorld;
  assert.equal(schema.companySchema.parse(authored).features.ringWorld, false);
  authored.features.ringWorld = 'true';
  assert.throws(() => schema.companySchema.parse(authored));
  assert.deepEqual(
    companies.filter((c) => c.features.ringWorld).map((c) => c.slug),
    ['microsoft'],
  );
});

test('enabling the ring does not perturb existing moon, satellite, terrain or POI seeds', () => {
  const [off] = scene.buildPlanetModels([company(false)]);
  const [on] = scene.buildPlanetModels([company(true)]);
  assert.deepEqual(off.moonSpecs, on.moonSpecs);
  assert.deepEqual(off.satelliteSpecs, on.satelliteSpecs);
  assert.deepEqual(off.poiDirs, on.poiDirs);
  assert.equal(off.seed, on.seed);
  assert.equal(
    scene.instanceFromModel(off, 0, 0, quat.identity(), 1, 1).ringWorld,
    false,
  );
  assert.equal(
    scene.instanceFromModel(on, 0, 0, quat.identity(), 1, 1).ringWorld,
    true,
  );
});

test('each enabled planet gets one deterministic decorative orbit close to its surface', () => {
  const p = planet();
  assert.deepEqual(ring.buildRingWorlds([planet({ ringWorld: false })], 0), []);
  const [instance] = ring.buildRingWorlds([p], 4);
  const [same] = ring.buildRingWorlds([p], 4);
  assert.deepEqual(instance, same);
  assert.equal(instance.planet, p.slug);
  near(instance.radius, p.radius * 0.5);
  const distance = Math.hypot(
    ...instance.center.map((x, i) => x - p.center[i]),
  );
  near(distance, p.radius + instance.radius + p.radius * 0.08);
  assert.ok(distance < p.moons[0].orbitRadius);
  near(Math.hypot(...instance.orientation), 1);
  assert.notDeepEqual(ring.buildRingWorlds([p], 5)[0].center, instance.center);
  assert.equal(
    ring.buildRingWorlds([p, planet({ slug: 'another' })], 4).length,
    2,
  );
});

test('ring center and orientation follow parent translations and rotations', () => {
  const p = planet();
  const [a] = ring.buildRingWorlds([p], 2);
  const move = [4, 3, -6];
  const [b] = ring.buildRingWorlds([planet({ center: move })], 2);
  a.center.forEach((value, i) => near(b.center[i] - value, move[i]));
  const rotation = quat.fromAxisAngle([0, 1, 0], Math.PI / 2);
  const [c] = ring.buildRingWorlds([planet({ orientation: rotation })], 2);
  const expected = quat.rotateVec3(rotation, a.center);
  c.center.forEach((value, i) => near(value, expected[i]));
  assert.deepEqual(c.orientation, quat.multiply(rotation, a.orientation));
});

test('ring face stays parallel to the planet surface with its normal along the radial direction', () => {
  for (const orientation of [
    quat.identity(),
    quat.multiply(
      quat.fromAxisAngle([1, 0, 0], 0.7),
      quat.fromAxisAngle([0, 1, 0], -1.2),
    ),
  ]) {
    for (const visibility of [0.03, 0.5, 1]) {
      const p = planet({ center: [3, -2, 5], orientation, visibility });
      for (const time of [0, 4, 12, 35, 100]) {
        const [instance] = ring.buildRingWorlds([p], time);
        const radial = instance.center.map(
          (value, index) => value - p.center[index],
        );
        const radialLength = Math.hypot(...radial);
        const normal = quat.rotateVec3(instance.orientation, [0, 0, 1]);
        normal.forEach((value, index) =>
          near(value, radial[index] / radialLength),
        );
        for (const axis of [
          [1, 0, 0],
          [0, 1, 0],
        ]) {
          const faceAxis = quat.rotateVec3(instance.orientation, axis);
          near(
            faceAxis.reduce(
              (dot, value, index) =>
                dot + (value * radial[index]) / radialLength,
              0,
            ),
            0,
          );
        }
      }
    }
  }
});

test('ring preserves its in-plane spin after aligning its face to the surface', () => {
  const p = planet();
  const time = 4;
  const [instance] = ring.buildRingWorlds([p], time);
  const relativeCenter = instance.center.map(
    (value, index) => value - p.center[index],
  );
  const angle = Math.atan2(
    relativeCenter[1] / Math.sin(0.75),
    relativeCenter[0],
  );
  const orbitOrientation = quat.multiply(
    quat.fromAxisAngle([1, 0, 0], -0.75),
    quat.fromAxisAngle([0, 1, 0], -angle),
  );
  const aligned = quat.multiply(
    orbitOrientation,
    quat.fromAxisAngle([0, 1, 0], Math.PI / 2),
  );
  const spin = 0.65 + time * 0.045;
  const expected = quat.rotateVec3(aligned, [
    Math.cos(spin),
    Math.sin(spin),
    0,
  ]);
  const faceAxis = quat.rotateVec3(instance.orientation, [1, 0, 0]);
  faceAxis.forEach((value, index) => near(value, expected[index]));
});

test('visibility scales the orbit and body like moons, then removes the hidden ring', () => {
  const [full] = ring.buildRingWorlds([planet()], 2);
  const [half] = ring.buildRingWorlds([planet({ visibility: 0.5 })], 2);
  near(half.radius, full.radius * 0.5);
  half.center.forEach((value, i) => near(value, full.center[i] * 0.5));
  for (const visibility of [0, 0.02]) {
    assert.deepEqual(ring.buildRingWorlds([planet({ visibility })], 2), []);
  }
});

test('the engine pause gate freezes the ring clock rather than using wall time', () => {
  const engine = Object.create(Engine.prototype);
  engine.paused = true;
  engine.time = 10;
  engine.moonTime = 4;
  let updates = 0;
  engine.updateRotations = () => updates++;
  const before = ring.buildRingWorlds([planet()], engine.moonTime);
  engine.advanceClocks(1, 90000);
  assert.deepEqual(ring.buildRingWorlds([planet()], engine.moonTime), before);
  assert.equal(updates, 0);
  engine.paused = false;
  engine.advanceClocks(1, 91000);
  assert.equal(engine.moonTime, 5);
  assert.equal(updates, 1);
  assert.notDeepEqual(
    ring.buildRingWorlds([planet()], engine.moonTime),
    before,
  );
});

test('multiple ring parents share geometry/textures with independent mutable draw transforms', () => {
  const original = asset.draws.map((draw) => Array.from(draw.transform));
  const instanceScene = new ring.OrbitingModelScene(
    ring.ORBITING_MODELS.ringWorld,
    asset,
    ['microsoft', 'another'],
  );
  assert.equal(instanceScene.asset.primitives, asset.primitives);
  assert.equal(instanceScene.asset.images, asset.images);
  assert.equal(instanceScene.asset.materials, asset.materials);
  assert.equal(instanceScene.asset.draws.length, asset.draws.length * 2);
  const instances = ring.buildRingWorlds(
    [planet(), planet({ slug: 'another', center: [20, 0, 0] })],
    2,
  );
  const modelFrame = instanceScene.update(frame(instances));
  assert.equal(modelFrame.output, 'linear');
  assert.equal(modelFrame.fog.density, 0.018);
  const [a, , b] = instanceScene.asset.draws;
  near(b.transform[12] - a.transform[12], 20);
  assert.ok(instanceScene.asset.draws.every((draw) => draw.visible));
  assert.deepEqual(
    asset.draws.map((draw) => Array.from(draw.transform)),
    original,
  );
  const before = a.transform[12];
  instanceScene.update(frame(ring.buildRingWorlds([planet()], 6)));
  assert.notEqual(a.transform[12], before);
  assert.equal(b.visible, false);
  assert.equal(instanceScene.update(frame(instances, false)), null);
  assert.ok(instanceScene.asset.draws.every((draw) => !draw.visible));
  assert.equal(instanceScene.update(frame([])), null);
});

test('ring bounds include debris, LDR output is linear-tonemapped, and bad parent setup fails', () => {
  const instanceScene = new ring.OrbitingModelScene(
    ring.ORBITING_MODELS.ringWorld,
    asset,
    ['microsoft'],
  );
  const instances = ring.buildRingWorlds([planet()], 0);
  const modelFrame = instanceScene.update(
    { ...frame(instances), wireframe: true },
    false,
  );
  assert.equal(modelFrame.output, 'tonemapped');
  assert.equal(modelFrame.wireframe, true);
  for (const draw of instanceScene.asset.draws) {
    const vertices = asset.primitives[draw.primitive].vertices;
    for (let i = 0; i < vertices.length; i += 18) {
      const t = draw.transform;
      const x =
        t[0] * vertices[i] +
        t[4] * vertices[i + 1] +
        t[8] * vertices[i + 2] +
        t[12];
      const y =
        t[1] * vertices[i] +
        t[5] * vertices[i + 1] +
        t[9] * vertices[i + 2] +
        t[13];
      const z =
        t[2] * vertices[i] +
        t[6] * vertices[i + 1] +
        t[10] * vertices[i + 2] +
        t[14];
      assert.ok(
        Math.hypot(
          x - instances[0].center[0],
          y - instances[0].center[1],
          z - instances[0].center[2],
        ) <=
          instances[0].radius + 1e-5,
      );
    }
  }
  assert.throws(
    () =>
      new ring.OrbitingModelScene(ring.ORBITING_MODELS.ringWorld, asset, []),
    /nonempty/,
  );
  assert.throws(
    () =>
      new ring.OrbitingModelScene(ring.ORBITING_MODELS.ringWorld, asset, [
        'x',
        'x',
      ]),
    /unique/,
  );
  assert.throws(
    () => instanceScene.update(frame([{ ...instances[0], planet: 'missing' }])),
    /initialized/,
  );
});

test('engine includes orbiting rings even when the parent planet system is culled', () => {
  const engine = Object.create(Engine.prototype);
  engine.models = scene.buildPlanetModels([company()]);
  engine.regenerationTimes = new Map();
  engine.moons = new Moons();
  engine.moonTime = 2;
  engine.time = 2;
  engine.cloudTimes = [2];
  engine.orientations = [quat.identity()];
  engine.scrubCurrent = 0;
  engine.sun = { center: [40, 90, -30], radius: 5, color: [1, 1, 1] };
  engine.settings = {
    freeCamera: false,
    flightPath: false,
    wireframe: false,
    crt: false,
  };
  engine.activeQuality = QUALITY_PRESETS.low;
  engine.camera = new Camera();
  engine.camera.update(0);
  engine.camera.frustum = { intersectsSphere: () => false };
  let captured;
  engine.renderer = {
    render: (value) => {
      captured = value;
    },
  };
  engine.renderFrame(0);
  assert.deepEqual(captured.planets, []);
  assert.equal(captured.ringWorlds.length, 1);
  assert.equal(captured.ringWorlds[0].planet, 'microsoft');
  assert.equal(captured.moons.length, company().features.moons);
});

test('ring loading is gated by the flag and failures do not block the timeline', async (t) => {
  const oldFetch = globalThis.fetch;
  const requests = [];
  const warnings = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response('missing', { status: 404 });
  };
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  const engine = Object.create(Engine.prototype);
  engine.models = scene.buildPlanetModels([company()]);
  engine.startupAbort = new AbortController();
  engine.destroyed = false;
  engine.renderer = {
    loadOrbitingModel: () =>
      assert.fail('A missing asset must not reach the renderer'),
  };
  await engine.loadOrbitingModels();
  assert.deepEqual(requests, ['/models/broken-ring.glb']);
  assert.match(String(warnings[0]?.[1]), /HTTP 404/);
  requests.length = 0;
  engine.models = scene.buildPlanetModels([company(false)]);
  await engine.loadOrbitingModels();
  assert.deepEqual(requests, []);
});
