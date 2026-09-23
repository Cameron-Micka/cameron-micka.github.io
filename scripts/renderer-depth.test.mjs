import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createModuleTestServer } from './lib/vite-test-server.mjs';

let server;
let WebGL2Renderer;
let OrbitingModelScene;
let ORBITING_MODELS;
let mat4;
let QUALITY_PRESETS;

before(async () => {
  server = await createModuleTestServer();
  [
    { WebGL2Renderer },
    { OrbitingModelScene, ORBITING_MODELS },
    { mat4 },
    { QUALITY_PRESETS },
  ] = await Promise.all([
    server.ssrLoadModule('/src/engine/WebGL2Renderer.ts'),
    server.ssrLoadModule('/src/engine/OrbitingModels.ts'),
    server.ssrLoadModule('/src/engine/math/mat4.ts'),
    server.ssrLoadModule('/src/engine/QualityManager.ts'),
  ]);
});

after(async () => {
  await server?.close();
});

function renderProbe() {
  const projections = new Map();
  const companions = new Map();
  const gl = {};
  for (const method of [
    'disable',
    'enable',
    'bindVertexArray',
    'bindFramebuffer',
    'viewport',
    'clearColor',
    'clear',
    'useProgram',
    'activeTexture',
    'bindTexture',
    'bindSampler',
    'uniform1i',
    'uniform1f',
    'uniform2f',
    'uniform3f',
    'uniform3fv',
    'uniform4fv',
    'drawArrays',
    'drawArraysInstanced',
    'drawElements',
    'blendFunc',
    'blendFuncSeparate',
    'depthMask',
    'cullFace',
    'frontFace',
    'invalidateFramebuffer',
  ]) {
    gl[method] = () => {};
  }
  gl.uniformMatrix4fv = (location, transpose, value) => {
    assert.equal(transpose, false);
    projections.set(location, new Float32Array(value));
  };
  const renderer = new WebGL2Renderer();
  renderer.gl = gl;
  renderer.canvas = { width: 1, height: 1 };
  renderer.msaaFbo = {};
  renderer.requestedSamples = 1;
  renderer.backdropTarget = {
    width: 1,
    height: 1,
    framebuffer: {},
    texture: {},
  };
  renderer.ensureSceneTargets = () => {};
  renderer.ensureBackdropTarget = () => {};
  renderer.shouldRenderBackdrop = () => true;
  renderer.estimateMemoryMB = () => 0;
  renderer.sphereLods = Array.from({ length: 4 }, () => ({
    vao: {},
    wireVao: {},
    count: 3,
    lineCount: 6,
    u32: false,
    lineU32: false,
  }));
  renderer.starCount = 1;
  renderer.ringCount = 3;
  renderer.ringLineCount = 6;
  renderer.uploadSatellites = () => 1;
  renderer.uploadPois = () => {
    renderer.poiCount = 1;
    renderer.poiLineVerts = 6;
  };
  renderer.uploadFlightPath = () => {
    renderer.flightSegments = 1;
    renderer.flightVao = {};
  };
  for (const name of [
    'nebula',
    'backdrop',
    'planet',
    'star',
    'point',
    'line',
    'wire',
    'atmosphere',
    'clouds',
    'aurora',
    'ring',
    'flight',
    'sun',
    'corona',
    'present',
  ]) {
    renderer[name] = {
      prog: {},
      uniforms: new Proxy({}, { get: (_, key) => `${name}.${key}` }),
    };
  }
  const asset = {
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    draws: [{ name: 'companion', primitive: 0, transform: mat4.create() }],
    stats: { triangles: 1, drawCalls: 1, vertices: 3, fileBytes: 0 },
  };
  for (const definition of Object.values(ORBITING_MODELS)) {
    renderer.orbitingModels.set(definition.feature, {
      scene: new OrbitingModelScene(definition, asset, ['planet']),
      renderer: {
        render(frame) {
          companions.set(
            definition.feature,
            new Float32Array(frame.viewProjection),
          );
          return { drawCalls: 1, triangles: 1 };
        },
      },
    });
  }
  return { renderer, projections, companions };
}

