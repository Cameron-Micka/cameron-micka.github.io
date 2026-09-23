import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createModuleTestServer } from './lib/vite-test-server.mjs';

let server;
let shared;
let gpu;
let WebGL2GltfRenderer;
let WebGPUGltfRenderer;

before(async () => {
  server = await createModuleTestServer();
  [shared, gpu, { WebGL2GltfRenderer }, { WebGPUGltfRenderer }] =
    await Promise.all([
      server.ssrLoadModule('/src/engine/gltf/rendererShared.ts'),
      server.ssrLoadModule('/src/engine/gltf/webgpuUtils.ts'),
      server.ssrLoadModule('/src/engine/gltf/WebGL2GltfRenderer.ts'),
      server.ssrLoadModule('/src/engine/gltf/WebGPUGltfRenderer.ts'),
    ]);
});

after(async () => {
  await server?.close();
});

function matrix(x = 0, y = 0, z = 0) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

function material(overrides = {}) {
  return {
    name: 'material',
    baseColor: [1, 1, 1, 1],
    metallic: 1,
    roughness: 1,
    emissive: [0, 0, 0],
    normalScale: 1,
    occlusionStrength: 1,
    alphaMode: 'OPAQUE',
    alphaCutoff: 0.5,
    doubleSided: false,
    ...overrides,
  };
}

function sampler(overrides = {}) {
  return {
    magFilter: 9729,
    minFilter: 9987,
    wrapS: 10497,
    wrapT: 10497,
    ...overrides,
  };
}

function primitive(materialIndex = 0) {
  return {
    name: 'triangle',
    vertices: new Float32Array(18 * 3),
    indices: new Uint16Array([0, 1, 2]),
    material: materialIndex,
    bounds: { min: [-1, -1, 0], max: [1, 1, 0] },
  };
}

function image(name = 'image') {
  return { name, mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) };
}

function asset(overrides = {}) {
  return {
    primitives: [primitive()],
    materials: [material()],
    images: [],
    textures: [],
    samplers: [],
    draws: [{ name: 'draw', primitive: 0, transform: matrix() }],
    bounds: { min: [-1, -1, 0], max: [1, 1, 0] },
    extras: {},
    warnings: [],
    stats: { triangles: 1, vertices: 3, drawCalls: 1, fileBytes: 0 },
    ...overrides,
  };
}

