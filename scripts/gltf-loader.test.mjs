import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import sharp from 'sharp';
import { glb, GlbFixture } from './lib/glb-fixture.mjs';
import { createModuleTestServer } from './lib/vite-test-server.mjs';

let server;
let parseGlb;
let loadGlb;
let png;

before(async () => {
  server = await createModuleTestServer();
  ({ parseGlb, loadGlb } = await server.ssrLoadModule(
    '/src/engine/gltf/loader.ts',
  ));
  png = await sharp({
    create: { width: 2, height: 2, channels: 4, background: '#ff804080' },
  })
    .png()
    .toBuffer();
});

after(async () => {
  await server?.close();
});

class Fixture extends GlbFixture {
  texture() {
    return super.texture(png);
  }
}

test('loads the delivered ring without Three.js or decoder extensions', async () => {
  const bytes = new Uint8Array(
    await readFile(
      new URL('../public/models/broken-ring.glb', import.meta.url),
    ),
  );
  const asset = parseGlb(bytes);
  assert.equal(asset.stats.triangles, 13264);
  assert.equal(asset.stats.drawCalls, 2);
  assert.equal(asset.stats.fileBytes, bytes.length);
  assert.equal(asset.stats.vertices, 12776);
  assert.equal(asset.images.length, 4);
  assert.deepEqual(asset.warnings, []);
  assert.equal(asset.draws[0].primitive, 0);
  assert.equal(asset.primitives[0].vertices.length % 18, 0);
  assert.ok(asset.bounds.max[0] > asset.bounds.min[0]);
});

test('non-indexed geometry receives flat normals, tangent fallback and glTF defaults', () => {
  const asset = parseGlb(new Fixture().build());
  const p = asset.primitives[0];
  assert.deepEqual(Array.from(p.indices), [0, 1, 2]);
  assert.deepEqual(Array.from(p.vertices.slice(3, 6)), [0, 0, 1]);
  assert.ok(p.vertices.every(Number.isFinite));
  assert.deepEqual(Array.from(p.vertices.slice(14, 18)), [1, 1, 1, 1]);
  assert.equal(asset.materials[p.material].metallic, 1);
  assert.equal(asset.materials[p.material].roughness, 1);
  assert.equal(asset.materials[p.material].alphaMode, 'OPAQUE');
});

test('parses a Uint8Array subrange independently of its backing-buffer alignment', () => {
  const bytes = new Fixture().build();
  const envelope = new Uint8Array(bytes.length + 3);
  envelope.set(bytes, 1);
  assert.equal(
    parseGlb(envelope.subarray(1, 1 + bytes.length)).stats.triangles,
    1,
  );
});

test('indexed geometry without normals splits shared vertices for flat shading', () => {
  const f = new Fixture();
  f.primitive.attributes.POSITION = f.attribute(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    'VEC3',
  );
  f.primitive.indices = f.attribute(
    new Uint8Array([0, 1, 2, 0, 3, 1]),
    'SCALAR',
  );
  const p = parseGlb(f.build()).primitives[0];
  assert.equal(p.vertices.length / 18, 6);
  assert.deepEqual(Array.from(p.vertices.slice(3, 6)), [0, 0, 1]);
  assert.deepEqual(
    Array.from(p.vertices.slice(3 * 18 + 3, 3 * 18 + 6)),
    [0, 1, 0],
  );
});

test('reads strided accessors and offsets without leaking bytes outside bufferViews', () => {
  const f = new Fixture().normals();
  const view = f.bytes(
    new Float32Array([99, 0, 0, 0, 88, 1, 0, 0, 77, 0, 1, 0]),
    16,
  );
  f.document.accessors[0] = {
    bufferView: view,
    byteOffset: 4,
    componentType: 5126,
    type: 'VEC3',
    count: 3,
  };
  const p = parseGlb(f.build()).primitives[0];
  assert.deepEqual(Array.from(p.vertices.slice(18, 21)), [1, 0, 0]);
  assert.deepEqual(p.bounds, { min: [0, 0, 0], max: [1, 1, 0] });
  f.document.bufferViews[view].byteLength -= 4;
  assert.throws(() => parseGlb(f.build()), /buffer bounds/);
});

