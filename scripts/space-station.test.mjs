import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { createModuleTestServer } from './lib/vite-test-server.mjs';

let server;
let companies;
let schema;
let scene;
let orbiting;
let quat;
let mat4;
let Engine;
let Moons;
let Camera;
let QUALITY_PRESETS;
let WebGL2Renderer;
let WebGPURenderer;
let assets;
let files;

before(async () => {
  server = await createModuleTestServer();
  [
    { companies },
    schema,
    scene,
    orbiting,
    { quat },
    { mat4 },
    { Engine },
    { Moons },
    { Camera },
    { QUALITY_PRESETS },
    { WebGL2Renderer },
    { WebGPURenderer },
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
    server.ssrLoadModule('/src/engine/WebGL2Renderer.ts'),
    server.ssrLoadModule('/src/engine/WebGPURenderer.ts'),
  ]);
  const { parseGlb } = await server.ssrLoadModule('/src/engine/gltf/loader.ts');
  files = Object.fromEntries(
    await Promise.all(
      Object.values(orbiting.ORBITING_MODELS).map(async (definition) => [
        definition.feature,
        await readFile(
          new URL(`../public/${definition.path}`, import.meta.url),
        ),
      ]),
    ),
  );
  assets = Object.fromEntries(
    Object.entries(files).map(([feature, bytes]) => [
      feature,
      parseGlb(new Uint8Array(bytes)),
    ]),
  );
});

after(async () => {
  await server?.close();
});

function company(features = {}, slug = 'lucasarts') {
  const lucasarts = companies.find((entry) => entry.slug === 'lucasarts');
  return schema.companySchema.parse({
    ...lucasarts,
    slug,
    features: { ...lucasarts.features, ...features },
  });
}

function planet(overrides = {}) {
  const [model] = scene.buildPlanetModels([company()]);
  return {
    ...scene.instanceFromModel(model, 0, 0, quat.identity(), 1, 1),
    ...overrides,
  };
}

function frame(spaceStations = [], ringWorlds = [], visible = true) {
  return {
    spaceStations,
    ringWorlds,
    view: mat4.create(),
    viewProj: mat4.create(),
    cameraPos: [5, 2, 10],
    keyLightDir: [0.4, 0.85, -0.45],
    frustum: { intersectsSphere: () => visible },
    wireframe: false,
  };
}

function engineFor(authored = [company()]) {
  const engine = Object.create(Engine.prototype);
  engine.models = scene.buildPlanetModels(authored);
  engine.regenerationTimes = new Map();
  engine.startupAbort = new AbortController();
  engine.settings = { forceBackend: 'webgl2' };
  engine.activeQuality = QUALITY_PRESETS.low;
  engine.destroyed = false;
  return engine;
}

function near(a, b, epsilon = 1e-5) {
  assert.ok(Math.abs(a - b) < epsilon, `${a} differs from ${b}`);
}

function distance(a, b) {
  return Math.hypot(...a.map((value, index) => value - b[index]));
}

test('spaceStation defaults false, rejects invalid flags, and is enabled only for LucasArts', () => {
  const authored = company();
  delete authored.features.spaceStation;
  assert.equal(
    schema.companySchema.parse(authored).features.spaceStation,
    false,
  );
  for (const invalid of ['true', 1, null]) {
    authored.features.spaceStation = invalid;
    assert.throws(() => schema.companySchema.parse(authored));
  }
  assert.deepEqual(
    companies
      .filter((entry) => entry.features.spaceStation)
      .map((entry) => entry.slug),
    ['lucasarts'],
  );
  assert.equal(company().features.moons, 0);
});

