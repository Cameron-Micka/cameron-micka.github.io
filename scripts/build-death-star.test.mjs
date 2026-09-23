import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import sharp from 'sharp';
import { validateBytes } from 'gltf-validator';
import { generateDeathStar, STATION_BUDGET } from './build-death-star.mjs';
import { createModuleTestServer } from './lib/vite-test-server.mjs';

let server;
let bytes;
let document;
let binary;
let asset;
let metrics;
let vec3;
let triangles;

before(async () => {
  [bytes, metrics] = await Promise.all([
    readFile(new URL('../public/models/death-star-ii.glb', import.meta.url)),
    readFile(
      new URL('../public/models/death-star-ii.metrics.json', import.meta.url),
      'utf8',
    ).then(JSON.parse),
  ]);
  const jsonLength = bytes.readUInt32LE(12);
  document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  binary = bytes.subarray(28 + jsonLength);
  server = await createModuleTestServer();
  const [{ parseGlb }, math] = await Promise.all([
    server.ssrLoadModule('/src/engine/gltf/loader.ts'),
    server.ssrLoadModule('/src/engine/math/vec3.ts'),
  ]);
  vec3 = math.vec3;
  asset = parseGlb(new Uint8Array(bytes));
  triangles = asset.primitives.flatMap(
    ({ vertices, indices, material }, primitive) => {
      const faces = [];
      for (let i = 0; i < indices.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map((offset) => [
          ...vertices.subarray(
            indices[i + offset] * 18,
            indices[i + offset] * 18 + 3,
          ),
        ]);
        faces.push({
          a,
          ab: vec3.sub(b, a),
          ac: vec3.sub(c, a),
          primitive,
          doubleSided: asset.materials[material].doubleSided,
        });
      }
      return faces;
    },
  );
});

after(async () => {
  await server?.close();
});

function encodedImage(index) {
  const image = document.images[index];
  const view = document.bufferViews[image.bufferView];
  return binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
}

function rayHitsStation(
  origin,
  direction,
  { primitive, frontFacesOnly = false, maxDistance = Infinity } = {},
) {
  return triangles.some((face) => {
    if (primitive !== undefined && face.primitive !== primitive) return false;
    const p = vec3.cross(direction, face.ac);
    const determinant = vec3.dot(face.ab, p);
    if (
      Math.abs(determinant) <= 1e-8 ||
      (determinant < 0 && (frontFacesOnly || !face.doubleSided))
    )
      return false;
    const offset = vec3.sub(origin, face.a);
    const u = vec3.dot(offset, p) / determinant;
    if (u < -1e-7 || u > 1 + 1e-7) return false;
    const q = vec3.cross(offset, face.ab);
    const v = vec3.dot(direction, q) / determinant;
    if (v < -1e-7 || u + v > 1 + 1e-7) return false;
    const distance = vec3.dot(face.ac, q) / determinant;
    return distance > 0 && distance < maxDistance;
  });
}

test('station GLB is self-contained core 2.0 and loads in the native renderer', () => {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(document.asset.version, '2.0');
  assert.equal(document.asset.extras.iteration, 5);
  for (const key of [
    'extensionsRequired',
    'extensionsUsed',
    'animations',
    'skins',
  ]) {
    assert.equal(document[key], undefined);
  }
  for (const resource of [...document.buffers, ...document.images])
    assert.equal(resource.uri, undefined);
  assert.deepEqual(asset.warnings, []);
  assert.equal(asset.primitives.length, 2);
  assert.equal(asset.draws.length, 2);
  assert.equal(document.materials.length, 2);
  assert.deepEqual(
    asset.primitives.map((primitive) => primitive.material),
    [0, 1],
  );
});

test('Khronos validation reports zero errors and warnings', async () => {
  const report = await validateBytes(new Uint8Array(bytes), { maxIssues: 50 });
  assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues));
  assert.equal(report.issues.numWarnings, 0, JSON.stringify(report.issues));
});