test('decodes normalized UV/color attributes and preserves UV1 material selection', () => {
  const f = new Fixture().normals().texture();
  f.primitive.attributes.TEXCOORD_1 = f.attribute(
    new Uint16Array([0, 0, 65535, 0, 0, 65535]),
    'VEC2',
    { normalized: true },
  );
  f.primitive.attributes.COLOR_0 = f.attribute(
    new Uint8Array([255, 128, 0, 0, 255, 0, 0, 0, 255]),
    'VEC3',
    { normalized: true },
  );
  f.document.materials[0] = {
    pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 1 } },
  };
  const asset = parseGlb(f.build());
  assert.equal(asset.materials[0].baseColorTexture.texCoord, 1);
  assert.equal(asset.primitives[0].vertices[18 + 12], 1);
  assert.ok(Math.abs(asset.primitives[0].vertices[15] - 128 / 255) < 1e-6);
  assert.equal(asset.primitives[0].vertices[17], 1);
});

test('applies sparse accessors, including a zero-initialized accessor without a bufferView', () => {
  const f = new Fixture();
  f.document.accessors[0] = {
    componentType: 5126,
    type: 'VEC3',
    count: 3,
    sparse: {
      count: 2,
      indices: {
        bufferView: f.bytes(new Uint8Array([1, 2])),
        componentType: 5121,
      },
      values: { bufferView: f.bytes(new Float32Array([1, 0, 0, 0, 1, 0])) },
    },
  };
  const p = parseGlb(f.build()).primitives[0];
  assert.deepEqual(p.bounds, { min: [0, 0, 0], max: [1, 1, 0] });
  f.document.accessors[0].sparse.indices.bufferView = f.bytes(
    new Uint8Array([2, 1]),
  );
  assert.throws(() => parseGlb(f.build()), /strictly increasing/);
});

test('supports triangle strips and fans with correct winding', () => {
  for (const mode of [5, 6]) {
    const f = new Fixture();
    f.primitive.attributes.POSITION = f.attribute(
      new Float32Array(
        mode === 5
          ? [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]
          : [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
      ),
      'VEC3',
    );
    f.primitive.mode = mode;
    const asset = parseGlb(f.build());
    assert.equal(asset.stats.triangles, 2);
    for (let i = 0; i < 6; i++)
      assert.equal(asset.primitives[0].vertices[i * 18 + 5], 1);
  }
});

test('preserves unsigned 32-bit indices beyond uint16 without float conversion', () => {
  const f = new Fixture();
  const count = 65537;
  const positions = new Float32Array(count * 3);
  positions.set([1, 0, 0], 65535 * 3);
  positions.set([0, 1, 0], 65536 * 3);
  const normals = new Float32Array(count * 3);
  for (let i = 2; i < normals.length; i += 3) normals[i] = 1;
  f.primitive.attributes.POSITION = f.attribute(positions, 'VEC3');
  f.primitive.attributes.NORMAL = f.attribute(normals, 'VEC3');
  f.primitive.indices = f.attribute(
    new Uint32Array([0, 65535, 65536]),
    'SCALAR',
  );
  const asset = parseGlb(f.build());
  assert.ok(asset.primitives[0].indices instanceof Uint32Array);
  assert.deepEqual(Array.from(asset.primitives[0].indices), [0, 65535, 65536]);
});

test('composes parent TRS, matrix children, nonuniform and mirrored scales', () => {
  const f = new Fixture();
  f.document.nodes = [
    { translation: [10, 0, 0], scale: [-2, 3, 1], children: [1] },
    { mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1] },
  ];
  const asset = parseGlb(f.build());
  assert.deepEqual(asset.bounds, { min: [8, 6, 0], max: [10, 9, 0] });
  assert.equal(asset.draws[0].transform[0], -2);
});