test('the station flag preserves all existing planet and moon generation', () => {
  const [off] = scene.buildPlanetModels([
    company({ spaceStation: false, moons: 3 }),
  ]);
  const [on] = scene.buildPlanetModels([
    company({ spaceStation: true, moons: 3 }),
  ]);
  for (const key of [
    'moonSpecs',
    'satelliteSpecs',
    'poiDirs',
    'seed',
    'radius',
  ]) {
    assert.deepEqual(on[key], off[key], key);
  }
  assert.equal(
    scene.instanceFromModel(off, 0, 0, quat.identity(), 1, 1).spaceStation,
    false,
  );
  assert.equal(
    scene.instanceFromModel(on, 0, 0, quat.identity(), 1, 1).spaceStation,
    true,
  );
});

test('enabled planets get one deterministic, orbiting and rotating station outside their moons', () => {
  const p = planet({
    moons: [
      { orbitRadius: 4, size: 0.3 },
      { orbitRadius: 5, size: 0.2 },
    ],
  });
  assert.deepEqual(
    orbiting.buildSpaceStations([planet({ spaceStation: false })], 4),
    [],
  );
  const [station] = orbiting.buildSpaceStations([p], 4);
  assert.deepEqual(orbiting.buildSpaceStations([p], 4), [station]);
  assert.equal(station.planet, p.slug);
  near(station.radius, p.radius * 0.55);
  near(Math.hypot(...station.orientation), 1);
  const orbit = distance(station.center, p.center);
  assert.ok(orbit > p.radius + station.radius);
  assert.ok(
    p.moons.every(
      (moon) => orbit > moon.orbitRadius + moon.size + station.radius,
    ),
  );
  const [later] = orbiting.buildSpaceStations([p], 5);
  assert.notDeepEqual(later.center, station.center);
  assert.notDeepEqual(later.orientation, station.orientation);
  assert.equal(
    orbiting.buildSpaceStations([p, planet({ slug: 'another' })], 4).length,
    2,
  );
});

test('station and ring-world flags coexist without moving the ring or intersecting its orbit', () => {
  const p = planet({ ringWorld: true });
  for (const time of [0, 4, 12, 35, 120]) {
    const [ring] = orbiting.buildRingWorlds([p], time);
    assert.deepEqual(
      orbiting.buildRingWorlds([{ ...p, spaceStation: false }], time),
      [ring],
    );
    const [station] = orbiting.buildSpaceStations([p], time);
    assert.ok(
      distance(station.center, p.center) - distance(ring.center, p.center) >
        station.radius + ring.radius,
    );
    assert.ok(
      distance(station.center, ring.center) > station.radius + ring.radius,
    );
  }
});

test('stations follow parent movement, rotation, and timeline visibility', () => {
  const p = planet({ center: [2, 3, 4] });
  const [station] = orbiting.buildSpaceStations([p], 2);
  const move = [4, 3, -6];
  const [moved] = orbiting.buildSpaceStations(
    [{ ...p, center: p.center.map((value, index) => value + move[index]) }],
    2,
  );
  station.center.forEach((value, index) =>
    near(moved.center[index] - value, move[index]),
  );
  const rotation = quat.fromAxisAngle([0, 1, 0], Math.PI / 2);
  const [rotated] = orbiting.buildSpaceStations(
    [{ ...p, orientation: rotation }],
    2,
  );
  const offset = quat.rotateVec3(
    rotation,
    station.center.map((value, index) => value - p.center[index]),
  );
  rotated.center.forEach((value, index) =>
    near(value, p.center[index] + offset[index]),
  );
  assert.deepEqual(
    rotated.orientation,
    quat.multiply(rotation, station.orientation),
  );
  const [half] = orbiting.buildSpaceStations([{ ...p, visibility: 0.5 }], 2);
  near(half.radius, station.radius * 0.5);
  near(
    distance(half.center, p.center),
    distance(station.center, p.center) * 0.5,
  );
  for (const visibility of [0, 0.02]) {
    assert.deepEqual(
      orbiting.buildSpaceStations([{ ...p, visibility }], 2),
      [],
    );
  }
});

