import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const names = ['WebGL2Renderer', 'WebGPURenderer'];
const originalTextureUsage = Object.getOwnPropertyDescriptor(
  globalThis,
  'GPUTextureUsage',
);
let server;
let implementations;
let quality;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  implementations = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => {
        const module = await server.ssrLoadModule(`/src/engine/${name}.ts`);
        return [name, module[name]];
      }),
    ),
  );
  const { QUALITY_PRESETS } = await server.ssrLoadModule(
    '/src/engine/QualityManager.ts',
  );
  quality = QUALITY_PRESETS.low;
  globalThis.GPUTextureUsage = {
    TEXTURE_BINDING: 4,
    RENDER_ATTACHMENT: 16,
  };
});

after(async () => {
  if (originalTextureUsage) {
    Object.defineProperty(
      globalThis,
      'GPUTextureUsage',
      originalTextureUsage,
    );
  } else {
    delete globalThis.GPUTextureUsage;
  }
  await server?.close();
});

function sizingProbe(name) {
  const events = [];
  let width = 800;
  let height = 600;
  const canvas = {
    get width() {
      return width;
    },
    set width(value) {
      width = value;
      events.push(['width', value]);
    },
    get height() {
      return height;
    },
    set height(value) {
      height = value;
      events.push(['height', value]);
    },
  };
  const renderer = new implementations[name]();
  const allocation = new Error('GPU allocation reached');
  const stopAtAllocation = () => {
    events.push(['allocate']);
    throw allocation;
  };
  // Isolate the pre-draw sizing boundary without requiring a GPU in Node.
  renderer.canvas = canvas;
  if (renderer.backend === 'webgl2') {
    renderer.gl = {
      RGBA8: 0x8058,
      RENDERBUFFER: 0x8d41,
      SAMPLES: 0x80a9,
      getInternalformatParameter: stopAtAllocation,
    };
  } else {
    renderer.device = { createTexture: stopAtAllocation };
  }
  const identity = new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
  ]);
  const frame = {
    quality,
    time: 0,
    moonTime: 0,
    view: identity,
    proj: identity,
    viewProj: identity,
    invViewProj: identity,
    frustum: { intersectsSphere: () => false },
    cameraPos: [0, 0, 0],
    keyLightDir: [0, 1, 0],
    sun: { center: [30, 60, 0], radius: 20 },
    planets: [],
    moons: [],
    shadowCasters: [],
    blur: 0,
    wireframe: false,
    poiShimmer: false,
    crtBarrel: 0,
    flightPath: new Float32Array(0),
  };
  const render = () =>
    assert.throws(
      () => renderer.render(frame),
      (error) => error === allocation,
    );
  return { renderer, canvas, events, render };
}

for (const name of names) {
  for (const [width, height] of [
    [1024, 768],
    [1024, 600],
    [800, 768],
  ]) {
    test(`${name} keeps the displayed buffer until rendering ${width}x${height}`, () => {
      const { renderer, canvas, events, render } = sizingProbe(name);
      assert.equal(renderer.resize(width, height, 1), true);
      assert.deepEqual(events, [], 'resize must not clear the visible image');
      assert.deepEqual([canvas.width, canvas.height], [800, 600]);
      render();
      assert.deepEqual([canvas.width, canvas.height], [width, height]);
      assert.deepEqual(events, [
        ...(width !== 800 ? [['width', width]] : []),
        ...(height !== 600 ? [['height', height]] : []),
        ['allocate'],
      ]);
      assert.equal(renderer.resize(width, height, 1), false);
    });
  }

  test(`${name} coalesces size changes before drawing the next frame`, () => {
    const { renderer, canvas, events, render } = sizingProbe(name);
    renderer.resize(1200, 800, 1);
    renderer.resize(640, 480, 1);
    renderer.resize(1024, 720, 1);
    assert.deepEqual(events, []);
    assert.deepEqual([canvas.width, canvas.height], [800, 600]);
    render();
    assert.deepEqual(events, [
      ['width', 1024],
      ['height', 720],
      ['allocate'],
    ]);
  });

  test(`${name} does not reset an already correctly sized drawing buffer`, () => {
    const { renderer, events, render } = sizingProbe(name);
    renderer.resize(800, 600, 1);
    render();
    assert.deepEqual(events, [['allocate']]);
    assert.equal(renderer.resize(800, 600, 1), false);
  });
}