test('selects default or explicitly requested scenes and shares mesh resources across nodes', () => {
  const f = new Fixture();
  f.document.nodes = [{ mesh: 0 }, { mesh: 0, translation: [4, 0, 0] }];
  f.document.scenes = [{ nodes: [0] }, { nodes: [0, 1] }];
  f.document.scene = 1;
  const asset = parseGlb(f.build());
  assert.equal(asset.primitives.length, 1);
  assert.equal(asset.draws.length, 2);
  assert.equal(asset.stats.triangles, 2);
  assert.equal(parseGlb(f.build(), { scene: 0 }).draws.length, 1);
});

test('loads all core PBR factors, texture slots, alpha modes and sampler settings', () => {
  const f = new Fixture().uv().texture();
  f.document.samplers = [
    { magFilter: 9728, minFilter: 9986, wrapS: 33071, wrapT: 33648 },
  ];
  f.document.textures[0].sampler = 0;
  f.document.materials[0] = {
    pbrMetallicRoughness: {
      baseColorFactor: [0.2, 0.4, 0.6, 0.8],
      metallicFactor: 0.3,
      roughnessFactor: 0.7,
      baseColorTexture: { index: 0 },
      metallicRoughnessTexture: { index: 0 },
    },
    normalTexture: { index: 0, scale: 0.6 },
    occlusionTexture: { index: 0, strength: 0.2 },
    emissiveTexture: { index: 0 },
    emissiveFactor: [1, 0.2, 0.1],
    alphaMode: 'MASK',
    alphaCutoff: 0.4,
    doubleSided: true,
  };
  const asset = parseGlb(f.build());
  const m = asset.materials[0];
  assert.deepEqual(m.baseColor, [0.2, 0.4, 0.6, 0.8]);
  assert.equal(m.normalScale, 0.6);
  assert.equal(m.occlusionStrength, 0.2);
  assert.equal(m.alphaCutoff, 0.4);
  assert.equal(m.doubleSided, true);
  assert.equal(m.emissiveTexture.texture, 0);
  assert.deepEqual(asset.samplers[0], f.document.samplers[0]);
  f.document.materials[0].alphaMode = 'BLEND';
  assert.equal(parseGlb(f.build()).materials[0].alphaMode, 'BLEND');
});

test('supports data URIs and explicitly resolved external buffer/image resources', () => {
  const f = new Fixture().uv().texture();
  f.build();
  const binary = Buffer.concat(f.parts);
  f.document.buffers[0].uri = `data:application/octet-stream;base64,${binary.toString('base64')}`;
  f.document.images[0] = {
    uri: `data:image/png;base64,${png.toString('base64')}`,
  };
  assert.equal(parseGlb(glb(f.document)).images[0].mimeType, 'image/png');
  f.document.buffers[0].uri = 'mesh.bin';
  f.document.images[0].uri = 'albedo.png';
  assert.throws(() => parseGlb(glb(f.document)), /external resource/);
  const asset = parseGlb(glb(f.document), {
    resources: new Map([
      ['mesh.bin', new Uint8Array(binary)],
      ['albedo.png', new Uint8Array(png)],
    ]),
  });
  assert.equal(asset.stats.triangles, 1);
});

test('loads relative external resources and propagates HTTP and abort errors', async () => {
  const f = new Fixture().uv().texture();
  f.build();
  const binary = Buffer.concat(f.parts);
  f.document.buffers[0].uri = 'mesh.bin';
  f.document.images[0] = { uri: 'albedo.png' };
  const calls = [];
  const request = async (url, options) => {
    calls.push(String(url));
    options.signal?.throwIfAborted();
    const path = new URL(url).pathname;
    return new Response(
      path.endsWith('.glb')
        ? glb(f.document)
        : path.endsWith('.bin')
          ? binary
          : png,
    );
  };
  const asset = await loadGlb('https://example.test/models/object.glb', {
    fetch: request,
  });
  assert.equal(asset.images.length, 1);
  assert.deepEqual(calls.sort(), [
    'https://example.test/models/albedo.png',
    'https://example.test/models/mesh.bin',
    'https://example.test/models/object.glb',
  ]);
  await assert.rejects(
    loadGlb('https://example.test/missing.glb', {
      fetch: async () => new Response('', { status: 404 }),
    }),
    /HTTP 404/,
  );
  await assert.rejects(
    loadGlb('https://example.test/object.glb', {
      fetch: request,
      signal: AbortSignal.abort(),
    }),
    { name: 'AbortError' },
  );
});