test('actual geometry, file and memory counts enforce the original realtime limits', () => {
  assert.equal(asset.stats.triangles, metrics.triangles);
  assert.equal(asset.stats.vertices, metrics.vertices);
  assert.equal(asset.stats.drawCalls, metrics.drawCalls);
  assert.equal(bytes.length, metrics.fileBytes);
  assert.equal(document.asset.extras.geometryBytes, metrics.geometryBytes);
  assert.equal(document.materials.length, metrics.materials);
  assert.deepEqual(metrics.budget, STATION_BUDGET);
  for (const [key, limit] of Object.entries(STATION_BUDGET)) {
    assert.ok(metrics[key] <= limit, `${key} exceeds ${limit}`);
  }
  assert.equal(metrics.triangles, 14902);
  assert.equal(metrics.drawCalls, 2);
  for (const axis of [0, 1, 2]) {
    assert.ok(asset.bounds.min[axis] >= -10.02);
    assert.ok(asset.bounds.max[axis] <= 10.02);
  }
});

test('geometry has finite attributes, nondegenerate faces, and orthonormal tangent frames', () => {
  for (const primitive of asset.primitives) {
    const { vertices, indices } = primitive;
    for (let i = 0; i < vertices.length; i += 18) {
      assert.ok(vertices.subarray(i, i + 18).every(Number.isFinite));
      const normal = vertices.subarray(i + 3, i + 6);
      const tangent = vertices.subarray(i + 6, i + 9);
      assert.ok(Math.abs(Math.hypot(...normal) - 1) < 0.0001);
      assert.ok(Math.abs(Math.hypot(...tangent) - 1) < 0.0001);
      assert.ok(
        Math.abs(
          normal.reduce((sum, value, axis) => sum + value * tangent[axis], 0),
        ) < 0.0001,
      );
      assert.equal(Math.abs(vertices[i + 9]), 1);
      assert.ok(vertices[i + 10] > 0 && vertices[i + 10] < 1);
      assert.ok(vertices[i + 11] > 0 && vertices[i + 11] < 1);
    }
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = [0, 1, 2].map((offset) => [
        ...vertices.subarray(
          indices[i + offset] * 18,
          indices[i + offset] * 18 + 3,
        ),
      ]);
      const ab = b.map((value, axis) => value - a[axis]);
      const ac = c.map((value, axis) => value - a[axis]);
      const area = Math.hypot(
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      );
      assert.ok(
        area > 1e-10,
        `${primitive.name} triangle ${i / 3} is degenerate`,
      );
    }
  }
});

test('the unfinished side has opaque interior backing with backface culling enabled', () => {
  for (const view of [
    [1, 0, 0],
    [1, 0, 1],
    [1, 0, -1],
    [1, 1, 0],
    [1, -1, 0],
  ]) {
    const outward = vec3.normalize(view);
    const right = vec3.normalize(vec3.cross([0, 1, 0], outward));
    const up = vec3.cross(outward, right);
    for (const x of [-6, -3, 0, 3, 6]) {
      for (const y of [-6, -3, 0, 3, 6]) {
        if (Math.hypot(x, y) > 7.5) continue;
        const origin = vec3.add(
          vec3.scale(outward, 20),
          vec3.add(vec3.scale(right, x), vec3.scale(up, y)),
        );
        assert.ok(
          rayHitsStation(origin, vec3.scale(outward, -1), {
            frontFacesOnly: true,
            maxDistance: 20,
          }),
          `See-through interior from ${view} at projected offset ${x}, ${y}`,
        );
      }
    }
  }
});

test('the outer shell blocks sightlines that miss the recessed core', () => {
  for (const radius of [8.4, 9, 9.5]) {
    for (let sample = 0; sample < 32; sample++) {
      const angle = ((sample + 0.5) / 32) * Math.PI * 2;
      const origin = [
        20,
        Math.sin(angle) * radius,
        Math.cos(angle) * radius,
      ];
      assert.ok(
        rayHitsStation(origin, [-1, 0, 0], { primitive: 0 }),
        `See-through outer shell at radius ${radius}, angle ${angle}`,
      );
    }
  }
});

test('only the outer shell is double-sided, without duplicating GPU textures or draws', async () => {
  const { createRenderPlan } = await server.ssrLoadModule(
    '/src/engine/gltf/rendererShared.ts',
  );
  const plan = createRenderPlan(asset);
  assert.deepEqual(
    plan.draws.map((draw) => draw.material.doubleSided),
    [true, false],
  );
  assert.equal(plan.draws.length, 2);
  assert.equal(
    plan.textures.filter((texture) => texture.source !== undefined).length,
    4,
  );
  assert.deepEqual(
    plan.draws[0].material.bindings,
    plan.draws[1].material.bindings,
  );
});