test('the paused moon clock freezes both station orbit and self-rotation', () => {
  const engine = engineFor();
  engine.paused = true;
  engine.time = 10;
  engine.moonTime = 4;
  let rotations = 0;
  engine.updateRotations = () => rotations++;
  const before = orbiting.buildSpaceStations([planet()], engine.moonTime);
  engine.advanceClocks(1, 90000);
  assert.deepEqual(
    orbiting.buildSpaceStations([planet()], engine.moonTime),
    before,
  );
  assert.equal(rotations, 0);
  engine.paused = false;
  engine.advanceClocks(1, 91000);
  assert.equal(engine.moonTime, 5);
  assert.equal(rotations, 1);
  assert.notDeepEqual(
    orbiting.buildSpaceStations([planet()], engine.moonTime),
    before,
  );
});

test('multiple station parents share both materials and all textures with independent transforms', () => {
  const asset = assets.spaceStation;
  const original = asset.draws.map((draw) => Array.from(draw.transform));
  const model = new orbiting.OrbitingModelScene(
    orbiting.ORBITING_MODELS.spaceStation,
    asset,
    ['lucasarts', 'another'],
  );
  assert.equal(
    new Set(asset.primitives.map((primitive) => primitive.material)).size,
    2,
  );
  for (const key of ['primitives', 'materials', 'textures', 'images']) {
    assert.equal(model.asset[key], asset[key], key);
  }
  assert.equal(model.asset.draws.length, asset.draws.length * 2);
  assert.equal(model.asset.stats.drawCalls, 4);
  assert.equal(model.asset.stats.triangles, asset.stats.triangles * 2);
  const instances = orbiting.buildSpaceStations(
    [planet(), planet({ slug: 'another', center: [20, 0, 0] })],
    2,
  );
  const modelFrame = model.update(frame(instances));
  assert.equal(modelFrame.output, 'linear');
  assert.equal(modelFrame.fog.density, 0.018);
  const [first, , second] = model.asset.draws;
  near(second.transform[12] - first.transform[12], 20);
  assert.notEqual(first.transform, second.transform);
  assert.deepEqual(
    asset.draws.map((draw) => Array.from(draw.transform)),
    original,
  );
  model.update(frame(instances.slice(0, 1)));
  assert.equal(first.visible, true);
  assert.equal(second.visible, false);
  assert.equal(model.update(frame(instances, [], false)), null);
  assert.ok(model.asset.draws.every((draw) => !draw.visible));
  assert.equal(model.update(frame()), null);
});

test('station bounds contain the saved GLB, LDR is tonemapped, and invalid instances fail explicitly', () => {
  const definition = orbiting.ORBITING_MODELS.spaceStation;
  const asset = assets.spaceStation;
  const model = new orbiting.OrbitingModelScene(definition, asset, [
    'lucasarts',
  ]);
  const instances = orbiting.buildSpaceStations([planet()], 0);
  const modelFrame = model.update(
    { ...frame(instances), wireframe: true },
    false,
  );
  assert.equal(modelFrame.output, 'tonemapped');
  assert.equal(modelFrame.wireframe, true);
  for (const draw of model.asset.draws) {
    const vertices = asset.primitives[draw.primitive].vertices;
    const t = draw.transform;
    for (let index = 0; index < vertices.length; index += 18) {
      const transformed = [0, 1, 2].map(
        (axis) =>
          t[axis] * vertices[index] +
          t[4 + axis] * vertices[index + 1] +
          t[8 + axis] * vertices[index + 2] +
          t[12 + axis],
      );
      assert.ok(
        distance(transformed, instances[0].center) <=
          instances[0].radius + 1e-5,
      );
    }
  }
  assert.throws(
    () => new orbiting.OrbitingModelScene(definition, asset, []),
    /nonempty/,
  );
  assert.throws(
    () => new orbiting.OrbitingModelScene(definition, asset, ['x', 'x']),
    /unique/,
  );
  assert.throws(
    () =>
      new orbiting.OrbitingModelScene(definition, { ...asset, draws: [] }, [
        'x',
      ]),
    /drawable geometry/,
  );
  assert.throws(
    () => model.update(frame([{ ...instances[0], planet: 'missing' }])),
    /initialized/,
  );
  for (const radius of [0, -1, NaN, Infinity]) {
    assert.throws(
      () => model.update(frame([{ ...instances[0], radius }])),
      /finite and positive/,
    );
  }
});