function frame(overrides = {}) {
  return {
    viewProjection: matrix(),
    view: matrix(),
    cameraPosition: [0, 0, 4],
    keyLight: { direction: [0, 3, 4], color: [2, 3, 4] },
    fillLight: { direction: [1, 0, 0], color: [0.5, 0.6, 0.7] },
    ambientSky: [0.2, 0.3, 0.4],
    ambientGround: [0.1, 0.05, 0],
    ...overrides,
  };
}

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} differs from ${expected}`,
  );
}

function replaceGlobal(t, key, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { value, configurable: true });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, key, previous);
    else delete globalThis[key];
  });
}

test('CPU layouts match vec4-aligned GLSL/WGSL blocks', () => {
  assert.equal(shared.FRAME_BYTES, 208);
  assert.equal(shared.OBJECT_BYTES, 144);
  assert.equal(shared.MATERIAL_BYTES, 96);
  assert.equal(shared.alignTo(shared.OBJECT_BYTES, 256), 256);
  assert.equal(shared.alignTo(shared.OBJECT_BYTES, 512), 512);
});

test('material factors, normal scale, alpha and all five UV selectors are packed', () => {
  const uniforms = shared.materialUniforms(
    material({
      baseColor: [0.1, 0.2, 0.3, 0.4],
      emissive: [2, 3, 4],
      metallic: 0.7,
      roughness: 0.35,
      normalScale: 0.8,
      occlusionStrength: 0.6,
      alphaMode: 'MASK',
      alphaCutoff: 0.25,
      doubleSided: true,
      baseColorTexture: { texture: 0, texCoord: 1 },
      metallicRoughnessTexture: { texture: 0, texCoord: 0 },
      normalTexture: { texture: 0, texCoord: 1 },
      occlusionTexture: { texture: 0, texCoord: 0 },
      emissiveTexture: { texture: 0, texCoord: 1 },
    }),
  );
  [0.1, 0.2, 0.3, 0.4, 2, 3, 4, 0.7, 0.35, 0.8, 0.6, 0.25].forEach(
    (value, index) => near(uniforms[index], value),
  );
  assert.deepEqual([...uniforms.slice(12, 15)], [1, 1, 1]);
  assert.deepEqual([...uniforms.slice(16, 21)], [1, 0, 1, 0, 1]);
  assert.equal(
    shared.materialUniforms(material({ alphaMode: 'BLEND' }))[12],
    2,
  );
  assert.equal(shared.materialUniforms(material())[12], 0);
});

test('texture storage deduplicates images, separates sRGB/data, and unions mip needs', () => {
  const source = asset({
    images: [image()],
    samplers: [sampler({ minFilter: 9729 }), sampler(), sampler()],
    textures: [
      { source: 0, sampler: 0 },
      { source: 0, sampler: 1 },
      { source: 0, sampler: 2 },
    ],
    materials: [
      material({
        baseColorTexture: { texture: 0, texCoord: 0 },
        metallicRoughnessTexture: { texture: 1, texCoord: 1 },
        normalTexture: { texture: 2, texCoord: 0 },
        occlusionTexture: { texture: 2, texCoord: 1 },
        emissiveTexture: { texture: 1, texCoord: 0 },
      }),
    ],
  });
  const plan = shared.createRenderPlan(source);
  assert.equal(plan.textures.length, 2);
  assert.equal(plan.samplers.length, 2);
  const [base, mr, normal, occlusion, emissive] = plan.materials[0].bindings;
  assert.equal(base.textureKey, emissive.textureKey);
  assert.notEqual(base.samplerKey, emissive.samplerKey);
  assert.equal(mr.textureKey, normal.textureKey);
  assert.equal(normal.textureKey, occlusion.textureKey);
  assert.notEqual(base.textureKey, mr.textureKey);
  assert.ok(plan.textures.every((texture) => texture.mipmapped));
});

test('absent slots alone use one white fallback and disable normal mapping', () => {
  const plan = shared.createRenderPlan(asset());
  assert.deepEqual(plan.textures, [
    { key: 'default:white', srgb: false, mipmapped: false },
  ]);
  assert.equal(plan.samplers.length, 1);
  assert.equal(plan.materials[0].uniforms[13], 0);
  assert.equal(plan.materials[0].bindings.length, 5);
  assert.ok(
    plan.materials[0].bindings.every(
      (binding) => binding.textureKey === 'default:white',
    ),
  );
});

test('bad texture/image/sampler and primitive references never use a fallback', () => {
  const source = asset({
    materials: [material({ baseColorTexture: { texture: 0, texCoord: 0 } })],
  });
  assert.throws(
    () => shared.createRenderPlan(source),
    /baseColorTexture.*missing/,
  );
  source.textures = [{ source: 0, sampler: 0 }];
  assert.throws(() => shared.createRenderPlan(source), /image.*missing/);
  source.images = [image()];
  assert.throws(() => shared.createRenderPlan(source), /sampler.*missing/);
  source.samplers = [sampler()];
  source.draws[0].primitive = 4;
  assert.throws(() => shared.createRenderPlan(source), /primitive.*missing/);
  source.draws[0].primitive = 0;
  source.primitives[0].material = 7;
  assert.throws(() => shared.createRenderPlan(source), /material.*missing/);
});

test('unsupported UVs and out-of-bounds geometry are rejected explicitly', () => {
  assert.throws(
    () =>
      shared.materialUniforms(
        material({ normalTexture: { texture: 0, texCoord: 2 } }),
      ),
    /requires UV0 or UV1/,
  );
  const source = asset();
  source.primitives[0].indices[2] = 3;
  assert.throws(
    () => shared.createRenderPlan(source),
    /vertex index out of bounds/,
  );
});

test('all six minification filters preserve filtering and mip selection semantics', () => {
  for (const [minFilter, filter, mipmapFilter, mipmapped] of [
    [9728, 'nearest', 'nearest', false],
    [9729, 'linear', 'nearest', false],
    [9984, 'nearest', 'nearest', true],
    [9985, 'linear', 'nearest', true],
    [9986, 'nearest', 'linear', true],
    [9987, 'linear', 'linear', true],
  ]) {
    const descriptor = shared.gpuSamplerDescriptor(
      sampler({ minFilter, magFilter: 9728 }),
    );
    assert.equal(descriptor.minFilter, filter);
    assert.equal(descriptor.mipmapFilter, mipmapFilter);
    assert.equal(descriptor.magFilter, 'nearest');
    assert.equal(descriptor.lodMinClamp, 0);
    assert.equal(descriptor.lodMaxClamp, mipmapped ? 32 : 0);
    assert.equal(shared.usesMipmaps(sampler({ minFilter })), mipmapped);
  }
});

test('all core wrapping modes map exactly, and unsupported enums throw', () => {
  for (const [wrap, mode] of [
    [33071, 'clamp-to-edge'],
    [33648, 'mirror-repeat'],
    [10497, 'repeat'],
  ]) {
    const descriptor = shared.gpuSamplerDescriptor(
      sampler({ wrapS: wrap, wrapT: wrap }),
    );
    assert.equal(descriptor.addressModeU, mode);
    assert.equal(descriptor.addressModeV, mode);
  }
  assert.throws(
    () => shared.gpuSamplerDescriptor(sampler({ wrapS: 0 })),
    /unsupported sampler wrap/,
  );
  assert.throws(
    () => shared.gpuSamplerDescriptor(sampler({ minFilter: 0 })),
    /unsupported minFilter/,
  );
  assert.throws(
    () => shared.gpuSamplerDescriptor(sampler({ magFilter: 9987 })),
    /unsupported magFilter/,
  );
});

test('NPOT mip dimensions and byte budgets include every level exactly once', () => {
  assert.equal(shared.mipLevelCount(5, 3, true), 3);
  assert.equal(shared.textureByteLength(5, 3, 3), 72);
  assert.equal(shared.mipLevelCount(1, 8, true), 4);
  assert.equal(shared.textureByteLength(1, 8, 4), 60);
  assert.equal(shared.mipLevelCount(5, 3, false), 1);
  assert.equal(shared.textureByteLength(5, 3, 1), 60);
  assert.equal(shared.mipLevelCount(1, 1, true), 1);
  assert.throws(() => shared.mipLevelCount(0, 1, true), /positive integers/);
});

test('opaque/masked draws precede back-to-front blends sorted by view Z, not radius', () => {
  const source = asset({
    materials: [
      material({ alphaMode: 'BLEND' }),
      material(),
      material({ alphaMode: 'MASK' }),
    ],
    primitives: [primitive(0), primitive(1), primitive(2)],
    draws: [
      {
        name: 'near but far off axis',
        primitive: 0,
        transform: matrix(100, 0, -1),
      },
      { name: 'opaque', primitive: 1, transform: matrix(0, 0, -100) },
      { name: 'far blend', primitive: 0, transform: matrix(0, 0, -20) },
      { name: 'masked', primitive: 2, transform: matrix(0, 0, -1) },
      { name: 'same depth blend', primitive: 0, transform: matrix(1, 0, -20) },
    ],
  });
  const plan = shared.createRenderPlan(source);
  shared.updateDrawTransforms(plan.draws, frame());
  assert.deepEqual(
    plan.draws.map((draw) => draw.index),
    [1, 3, 2, 4, 0],
  );
  shared.updateDrawTransforms(plan.draws, frame());
  assert.deepEqual(
    plan.draws.map((draw) => draw.index),
    [1, 3, 2, 4, 0],
  );
  const rotatedView = matrix();
  rotatedView[0] = 0;
  rotatedView[2] = -1;
  rotatedView[8] = 1;
  rotatedView[10] = 0;
  shared.updateDrawTransforms(plan.draws, frame({ view: rotatedView }));
  assert.deepEqual(
    plan.draws.map((draw) => draw.index),
    [1, 3, 0, 4, 2],
  );
});

test('nonuniform mirrored transforms use inverse-transpose normals and combined winding', () => {
  const transform = matrix(2, 3, 4);
  transform[0] = -2;
  transform[5] = 3;
  transform[10] = 4;
  const plan = shared.createRenderPlan(
    asset({ draws: [{ name: 'scaled', primitive: 0, transform }] }),
  );
  shared.updateDrawTransforms(plan.draws, frame());
  const draw = plan.draws[0];
  assert.equal(draw.handedness, -1);
  near(draw.normal[0], -0.5);
  near(draw.normal[5], 1 / 3);
  near(draw.normal[10], 0.25);
  const buffer = new Float32Array(16 + shared.OBJECT_FLOATS).fill(9);
  shared.writeObjectUniforms(buffer, 16, draw);
  assert.deepEqual([...buffer.slice(0, 16)], new Array(16).fill(9));
  assert.deepEqual([...buffer.slice(16, 32)], [...draw.model]);
  assert.deepEqual([...buffer.slice(32, 48)], [...draw.normal]);
  assert.deepEqual([...buffer.slice(48, 52)], [-1, 0, 0, 0]);
  const parent = matrix();
  parent[0] = -1;
  shared.updateDrawTransforms(plan.draws, frame({ model: parent }));
  assert.equal(draw.handedness, 1);
  assert.equal(draw.model[12], -2);
  near(draw.normal[0], 0.5);
});

test('singular and non-affine draw matrices cannot inject NaNs into lighting', () => {
  const transform = matrix();
  transform[0] = 0;
  const plan = shared.createRenderPlan(
    asset({ draws: [{ name: 'singular', primitive: 0, transform }] }),
  );
  assert.throws(
    () => shared.updateDrawTransforms(plan.draws, frame()),
    /singular.*model matrix/,
  );
  transform[3] = 1;
  assert.throws(
    () =>
      shared.createRenderPlan(
        asset({ draws: [{ name: 'projective', primitive: 0, transform }] }),
      ),
    /affine transform/,
  );
});

test('draw transforms and visibility can change without rebuilding shared geometry', () => {
  const source = asset({
    draws: [
      { name: 'first planet', primitive: 0, transform: matrix() },
      {
        name: 'second planet',
        primitive: 0,
        transform: matrix(8, 0, 0),
        visible: false,
      },
    ],
  });
  const plan = shared.createRenderPlan(source);
  shared.updateDrawTransforms(plan.draws, frame());
  assert.equal(plan.draws[1].visible, false);
  source.draws[0].transform[12] = 3;
  source.draws[1].transform = matrix(-4, 1, 0);
  source.draws[1].visible = true;
  shared.updateDrawTransforms(plan.draws, frame());
  assert.equal(plan.draws[0].model[12], 3);
  assert.equal(plan.draws[1].model[12], -4);
  assert.equal(plan.draws[1].visible, true);
  source.draws[0].visible = false;
  source.draws[0].transform.fill(0);
  assert.doesNotThrow(() => shared.updateDrawTransforms(plan.draws, frame()));
  assert.equal(plan.draws[0].visible, false);
});

test('LDR hosts can request tonemapped linear output and optional distance fog', () => {
  const out = new Float32Array(shared.FRAME_FLOATS);
  shared.writeFrameUniforms(
    out,
    frame({
      output: 'tonemapped',
      fog: { color: [0.04, 0.06, 0.14], density: 0.018 },
    }),
    false,
  );
  assert.deepEqual([...out.slice(44, 48)], [1, 1, 0, 0]);
  [0.04, 0.06, 0.14, 0.018].forEach((value, i) => near(out[48 + i], value));
  shared.writeFrameUniforms(out, frame(), false);
  assert.deepEqual([...out.slice(48)], [0, 0, 0, 0]);
  assert.throws(
    () =>
      shared.writeFrameUniforms(
        out,
        frame({
          fog: { color: [0, 0, 0], density: -1 },
        }),
        false,
      ),
    /fog density/,
  );
});

test('frame uniforms default to raw linear and normalize world-space light directions', () => {
  const out = new Float32Array(shared.FRAME_FLOATS).fill(-1);
  shared.writeFrameUniforms(out, frame({ exposure: 4 }), false);
  assert.deepEqual([...out.slice(16, 20)], [0, 0, 4, 4]);
  near(out[21], 0.6);
  near(out[22], 0.8);
  assert.deepEqual([...out.slice(24, 28)], [2, 3, 4, 0]);
  assert.deepEqual([...out.slice(44, 48)], [0, 0, 0, 0]);
  shared.writeFrameUniforms(
    out,
    frame({ output: 'srgb', wireframe: true }),
    false,
  );
  assert.deepEqual([...out.slice(44, 48)], [1, 0, 1, 0]);
  shared.writeFrameUniforms(out, frame({ output: 'srgb' }), true);
  assert.deepEqual([...out.slice(44, 48)], [1, 1, 0, 0]);
  assert.throws(
    () => shared.writeFrameUniforms(out, frame({ output: 'linear' }), true),
    /linear render target/,
  );
  assert.throws(
    () => shared.writeFrameUniforms(out, frame({ exposure: -1 }), false),
    /nonnegative/,
  );
});

test('images decode once across color spaces without orientation, premultiplication or conversion', async (t) => {
  const calls = [];
  let closes = 0;
  replaceGlobal(t, 'createImageBitmap', async (blob, options) => {
    calls.push({ blob, options });
    return { width: 4, height: 8, close: () => closes++ };
  });
  const decoded = await shared.decodeImages(
    [image()],
    [
      { key: '0/srgb', source: 0, srgb: true, mipmapped: true },
      { key: '0/linear', source: 0, srgb: false, mipmapped: true },
      { key: 'default:white', srgb: false, mipmapped: false },
    ],
    4096,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].blob.type, 'image/png');
  assert.deepEqual(calls[0].options, {
    imageOrientation: 'none',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  assert.equal(closes, 0);
  shared.closeImages(decoded);
  assert.equal(closes, 1);
});

test('decode and size failures close all previously created bitmaps and retain context', async (t) => {
  let closes = 0;
  let attempts = 0;
  replaceGlobal(t, 'createImageBitmap', async () => {
    if (attempts++ === 1) throw new Error('corrupt PNG');
    return { width: 4, height: 4, close: () => closes++ };
  });
  await assert.rejects(
    shared.decodeImages(
      [image('first'), image('broken')],
      [
        { key: '0', source: 0, srgb: false, mipmapped: false },
        { key: '1', source: 1, srgb: false, mipmapped: false },
      ],
      4096,
    ),
    /image "broken" \(1\): corrupt PNG/,
  );
  assert.equal(closes, 1);
  await assert.rejects(
    shared.decodeImages(
      [image('too large')],
      [{ key: '0', source: 0, srgb: false, mipmapped: false }],
      2,
    ),
    /dimensions 4x4 exceed the GPU limit 2/,
  );
  assert.equal(closes, 2);
});

function scopedDevice(errors = []) {
  const events = [];
  return {
    events,
    pushErrorScope: (scope) => events.push(`push:${scope}`),
    popErrorScope: () => {
      events.push('pop');
      return Promise.resolve(errors.shift() ?? null);
    },
  };
}

test('GPU scopes are balanced before an asynchronous pipeline resolves', async () => {
  const device = scopedDevice();
  let finish;
  const promise = new Promise((resolve) => {
    finish = resolve;
  });
  const checked = gpu.checkedGpu(device, 'pipeline', () => {
    device.events.push('operation');
    return promise;
  });
  assert.deepEqual(device.events, [
    'push:internal',
    'push:out-of-memory',
    'push:validation',
    'operation',
    'pop',
    'pop',
    'pop',
  ]);
  finish('pipeline');
  assert.equal(await checked, 'pipeline');
});

test('validation, OOM, synchronous uploads and asynchronous pipeline errors explicitly reject', async () => {
  await assert.rejects(
    gpu.checkedGpu(
      scopedDevice([{ message: 'bad texture' }, { message: 'out of memory' }]),
      'upload',
      () => 0,
    ),
    /upload: bad texture\nout of memory/,
  );
  const device = scopedDevice();
  await assert.rejects(
    gpu.checkedGpu(device, 'upload', () => {
      throw new Error('copy failed');
    }),
    /upload: copy failed/,
  );
  assert.equal(device.events.filter((event) => event === 'pop').length, 3);
  await assert.rejects(
    gpu.checkedGpu(scopedDevice(), 'pipeline', () =>
      Promise.reject(new Error('invalid target')),
    ),
    /pipeline: invalid target/,
  );
});

test('WGSL compilation diagnostics include the owned shader name, line and column', async () => {
  const device = {
    ...scopedDevice(),
    createShaderModule: () => ({
      getCompilationInfo: async () => ({
        messages: [
          {
            type: 'error',
            lineNum: 12,
            linePos: 5,
            message: 'invalid expression',
          },
        ],
      }),
    }),
  };
  await assert.rejects(
    gpu.checkedShaderModule(device, 'broken code', 'gltf.wgsl'),
    /gltf.wgsl compilation failed:\n12:5: invalid expression/,
  );
});

test('failed GPU image upload destroys partial buffers/textures and closes images, not the device', async (t) => {
  replaceGlobal(t, 'GPUBufferUsage', {
    VERTEX: 32,
    INDEX: 16,
    UNIFORM: 64,
    COPY_DST: 8,
  });
  replaceGlobal(t, 'GPUTextureUsage', {
    TEXTURE_BINDING: 4,
    COPY_DST: 2,
    RENDER_ATTACHMENT: 16,
  });
  let closes = 0;
  replaceGlobal(t, 'createImageBitmap', async () => ({
    width: 4,
    height: 4,
    close: () => closes++,
  }));
  const buffers = [];
  const textures = [];
  let deviceDestroyed = false;
  const device = {
    ...scopedDevice(),
    limits: {
      minUniformBufferOffsetAlignment: 256,
      maxTextureDimension2D: 4096,
    },
    createShaderModule: () => ({
      getCompilationInfo: async () => ({ messages: [] }),
    }),
    createBuffer: ({ size }) => {
      const buffer = {
        size,
        destroyed: false,
        getMappedRange: () => new ArrayBuffer(size),
        unmap() {},
        destroy() {
          this.destroyed = true;
        },
      };
      buffers.push(buffer);
      return buffer;
    },
    createTexture: () => {
      const texture = {
        destroyed: false,
        createView: () => ({}),
        destroy() {
          this.destroyed = true;
        },
      };
      textures.push(texture);
      return texture;
    },
    queue: {
      copyExternalImageToTexture() {
        throw new Error('image copy failed');
      },
    },
    destroy() {
      deviceDestroyed = true;
    },
  };
  const source = asset({
    materials: [material({ baseColorTexture: { texture: 0, texCoord: 0 } })],
    images: [image()],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [sampler()],
  });
  await assert.rejects(
    WebGPUGltfRenderer.create(device, source, { colorFormat: 'rgba8unorm' }),
    /texture\/sampler upload: image copy failed/,
  );
  assert.equal(buffers.length, 3);
  assert.ok(buffers.every((buffer) => buffer.destroyed));
  assert.equal(textures.length, 1);
  assert.ok(textures.every((texture) => texture.destroyed));
  assert.equal(closes, 1);
  assert.equal(deviceDestroyed, false);
});

function shaderGl() {
  const deletedShaders = [];
  const deletedPrograms = [];
  let currentProgram = null;
  const gl = {
    NO_ERROR: 0,
    MAX_TEXTURE_SIZE: 1,
    CURRENT_PROGRAM: 2,
    VERTEX_SHADER: 3,
    FRAGMENT_SHADER: 4,
    COMPILE_STATUS: 5,
    LINK_STATUS: 6,
    UNIFORM_BLOCK_DATA_SIZE: 7,
    INVALID_INDEX: 0xffffffff,
    getError: () => 0,
    isContextLost: () => false,
    getParameter: (parameter) =>
      parameter === gl.MAX_TEXTURE_SIZE ? 4096 : currentProgram,
    createShader: (type) => ({ type }),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => 'syntax failure',
    deleteShader: (shader) => deletedShaders.push(shader),
    createProgram: () => ({}),
    attachShader() {},
    linkProgram() {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => 'link failure',
    deleteProgram: (program) => deletedPrograms.push(program),
    useProgram: (program) => {
      currentProgram = program;
    },
    getUniformBlockIndex: (_program, name) =>
      [
        'GltfFrameUniforms',
        'GltfObjectUniforms',
        'GltfMaterialUniforms',
      ].indexOf(name),
    getActiveUniformBlockParameter: (_program, index) => [208, 144, 96][index],
    uniformBlockBinding() {},
    getUniformLocation: (_program, name) => ({ name }),
    uniform1i() {},
  };
  return { gl, deletedShaders, deletedPrograms };
}

test('GLSL compile/link failures include diagnostics and delete partial shader/program objects', async () => {
  const compile = shaderGl();
  compile.gl.getShaderParameter = (shader) =>
    shader.type !== compile.gl.FRAGMENT_SHADER;
  await assert.rejects(
    WebGL2GltfRenderer.create(compile.gl, asset()),
    /gltf.frag.glsl compilation failed:\nsyntax failure/,
  );
  assert.equal(compile.deletedShaders.length, 2);
  const link = shaderGl();
  link.gl.getProgramParameter = () => false;
  await assert.rejects(
    WebGL2GltfRenderer.create(link.gl, asset()),
    /PBR program link failed:\nlink failure/,
  );
  assert.equal(link.deletedShaders.length, 2);
  assert.equal(link.deletedPrograms.length, 1);
});

test('GL buffer allocation/upload errors delete every previously owned allocation', async () => {
  const { gl, deletedPrograms } = shaderGl();
  const allocated = [];
  const deleted = [];
  let error = 0;
  let uploads = 0;
  Object.assign(gl, {
    createBuffer: () => {
      const buffer = {};
      allocated.push(buffer);
      return buffer;
    },
    bindBuffer() {},
    bufferData() {
      if (++uploads === 2) error = 0x0505;
    },
    getError() {
      const result = error;
      error = 0;
      return result;
    },
    deleteBuffer: (buffer) => deleted.push(buffer),
  });
  await assert.rejects(
    WebGL2GltfRenderer.create(gl, asset()),
    /object uniforms upload: 0x505/,
  );
  assert.equal(allocated.length, 2);
  assert.deepEqual(deleted, allocated);
  assert.equal(deletedPrograms.length, 1);
});

function renderingGl() {
  const { gl } = shaderGl();
  const constants = [
    'UNIFORM_BUFFER',
    'DYNAMIC_DRAW',
    'STATIC_DRAW',
    'ARRAY_BUFFER',
    'ELEMENT_ARRAY_BUFFER',
    'FLOAT',
    'UNSIGNED_INT',
    'UNSIGNED_SHORT',
    'TEXTURE0',
    'PIXEL_UNPACK_BUFFER',
    'UNPACK_ALIGNMENT',
    'UNPACK_FLIP_Y_WEBGL',
    'UNPACK_PREMULTIPLY_ALPHA_WEBGL',
    'UNPACK_COLORSPACE_CONVERSION_WEBGL',
    'NONE',
    'UNPACK_ROW_LENGTH',
    'UNPACK_IMAGE_HEIGHT',
    'UNPACK_SKIP_PIXELS',
    'UNPACK_SKIP_ROWS',
    'UNPACK_SKIP_IMAGES',
    'TEXTURE_2D',
    'SRGB8_ALPHA8',
    'RGBA8',
    'RGBA',
    'UNSIGNED_BYTE',
    'TEXTURE_MAG_FILTER',
    'TEXTURE_MIN_FILTER',
    'TEXTURE_WRAP_S',
    'TEXTURE_WRAP_T',
    'DRAW_BUFFER0',
    'COLOR_ATTACHMENT0',
    'DRAW_FRAMEBUFFER',
    'FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING',
    'SRGB',
    'LINEAR',
    'DEPTH_TEST',
    'LEQUAL',
    'STENCIL_TEST',
    'POLYGON_OFFSET_FILL',
    'RASTERIZER_DISCARD',
    'SAMPLE_COVERAGE',
    'SAMPLE_ALPHA_TO_COVERAGE',
    'BACK',
    'FUNC_ADD',
    'SRC_ALPHA',
    'ONE_MINUS_SRC_ALPHA',
    'ONE',
    'CULL_FACE',
    'CW',
    'CCW',
    'BLEND',
    'LINES',
    'TRIANGLES',
  ];
  constants.forEach((name, index) => {
    gl[name] = 100 + index;
  });
  for (const name of [
    'bindBuffer',
    'bufferData',
    'bindVertexArray',
    'enableVertexAttribArray',
    'vertexAttribPointer',
    'activeTexture',
    'pixelStorei',
    'bindTexture',
    'texStorage2D',
    'texSubImage2D',
    'generateMipmap',
    'samplerParameteri',
    'bufferSubData',
    'bindBufferBase',
    'depthFunc',
    'depthRange',
    'colorMask',
    'cullFace',
    'blendEquationSeparate',
    'blendFuncSeparate',
    'lineWidth',
    'bindSampler',
    'deleteVertexArray',
    'deleteBuffer',
    'deleteTexture',
    'deleteSampler',
  ])
    gl[name] = () => {};
  let textures = 0;
  gl.createBuffer = () => ({});
  gl.createVertexArray = () => ({});
  gl.createSampler = () => ({});
  gl.createTexture = () => {
    textures++;
    return {};
  };
  const getParameter = gl.getParameter;
  gl.getParameter = (parameter) =>
    parameter === gl.DRAW_BUFFER0
      ? gl.COLOR_ATTACHMENT0
      : getParameter(parameter);
  gl.getFramebufferAttachmentParameter = () => gl.LINEAR;
  const enabled = new Set();
  let depthWrite = true;
  let winding = gl.CCW;
  const draws = [];
  gl.enable = (state) => enabled.add(state);
  gl.disable = (state) => enabled.delete(state);
  gl.depthMask = (value) => {
    depthWrite = value;
  };
  gl.frontFace = (value) => {
    winding = value;
  };
  gl.drawElements = (mode, count) => {
    draws.push({
      mode,
      count,
      depthWrite,
      winding,
      blend: enabled.has(gl.BLEND),
      cull: enabled.has(gl.CULL_FACE),
    });
  };
  gl.clear = () => assert.fail('Renderer must not clear host targets');
  gl.bindFramebuffer = () =>
    assert.fail('Renderer must not change host targets');
  gl.viewport = () => assert.fail('Renderer must not change the host viewport');
  return { gl, draws, textureCount: () => textures };
}

test('shared-atlas opaque primitives stay two draws, including mirrored and wireframe views', async (t) => {
  replaceGlobal(t, 'createImageBitmap', async () => ({
    width: 4,
    height: 4,
    close() {},
  }));
  const { gl, draws, textureCount } = renderingGl();
  const mirrored = matrix();
  mirrored[0] = -2;
  const source = asset({
    materials: [
      material({ baseColorTexture: { texture: 0, texCoord: 0 } }),
      material({
        baseColorTexture: { texture: 0, texCoord: 0 },
        doubleSided: true,
      }),
    ],
    primitives: [primitive(0), primitive(1)],
    images: [image('shared atlas')],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [sampler({ minFilter: 9729 })],
    draws: [
      { name: 'hull', primitive: 0, transform: mirrored },
      { name: 'fracture', primitive: 1, transform: matrix() },
    ],
  });
  const renderer = await WebGL2GltfRenderer.create(gl, source);
  assert.equal(textureCount(), 2); // Shared atlas + absent-slot white.
  assert.equal(renderer.stats.textureBytes, 68);
  assert.equal(renderer.stats.geometryBytes, 468);
  const stats = renderer.render(frame());
  assert.equal(stats.drawCalls, 2);
  assert.equal(stats.triangles, 2);
  assert.equal(stats.lines, 0);
  assert.equal(draws[0].winding, gl.CW);
  assert.equal(draws[0].cull, true);
  assert.equal(draws[1].cull, false);
  assert.ok(draws.every((draw) => draw.depthWrite && !draw.blend));
  const wire = renderer.render(frame({ wireframe: true }));
  assert.equal(wire.drawCalls, 2);
  assert.equal(wire.triangles, 0);
  assert.equal(wire.lines, 6);
  assert.ok(
    draws.slice(2).every((draw) => draw.mode === gl.LINES && !draw.cull),
  );
  source.draws[1].visible = false;
  assert.equal(renderer.render(frame()).drawCalls, 1);
  source.draws[0].visible = false;
  assert.equal(renderer.render(frame()).drawCalls, 0);
  assert.equal(textureCount(), 2);
  renderer.dispose();
  renderer.dispose();
  assert.equal(renderer.stats.geometryBytes, 0);
  assert.equal(renderer.stats.textureBytes, 0);
  assert.throws(() => renderer.render(frame()), /disposed/);
});

test('GPU quality variants share allocations and preserve independent per-instance uniforms', async t => {
  replaceGlobal(t, 'GPUBufferUsage', { VERTEX: 32, INDEX: 16, UNIFORM: 64, COPY_DST: 8 });
  replaceGlobal(t, 'GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 });
  replaceGlobal(t, 'GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 });
  replaceGlobal(t, 'GPUColorWrite', { ALL: 15 });
  const buffers = [];
  const textures = [];
  const pipelines = [];
  const uploads = [];
  const device = {
    ...scopedDevice(),
    limits: { minUniformBufferOffsetAlignment: 256, maxTextureDimension2D: 4096 },
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createBuffer: ({ size }) => {
      const buffer = { size, getMappedRange: () => new ArrayBuffer(size), unmap() {}, destroy() {} };
      buffers.push(buffer);
      return buffer;
    },
    createTexture: options => {
      const texture = { ...options, width: 1, height: 1, createView: () => ({}), destroy() {} };
      textures.push(texture);
      return texture;
    },
    createSampler: () => ({}),
    createBindGroupLayout: options => options,
    createPipelineLayout: options => options,
    createBindGroup: options => options,
    createRenderPipelineAsync: async options => {
      pipelines.push(options);
      return options;
    },
    queue: {
      writeTexture() {},
      writeBuffer(buffer, offset, data) { uploads.push({ buffer, offset, data: new Float32Array(data) }); },
      onSubmittedWorkDone: async () => {},
    },
  };
  const source = asset({
    draws: [
      { name: 'first', primitive: 0, transform: matrix(3, 0, 0) },
      { name: 'second', primitive: 0, transform: matrix(-4, 1, 0) },
    ],
  });
  const renderer = await WebGPUGltfRenderer.create(device, source, {
    colorFormat: 'rgba16float', sampleCount: 1, sampleCounts: [1, 4],
  });
  assert.equal(textures.length, 1);
  assert.equal(pipelines.length, 6);
  assert.deepEqual([...new Set(pipelines.map(p => p.multisample.count))], [1, 4]);
  const allocated = { buffers: buffers.length, textures: textures.length, pipelines: pipelines.length };
  const sampleCounts = [];
  const pass = {
    setPipeline: pipeline => sampleCounts.push(pipeline.multisample.count),
    setBindGroup() {}, setVertexBuffer() {}, setIndexBuffer() {}, drawIndexed() {},
  };
  assert.equal(renderer.render(pass, frame(), 1).drawCalls, 2);
  const objects = uploads.at(-1).data;
  assert.equal(objects[12], 3);
  assert.equal(objects[256 / 4 + 12], -4);
  source.draws[0].visible = false;
  source.draws[1].transform[12] = -7;
  assert.equal(renderer.render(pass, frame(), 4).drawCalls, 1);
  assert.equal(uploads.at(-1).data[256 / 4 + 12], -7);
  assert.deepEqual(sampleCounts, [1, 4]);
  assert.deepEqual({ buffers: buffers.length, textures: textures.length, pipelines: pipelines.length }, allocated);
  assert.throws(() => renderer.render(pass, frame(), 2), /not prepared/);
  renderer.dispose();
});

test('GL blend draws disable depth writes without leaking that state into host clears', async () => {
  const { gl, draws } = renderingGl();
  const renderer = await WebGL2GltfRenderer.create(
    gl,
    asset({
      materials: [material({ alphaMode: 'BLEND' }), material()],
      primitives: [primitive(0), primitive(1)],
      draws: [
        { name: 'transparent', primitive: 0, transform: matrix(0, 0, -2) },
        { name: 'opaque', primitive: 1, transform: matrix() },
      ],
    }),
  );
  renderer.render(frame());
  assert.equal(draws[0].depthWrite, true);
  assert.equal(draws[0].blend, false);
  assert.equal(draws[1].depthWrite, false);
  assert.equal(draws[1].blend, true);
  gl.drawElements(gl.TRIANGLES, 0);
  assert.equal(draws[2].depthWrite, true);
  assert.equal(draws[2].blend, false);
  renderer.dispose();
});
