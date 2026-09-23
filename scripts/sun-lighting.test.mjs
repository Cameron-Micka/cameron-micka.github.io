import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server;
let Engine;
let WebGPURenderer;
let WebGL2Renderer;
let quality;
const shaders = new URL('../src/engine/shaders/', import.meta.url);
const colors = [[1, 1, 1], [1, 0.66, 0.30], [0.36, 0.64, 1]];
const identity = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    appType: 'custom',
    server: { middlewareMode: true, hmr: { port: 24680 }, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  ({ Engine } = await server.ssrLoadModule('/src/engine/Engine.ts'));
  ({ WebGPURenderer } = await server.ssrLoadModule('/src/engine/WebGPURenderer.ts'));
  ({ WebGL2Renderer } = await server.ssrLoadModule('/src/engine/WebGL2Renderer.ts'));
  const { QUALITY_PRESETS } = await server.ssrLoadModule('/src/engine/QualityManager.ts');
  quality = QUALITY_PRESETS.low;
});

after(async () => {
  await server?.close();
});

test('the initial sun is white to preserve the original neutral lighting', () => {
  const engine = new Engine({}, []);
  assert.deepEqual(engine.sun.color, [1, 1, 1]);
});

function frame() {
  return {
    quality, time: 0, cameraPos: [0, 0, 8], keyLightDir: [0, 1, 0],
    viewProj: identity, invViewProj: identity,
    sun: { center: [30, 60, 0], radius: 20, color: colors[0] },
    frustum: { intersectsSphere: (center) => center[0] !== 30 },
    planets: [], moons: [], shadowCasters: [],
  };
}

test('WebGPU uploads the current sun RGB each frame without corrupting shared uniforms', () => {
  const renderer = new WebGPURenderer();
  const state = frame();
  state.shadowCasters = [{ center: [2, 3, 4], radius: 5 }];
  const uploaded = new Error('frame uploaded');
  renderer.canvas = { width: 1, height: 1 };
  renderer.ensureRenderTargets = () => false;
  renderer.ensureAuxTargets = () => {};
  renderer.device = {
    queue: {
      writeBuffer(_buffer, offset, data, start, count) {
        assert.equal(offset, 0);
        assert.equal(start, 0);
        assert.equal(count, 84);
        assert.equal(data.byteLength, 336);
        assert.deepEqual(data.slice(0, 16), identity);
        assert.deepEqual([...data.slice(20, 23)], state.keyLightDir);
        assert.deepEqual([...data.slice(28, 32)], [2, 3, 4, 5]);
        assert.equal(data[60], 1);
        assert.equal(data[61], 2);
        assert.deepEqual(data.slice(64, 67), new Float32Array(state.sun.color));
        assert.equal(data[67], 0);
        assert.deepEqual(data.slice(68, 84), identity);
        throw uploaded;
      },
    },
  };
  for (const color of colors) {
    state.sun.color = color;
    assert.throws(() => renderer.render(state), (error) => error === uploaded);
  }
});

async function webglProbe() {
  const renderer = new WebGL2Renderer();
  const stop = new Error('GPU allocation / overlays reached');
  let active;
  const draws = [];
  const gl = new Proxy({
    createTexture() { throw stop; },
    useProgram(program) { active = program; },
    uniform3fv(location, value) {
      assert.ok(location, 'the uploaded uniform must be registered');
      location.program.values[location.name] = [...value];
    },
    drawElements() {
      draws.push({ program: active, color: active.values.uSunColor });
    },
  }, {
    get: (target, key) => target[key] ?? (/^[A-Z_0-9]+$/.test(key) ? 0 : () => {}),
  });
  renderer.makeProgram = (_vertex, fragment, names) => {
    const prog = { fragment, values: {} };
    const uniforms = Object.fromEntries(names.map((name) => [name, { program: prog, name }]));
    return { prog, uniforms };
  };
  await assert.rejects(renderer.init({
    width: 1, height: 1, getContext: () => gl, addEventListener() {},
  }), (error) => error === stop);
  renderer.ensureSceneTargets = () => {};
  renderer.ensureBackdropTarget = () => {};
  renderer.shouldRenderBackdrop = () => false;
  renderer.backdropTarget = {};
  renderer.sphereLods = Array.from({ length: 5 }, () => ({ count: 3 }));
  renderer.uploadPois = () => { throw stop; };
  return { renderer, draws, stop };
}