test('the engine emits both companions before parent culling without adding launchable moons', () => {
  const engine = engineFor([company({ ringWorld: true })]);
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
  assert.deepEqual(captured.moons, []);
  assert.equal(captured.spaceStations.length, 1);
  assert.equal(captured.ringWorlds.length, 1);
  assert.equal(captured.spaceStations[0].planet, 'lucasarts');
});

test('station loading is flag-gated and missing assets fail instead of disappearing', async (t) => {
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('missing', { status: 404 }),
  );
  const enabled = engineFor();
  await assert.rejects(enabled.createRenderer(), /HTTP 404/);
  assert.equal(fetch.mock.calls.length, 1);
  assert.equal(fetch.mock.calls[0].arguments[0], '/models/death-star-ii.glb');
  const disabled = engineFor([company({ spaceStation: false })]);
  disabled.destroyed = true;
  await assert.rejects(disabled.createRenderer(), { name: 'AbortError' });
  assert.equal(fetch.mock.calls.length, 1);
});

test('station and ring assets load once per model and are reused across backend fallback', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(String(url));
    assert.ok(options.signal instanceof AbortSignal);
    const definition = Object.values(orbiting.ORBITING_MODELS).find(
      (entry) => `/${entry.path}` === String(url),
    );
    assert.ok(definition, `Unexpected asset request: ${url}`);
    return new Response(files[definition.feature]);
  });
  const previousNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator',
  );
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { gpu: {} },
  });
  t.after(() => {
    if (previousNavigator)
      Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  });
  const warning = t.mock.method(console, 'warn', () => undefined);
  const gpuInit = t.mock.method(WebGPURenderer.prototype, 'init', async () => {
    throw new Error('GPU unavailable for test');
  });
  const gpuDestroy = t.mock.method(
    WebGPURenderer.prototype,
    'destroy',
    () => undefined,
  );
  const glInit = t.mock.method(
    WebGL2Renderer.prototype,
    'init',
    async () => undefined,
  );
  const engine = engineFor([
    company({ ringWorld: true }),
    company({}, 'another'),
  ]);
  engine.settings.forceBackend = 'webgpu';
  const renderer = await engine.createRenderer();
  assert.equal(renderer.backend, 'webgl2');
  assert.deepEqual(requests.sort(), [
    '/models/broken-ring.glb',
    '/models/death-star-ii.glb',
  ]);
  assert.equal(gpuDestroy.mock.calls.length, 1);
  assert.equal(warning.mock.calls.length, 1);
  const supplied = gpuInit.mock.calls[0].arguments[3];
  assert.equal(glInit.mock.calls[0].arguments[3], supplied);
  assert.deepEqual(supplied.spaceStation.planets, ['lucasarts', 'another']);
  assert.deepEqual(supplied.ringWorld.planets, ['lucasarts']);
  assert.equal(
    supplied.spaceStation.asset.stats.triangles,
    assets.spaceStation.stats.triangles,
  );
  assert.equal(supplied.ringWorld.asset.stats.triangles, 13264);
});

test('aborted station startup makes no asset requests', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    assert.fail('An aborted startup must not fetch assets');
  });
  const engine = engineFor();
  engine.startupAbort.abort();
  await assert.rejects(engine.createRenderer(), { name: 'AbortError' });
  assert.equal(fetch.mock.calls.length, 0);
});