function frame(cameraPos = [0, 0, 10], wireframe = false) {
  const view = mat4.lookAt(mat4.create(), cameraPos, [0, 0, 0], [0, 1, 0]);
  const proj = mat4.perspective(mat4.create(), Math.PI / 3, 16 / 9, 0.1, 200);
  const viewProj = mat4.multiply(mat4.create(), proj, view);
  const companion = {
    planet: 'planet',
    center: [0, 0, -2],
    radius: 0.5,
    orientation: [0, 0, 0, 1],
  };
  const body = {
    center: [0, 0, 0],
    radius: 1,
    orientation: [0, 0, 0, 1],
    visibility: 1,
    focus: 1,
    seed: 1,
    paletteLow: [0.1, 0.2, 0.3],
    paletteMid: [0.2, 0.3, 0.4],
    paletteHigh: [0.3, 0.4, 0.5],
    atmosphere: true,
  };
  return {
    time: 0,
    moonTime: 0,
    view,
    proj,
    viewProj,
    invViewProj: mat4.invert(mat4.create(), viewProj),
    cameraPos,
    frustum: { intersectsSphere: () => true },
    keyLightDir: [0, 1, 0],
    sun: { center: [0, 3, -30], radius: 2 },
    planets: [
      {
        ...body,
        slug: 'planet',
        clouds: true,
        aurora: true,
        hasRing: true,
        ringTilt: 0.4,
        cloudTime: 0,
      },
    ],
    moons: [{ ...body, center: [2, 0, 0], radius: 0.2 }],
    ringWorlds: [companion],
    spaceStations: [companion],
    shadowCasters: [],
    quality: QUALITY_PRESETS.low,
    wireframe,
    blur: 0,
    poiShimmer: false,
    crtBarrel: 0,
    flightPath: new Float32Array(0),
  };
}

function project(matrix, point) {
  return [0, 1, 2, 3].map(
    (row) =>
      matrix[row] * point[0] +
      matrix[4 + row] * point[1] +
      matrix[8 + row] * point[2] +
      matrix[12 + row],
  );
}

function glDepth(matrix, point) {
  const clip = project(matrix, point);
  return (0.5 * clip[2]) / clip[3] + 0.5;
}

function gltfDepth(matrix, point) {
  const clip = project(matrix, point);
  return clip[2] / clip[3];
}

function near(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 2e-6,
    `${message}: ${actual} != ${expected}`,
  );
}

for (const wireframe of [false, true]) {
  test(`all WebGL scene draws share glTF depth (${wireframe ? 'wireframe' : 'solid'})`, () => {
    const { renderer, projections, companions } = renderProbe();
    const state = frame([4, 2, 10], wireframe);
    const original = new Float32Array(state.viewProj);
    renderer.render(state);
    const programs = wireframe
      ? ['star', 'wire', 'line', 'point', 'flight']
      : [
          'star',
          'planet',
          'corona',
          'sun',
          'clouds',
          'atmosphere',
          'aurora',
          'ring',
          'line',
          'point',
          'flight',
        ];
    for (const name of programs) {
      const projection = projections.get(`${name}.uViewProj`);
      assert.ok(projection, `${name} must upload its projection`);
      for (const point of [
        [0, 0, 0],
        [2, -1, -3],
        [-4, 2, 1],
      ]) {
        const actual = project(projection, point);
        const expected = project(state.viewProj, point);
        for (const row of [0, 1, 3])
          near(actual[row], expected[row], `${name} row ${row}`);
        near(
          glDepth(projection, point),
          gltfDepth(state.viewProj, point),
          `${name} depth`,
        );
      }
    }
    assert.deepEqual(
      state.viewProj,
      original,
      'the shared camera projection must not change',
    );
    assert.deepEqual(projections.get('nebula.uInvViewProj'), state.invViewProj);
    assert.deepEqual([...companions.keys()], ['ringWorld', 'spaceStation']);
    for (const projection of companions.values()) {
      assert.deepEqual(
        projection,
        original,
        'glTF must retain its own clip-space conversion',
      );
    }
  });
}

test('WebGL uses the same near and far clipping planes as WebGPU and glTF', () => {
  const { renderer, projections } = renderProbe();
  renderer.render(frame());
  const projection = projections.get('planet.uViewProj');
  near(glDepth(projection, [0, 0, 9.9]), 0, 'near plane');
  near(glDepth(projection, [0, 0, -190]), 1, 'far plane');
  assert.ok(
    glDepth(projection, [0, 0, 9.95]) < 0,
    'clip objects ahead of the near plane',
  );
  assert.ok(
    glDepth(projection, [0, 0, -200]) > 1,
    'clip objects beyond the far plane',
  );
});

for (const feature of ['ringWorld', 'spaceStation']) {
  test(`${feature} is hidden behind a planet and visible in front in either draw order`, () => {
    const { renderer, projections, companions } = renderProbe();
    renderer.render(frame());
    const planetDepth = glDepth(projections.get('planet.uViewProj'), [0, 0, 1]);
    for (const [z, visible] of [
      [-2, false],
      [3, true],
    ]) {
      const companionDepth = gltfDepth(companions.get(feature), [0, 0, z]);
      assert.equal(
        companionDepth <= planetDepth,
        visible,
        'planet drawn first',
      );
      assert.equal(
        planetDepth <= companionDepth,
        !visible,
        'companion drawn first',
      );
    }
  });
}