test('WebGL2 binds updated sun RGB for planets, moons, rings, clouds and atmospheres', async () => {
  const { renderer, draws, stop } = await webglProbe();
  const state = frame();
  const body = {
    center: [0, 0, 0], radius: 1, orientation: [0, 0, 0, 1],
    visibility: 1, focus: 1, seed: 123, cloudTime: 0,
    paletteLow: [0.1, 0.2, 0.3], paletteMid: [0.3, 0.4, 0.5],
    paletteHigh: [0.5, 0.6, 0.7], satellites: [],
    hasRing: true, ringTilt: 0.3, clouds: true, atmosphere: true,
  };
  state.planets = [body];
  state.moons = [{ ...body, radius: 0.2 }];
  for (const color of colors) {
    state.sun.color = color;
    draws.length = 0;
    assert.throws(() => renderer.render(state), (error) => error === stop);
    for (const [name, count] of [['planet', 2], ['clouds', 1], ['atmosphere', 2], ['ring', 1]]) {
      const programDraws = draws.filter((draw) => draw.program === renderer[name].prog);
      assert.equal(programDraws.length, count, name);
      for (const draw of programDraws) assert.deepEqual(draw.color, color, name);
    }
  }
});

test('all WGSL Frame declarations remain compatible prefixes of their renderer layout', async () => {
  const sceneLayout = [
    'viewProj:mat4x4<f32>', 'cameraPos:vec4<f32>', 'keyLightDir:vec4<f32>',
    'misc:vec4<f32>', 'shadowSpheres:array<vec4<f32>,8>',
    'shadowMisc:vec4<f32>', 'sunColor:vec4<f32>', 'invViewProj:mat4x4<f32>',
  ];
  const gltfLayout = [
    'viewProjection:mat4x4<f32>', 'cameraExposure:vec4<f32>',
    'keyDirection:vec4<f32>', 'keyColor:vec4<f32>',
    'fillDirection:vec4<f32>', 'fillColor:vec4<f32>',
    'ambientSky:vec4<f32>', 'ambientGround:vec4<f32>',
    'outputConfig:vec4<f32>', 'fog:vec4<f32>',
  ];
  for (const name of await readdir(shaders)) {
    const source = await readFile(new URL(name, shaders), 'utf8');
    const frameStruct = source.match(/struct Frame \{([\s\S]*?)\};/);
    if (!frameStruct) continue;
    const fields = frameStruct[1].split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').replace(/\s/g, '').replace(/,$/, '')
        .replace('shadowCasters:', 'shadowSpheres:'))
      .filter(Boolean);
    const expected = name === 'gltf.wgsl' ? gltfLayout : sceneLayout;
    assert.deepEqual(fields, expected.slice(0, fields.length), name);
  }
});

test('both shader backends tint reflected and scattered light, not ambient or emission', async () => {
  const { renderer } = await webglProbe();
  const equations = {
    planet: [
      /sunRadiance=(?:frame\.sunColor\.rgb|uSunColor)\*PI/,
      /glitter\*(?:frame\.sunColor\.rgb|uSunColor)\*shadow\*cloudShadowMul/,
      /(?:obj\.palHigh\.rgb|uHigh)\*(?:frame\.sunColor\.rgb|uSunColor)\*rim\*NdL/,
      /ambient=albedo\*0\.004\*ambientShadowMul/,
      /(?:color=color\+|col\+=)emission\*nightFactor/,
    ],
    ring: [/baseCol\*\(vec3(?:<f32>)?\(0\.035\)\+(?:frame\.sunColor\.rgb|uSunColor)\*shadow\*lighting\)/],
    clouds: [/directSunColor\*(?:frame\.sunColor\.rgb|uSunColor)\*NdL\*selfShadow\+atmosphereFill\*fillStrength/],
    atmosphere: [/col(?:=col\*|\*=)(?:frame\.sunColor\.rgb|uSunColor)\*\(5\.0\*intensity\)/],
  };
  for (const [name, patterns] of Object.entries(equations)) {
    const wgsl = await readFile(new URL(`${name}.wgsl`, shaders), 'utf8');
    for (const source of [wgsl, renderer[name].prog.fragment]) {
      const compact = source.replace(/\/\/[^\n]*/g, '').replace(/\s/g, '');
      for (const pattern of patterns) assert.match(compact, pattern, name);
    }
  }
  const aurora = await readFile(new URL('aurora.wgsl', shaders), 'utf8');
  assert.doesNotMatch(aurora, /frame\.sunColor/);
  assert.doesNotMatch(renderer.aurora.prog.fragment, /uSunColor/);
});