for (const backend of ['webgl2', 'webgpu']) {
  test(`${backend} draws, accounts for, culls, and disposes both orbiting model types`, () => {
    const renderer =
      backend === 'webgpu' ? new WebGPURenderer(4) : new WebGL2Renderer();
    const baselineMemory = renderer.estimateMemoryMB();
    const stateChanges = [];
    const pass = { setBindGroup: (...args) => stateChanges.push(args) };
    renderer.gl = {
      bindSampler: (...args) => stateChanges.push(args),
      activeTexture: () => undefined,
      bindVertexArray: () => undefined,
      disable: () => undefined,
      frontFace: () => undefined,
      deleteTexture: () => undefined,
      getExtension: () => null,
      TEXTURE0: 0,
      CULL_FACE: 0x0b44,
      CCW: 0x0901,
    };
    renderer.hdr = false;
    const renders = [];
    const disposed = [];
    for (const definition of Object.values(orbiting.ORBITING_MODELS)) {
      const model = new orbiting.OrbitingModelScene(
        definition,
        assets[definition.feature],
        ['lucasarts'],
      );
      renderer.orbitingModels.set(definition.feature, {
        scene: model,
        renderer: {
          stats: { geometryBytes: 100, textureBytes: 200 },
          render: (...args) => {
            const modelFrame = args[backend === 'webgpu' ? 1 : 0];
            assert.equal(
              modelFrame.output,
              backend === 'webgpu' ? 'linear' : 'tonemapped',
            );
            if (backend === 'webgpu') {
              assert.equal(args[0], pass);
              assert.equal(args[2], 4);
            }
            renders.push(definition.feature);
            return {
              drawCalls: model.asset.stats.drawCalls,
              triangles: model.asset.stats.triangles,
            };
          },
          dispose: () => disposed.push(definition.feature),
        },
      });
    }
    near(renderer.estimateMemoryMB() - baselineMemory, 600 / 1048576);
    const p = planet({ ringWorld: true });
    const stations = orbiting.buildSpaceStations([p], 4);
    const rings = orbiting.buildRingWorlds([p], 4);
    const draw = (value) => {
      if (backend === 'webgpu') renderer.drawOrbitingModels(pass, value);
      else renderer.drawOrbitingModels(value);
    };
    draw(frame(stations, rings));
    assert.deepEqual(renders, ['ringWorld', 'spaceStation']);
    assert.equal(renderer.getStats().drawCalls, 4);
    assert.equal(
      renderer.getStats().triangles,
      assets.ringWorld.stats.triangles + assets.spaceStation.stats.triangles,
    );
    assert.ok(
      stateChanges.length > 0,
      'Restore host renderer bindings after GLB draws',
    );
    renders.length = 0;
    renderer.stats.drawCalls = 0;
    renderer.stats.triangles = 0;
    draw(frame(stations, rings, false));
    assert.deepEqual(renders, []);
    assert.equal(renderer.getStats().drawCalls, 0);
    draw(frame(stations));
    assert.deepEqual(renders, ['spaceStation']);
    assert.equal(renderer.getStats().drawCalls, 2);
    assert.equal(
      renderer.getStats().triangles,
      assets.spaceStation.stats.triangles,
    );
    renderer.destroy();
    renderer.destroy();
    assert.deepEqual(disposed, ['ringWorld', 'spaceStation']);
    assert.equal(renderer.orbitingModels.size, 0);
  });

  test(`${backend} reports uninitialized station resources explicitly`, () => {
    const renderer =
      backend === 'webgpu' ? new WebGPURenderer() : new WebGL2Renderer();
    const state = frame(orbiting.buildSpaceStations([planet()], 0));
    assert.throws(() => {
      if (backend === 'webgpu') renderer.drawOrbitingModels({}, state);
      else renderer.drawOrbitingModels(state);
    }, /space station GPU resources were not initialized/);
  });
}
