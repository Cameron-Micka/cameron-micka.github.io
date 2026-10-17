import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createModuleTestServer } from './lib/vite-test-server.mjs';

let server;
let poiPulseScale;
let WebGL2Renderer;
let WebGPURenderer;

before(async () => {
  server = await createModuleTestServer();
  ({ poiPulseScale } = await server.ssrLoadModule('/src/engine/Scene.ts'));
  ({ WebGL2Renderer } = await server.ssrLoadModule(
    '/src/engine/WebGL2Renderer.ts',
  ));
  ({ WebGPURenderer } = await server.ssrLoadModule(
    '/src/engine/WebGPURenderer.ts',
  ));
});

after(async () => {
  await server?.close();
});

test('POIs pulse 40% larger three times per turn with 0.4-second peaks', () => {
  assert.equal(poiPulseScale(0, 1, 3, true), 1);
  for (const time of [0.4, 1.2, 2.0]) {
    assert.equal(poiPulseScale(time, 1, 3, true), 1.4);
  }
  for (const time of [0.8, 1.6, 2.4]) {
    assert.equal(poiPulseScale(time, 1, 3, true), 1);
  }
  assert.equal(poiPulseScale(0.3, 2, 3, true), 1);
  assert.equal(poiPulseScale(2.8, 1, 3, true), 1);
  assert.equal(poiPulseScale(4.4, 2, 3, true), 1.4);
  assert.equal(poiPulseScale(10.8, 1, 3, true), 1.4);
  for (let time = 0; time < 12; time += 0.01) {
    const scales = [1, 2, 3].map((ordinal) =>
      poiPulseScale(time, ordinal, 3, true),
    );
    assert.ok(scales.every((scale) => scale >= 1 && scale <= 1.4));
    assert.ok(scales.filter((scale) => scale > 1).length <= 1);
    assert.equal(poiPulseScale(time, 1, 3, false), 1);
  }
});

test('both renderers scale the marker and its connector together', () => {
  const planet = {
    center: [0, 0, 0],
    radius: 1,
    visibility: 1,
    focus: 1,
    orientation: [0, 0, 0, 1],
    pois: [{ dir: [0, 1, 0], accent: [1, 0.5, 0.1] }],
  };
  for (const enabled of [true, false]) {
    const frame = { time: 0.4, poiPulse: enabled, planets: [planet] };
    const expected = 0.048 * (enabled ? 1.4 : 1);
    const data = [];
    WebGPURenderer.prototype.collectPois(planet, data, 1, 1, frame);
    assert.ok(Math.abs(data[6] - expected) < 1e-8);

    const buffers = new Map();
    let bound;
    const renderer = new WebGL2Renderer();
    renderer.poiPos = 'position';
    renderer.poiAttr = 'attributes';
    renderer.poiColor = 'color';
    renderer.poiLineBuf = 'connector';
    renderer.gl = {
      bindBuffer: (_target, buffer) => {
        bound = buffer;
      },
      bufferData: (_target, values) => {
        buffers.set(bound, values);
      },
    };
    renderer.uploadPois(frame);
    assert.ok(Math.abs(buffers.get('attributes')[0] - expected) < 1e-8);
    for (let vertex = 0; vertex < 6; vertex++) {
      assert.ok(
        Math.abs(buffers.get('connector')[vertex * 13 + 8] - expected) < 1e-8,
      );
    }
  }
});