test('dish and equatorial trench are recessed geometry rather than painted circles', () => {
  const length = Math.hypot(-0.32, 0.36, 0.875);
  const axis = [-0.32, 0.36, 0.875].map((value) => value / length);
  const vertices = asset.primitives[0].vertices;
  const dishCenter = [];
  const dishRim = [];
  const trench = [];
  for (let i = 0; i < vertices.length; i += 18) {
    const point = [...vertices.subarray(i, i + 3)];
    const axial = point.reduce(
      (sum, value, index) => sum + value * axis[index],
      0,
    );
    const radial = Math.hypot(
      ...point.map((value, index) => value - axis[index] * axial),
    );
    if (radial < 0.0001 && axial > 0) dishCenter.push(axial);
    if (Math.abs(radial - metrics.dimensions.dishRadius) < 0.0001 && axial > 0)
      dishRim.push(axial);
    if (Math.abs(point[1]) < 0.098) trench.push(Math.hypot(point[0], point[2]));
  }
  assert.ok(dishCenter.length > 0 && dishRim.length > 0);
  assert.ok(
    Math.abs(Math.max(...dishRim) - Math.min(...dishCenter) - 1) < 0.0001,
  );
  assert.ok(trench.length > 100);
  assert.ok(trench.every((radius) => Math.abs(radius - 9.88) < 0.0001));
});

test('the atlas contains four embedded readable PBR maps with correct color-space roles', async () => {
  let memory = 0;
  for (let index = 0; index < document.images.length; index++) {
    const encoded = encodedImage(index);
    const metadata = await sharp(encoded).metadata();
    assert.equal(metadata.width, index === 0 ? 2048 : 1024);
    assert.equal(metadata.height, index === 0 ? 1024 : 512);
    assert.equal(metadata.hasAlpha, false);
    assert.equal(encoded.length, metrics.textures[index].bytes);
    memory += Math.ceil((metadata.width * metadata.height * 4 * 4) / 3);
  }
  assert.equal(memory, metrics.textureBytesWithMipmaps);
  for (const material of document.materials) {
    assert.equal(material.pbrMetallicRoughness.baseColorTexture.index, 0);
    assert.equal(material.normalTexture.index, 1);
    assert.equal(
      material.pbrMetallicRoughness.metallicRoughnessTexture.index,
      2,
    );
    assert.equal(material.occlusionTexture.index, 2);
    assert.equal(material.emissiveTexture.index, 3);
    assert.equal(material.alphaMode, 'OPAQUE');
  }
  const orm = await sharp(encodedImage(2)).raw().toBuffer();
  let minimumRoughness = 255;
  let maximumMetal = 0;
  for (let offset = 0; offset < orm.length; offset += 3) {
    minimumRoughness = Math.min(minimumRoughness, orm[offset + 1]);
    maximumMetal = Math.max(maximumMetal, orm[offset + 2]);
  }
  assert.ok(
    minimumRoughness > 120,
    'Station should use rough alloy rather than mirror chrome',
  );
  assert.ok(maximumMetal > 170);
  const emission = await sharp(encodedImage(3)).raw().toBuffer();
  const lights = emission.filter(
    (value, offset) => offset % 3 === 0 && value > 0,
  ).length;
  assert.ok(lights > 0);
  assert.ok(
    lights / (1024 * 512) < 0.01,
    'Lighting should remain sparse maintenance pinpricks',
  );
});

test('final station regeneration is byte-for-byte deterministic', async () => {
  const regenerated = await generateDeathStar();
  assert.deepEqual(regenerated.glb, bytes);
  assert.deepEqual(regenerated.stats, metrics);
});

test('invalid iteration arguments fail explicitly', async () => {
  for (const iteration of [0, 6, 1.5, NaN, '5']) {
    await assert.rejects(
      generateDeathStar({ iteration }),
      /integer between 1 and 5/,
    );
  }
});