test('required extensions and unsupported deforming geometry fail explicitly', () => {
  for (const mutate of [
    (f) => {
      f.document.extensionsRequired = ['KHR_draco_mesh_compression'];
    },
    (f) => {
      f.document.animations = [{}];
    },
    (f) => {
      f.document.skins = [{}];
    },
    (f) => {
      f.primitive.targets = [{}];
    },
    (f) => {
      f.document.nodes[0].skin = 0;
    },
    (f) => {
      f.primitive.mode = 1;
    },
  ]) {
    const f = new Fixture();
    mutate(f);
    assert.throws(() => parseGlb(f.build()), /not supported|unsupported/);
  }
  const f = new Fixture();
  f.document.extensionsUsed = ['VENDOR_optional'];
  assert.match(
    parseGlb(f.build(true)).warnings.join(' '),
    /optional.*core glTF fallback/,
  );
  assert.equal(parseGlb(f.build(true)).warnings.length, 2);
});

test('rejects malformed headers, chunks, geometry, references and scene graphs', () => {
  const valid = new Fixture().build();
  for (const mutate of [
    (b) => new DataView(b.buffer).setUint32(0, 0, true),
    (b) => new DataView(b.buffer).setUint32(4, 1, true),
    (b) => new DataView(b.buffer).setUint32(8, b.length + 4, true),
    (b) => new DataView(b.buffer).setUint32(12, b.length, true),
  ]) {
    const bytes = valid.slice();
    mutate(bytes);
    assert.throws(() => parseGlb(bytes), /GLB:/);
  }
  for (const mutate of [
    (f) => {
      f.document.accessors[0].count = 9000;
    },
    (f) => {
      f.document.accessors[0].byteOffset = 1;
    },
    (f) => {
      f.primitive.indices = f.attribute(new Uint16Array([0, 1, 9]), 'SCALAR');
    },
    (f) => {
      f.primitive.material = 0;
    },
    (f) => {
      f.document.nodes[0].children = [0];
    },
    (f) => {
      f.document.nodes = [{ children: [2] }, { children: [2] }, { mesh: 0 }];
    },
    (f) => {
      f.document.scenes[0].nodes = [0, 0];
    },
    (f) => {
      f.document.nodes[0].scale = [0, 1, 1];
    },
    (f) => {
      f.document.nodes[0].translation = [0, NaN, 0];
    },
    (f) => {
      f.document.nodes[0].matrix = [
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
      ];
      f.document.nodes[0].scale = [1, 1, 1];
    },
    (f) => {
      f.document.buffers[0].uri = 'data:application/octet-stream,%ZZ';
    },
  ]) {
    const f = new Fixture();
    mutate(f);
    assert.throws(() => parseGlb(f.build()), /GLB:/);
  }
});

test('missing UV sets, corrupt images and invalid sampler/material ranges fail explicitly', () => {
  for (const mutate of [
    (f) => {
      f.document.materials[0].normalTexture = { index: 0 };
    },
    (f) => {
      f.document.materials[0].pbrMetallicRoughness = {
        baseColorTexture: { index: 0, texCoord: 2 },
      };
    },
    (f) => {
      f.document.images[0].mimeType = 'image/jpeg';
    },
    (f) => {
      f.document.textures[0].sampler = 0;
    },
    (f) => {
      f.document.materials[0].pbrMetallicRoughness = { metallicFactor: 2 };
    },
    (f) => {
      f.document.materials[0].occlusionTexture = { index: 8 };
    },
  ]) {
    const f = new Fixture().texture();
    mutate(f);
    assert.throws(() => parseGlb(f.build()), /GLB:/);
  }
});
