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
          normal: [
            ...vertices.subarray(indices[i] * 18 + 3, indices[i] * 18 + 6),
          ],
          wall: [0, 1, 2].every((offset) => {
            const vertex = indices[i + offset] * 18;
            return vertices[vertex + 10] > 0.75 && vertices[vertex + 11] < 0.25;
          }),
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
  {
    primitive,
    wallOnly = false,
    frontFacesOnly = false,
    maxDistance = Infinity,
  } = {},
) {
  return triangles.some((face) => {
    if (primitive !== undefined && face.primitive !== primitive) return false;
    if (wallOnly && !face.wall) return false;
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
  assert.equal(metrics.triangles, 14772);
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

test('the intact armor hemisphere stays opaque while the construction side has voids', () => {
  for (const y of [-1, -0.6, -0.3, 0, 0.3, 0.6, 1]) {
    for (const z of [-1, -0.65, 0, 0.65, 1]) {
      const outward = vec3.normalize([-1, y, z]);
      assert.ok(
        rayHitsStation(vec3.scale(outward, 20), vec3.scale(outward, -1), {
          primitive: 0,
          frontFacesOnly: true,
          maxDistance: 20,
        }),
        `Missing intact armor along ${outward}`,
      );
    }
  }
});

test('the core has sloping planar construction faces rather than cubes or a smooth sphere', () => {
  const { vertices } = asset.primitives[1];
  let wallVertices = 0;
  let slopedVertices = 0;
  let minimumRadius = Infinity;
  let maximumRadius = 0;
  const frontDepths = new Set();
  for (let i = 0; i < vertices.length; i += 18) {
    if (vertices[i + 10] <= 0.75 || vertices[i + 11] >= 0.25) continue;
    wallVertices++;
    const normal = [...vertices.subarray(i + 3, i + 6)];
    if (Math.max(...normal.map(Math.abs)) < 0.985) slopedVertices++;
    const radius = Math.hypot(...vertices.subarray(i, i + 3));
    minimumRadius = Math.min(minimumRadius, radius);
    maximumRadius = Math.max(maximumRadius, radius);
    if (normal[2] > 0.7) frontDepths.add(vertices[i + 2].toFixed(4));
  }
  assert.ok(wallVertices > 1000, 'The wall must be actual bulkhead geometry');
  assert.ok(
    maximumRadius <= 9.351,
    'Bulkheads must stay inside the outer hull',
  );
  assert.ok(maximumRadius - minimumRadius > 2, 'The wall needs recessed bays');
  assert.ok(frontDepths.size > 50, 'Bulkhead depths must vary between courses');
  assert.ok(
    slopedVertices > wallVertices / 2,
    'Most construction faces should be oblique, not axis-aligned cube faces',
  );
  for (const face of triangles.filter((triangle) => triangle.wall)) {
    const geometricNormal = vec3.normalize(vec3.cross(face.ab, face.ac));
    assert.ok(
      vec3.dot(geometricNormal, face.normal) > 0.999,
      'Every construction face must be planar with outward-facing flat normals',
    );
  }
});

test('the construction wall contains both recessed bays and actual open regions', () => {
  for (const side of [-1, 1]) {
    let solid = 0;
    let recessed = 0;
    let through = 0;
    for (let column = 0; column < 9; column++) {
      for (let row = 0; row < 19; row++) {
        const x = 2 + column * 0.6;
        const y = -5.8 + row * 0.65;
        if (Math.hypot(x, y) > 8.2) continue;
        const origin = [x, y, side * 12];
        const direction = [0, 0, -side];
        if (
          rayHitsStation(origin, direction, { wallOnly: true, maxDistance: 7 })
        ) {
          solid++;
        } else if (
          rayHitsStation(origin, direction, { wallOnly: true, maxDistance: 12 })
        ) {
          recessed++;
        } else if (
          !rayHitsStation(origin, direction, { primitive: 1, maxDistance: 24 })
        ) {
          through++;
        }
      }
    }
    assert.ok(
      solid > 20,
      `Side ${side} must retain substantial construction: ${solid}`,
    );
    assert.ok(
      recessed > 10,
      `Side ${side} needs deep, geometric recesses: ${recessed}`,
    );
    assert.ok(
      through > 10,
      `Side ${side} needs open regions, not dark painted faces: ${through}`,
    );
  }
});

test('exposed decks have staggered elevations rather than repeated level rings', () => {
  const { vertices } = asset.primitives[1];
  const elevations = new Set();
  for (let i = 0; i < vertices.length; i += 18) {
    if (
      vertices[i + 10] > 0.75 &&
      vertices[i + 11] > 0.25 &&
      vertices[i + 11] < 0.5 &&
      vertices[i + 4] > 0.999
    ) {
      elevations.add(vertices[i + 1].toFixed(4));
    }
  }
  assert.ok(
    elevations.size > 200,
    'Individual deck fragments should not all align to the same few levels',
  );
});

test('the outer shell blocks sightlines that miss the recessed core', () => {
  for (const radius of [8.4, 9, 9.5]) {
    for (let sample = 0; sample < 32; sample++) {
      const angle = ((sample + 0.5) / 32) * Math.PI * 2;
      const origin = [20, Math.sin(angle) * radius, Math.cos(angle) * radius];
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
  const dimensions = [
    [2048, 1024],
    [768, 384],
    [768, 384],
    [1536, 768],
  ];
  for (let index = 0; index < document.images.length; index++) {
    const encoded = encodedImage(index);
    const metadata = await sharp(encoded).metadata();
    assert.equal(metadata.width, dimensions[index][0]);
    assert.equal(metadata.height, dimensions[index][1]);
    assert.equal(metadata.channels, 3);
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
    assert.deepEqual(material.emissiveFactor, [1, 1, 1]);
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
});

test('surface lights are small, sparse, clustered and excluded from the dish and bulkheads', async () => {
  const { data, info } = await sharp(encodedImage(3))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const hullWidth = (info.width * 3) / 4;
  const districts = new Array(24).fill(0);
  let lit = 0;
  let cool = 0;
  let warm = 0;
  let bright = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * 3;
      const [r, g, b] = data.subarray(offset, offset + 3);
      if (x >= hullWidth + 4) {
        assert.equal(r + g + b, 0, 'Non-hull atlas regions must stay unlit');
      }
      if (Math.max(r, g, b) <= 40 || x >= hullWidth) continue;
      lit++;
      if (b > r + 5) cool++;
      if (r > b + 10) warm++;
      if (Math.max(r, g, b) > 150) bright++;
      districts[
        Math.floor((x / hullWidth) * 6) + 6 * Math.floor((y / info.height) * 4)
      ]++;
    }
  }
  const coverage = lit / (hullWidth * info.height);
  assert.ok(
    coverage > 0.003 && coverage < 0.03,
    `Lights must cover 0.3-3% of hull texels, not broad glowing patches: ${coverage}`,
  );
  assert.ok(cool > lit * 0.9, 'Most lights should be cool white');
  assert.ok(
    warm > 10 && warm < lit * 0.08,
    'Warm lights should be rare accents',
  );
  assert.ok(
    bright > 100 && bright < lit / 3,
    'Only a minority should be bright',
  );
  assert.ok(
    Math.max(...districts) > Math.min(...districts) * 4,
    'Illumination must be clustered rather than uniformly sprinkled',
  );
});

test('final station regeneration is byte-for-byte deterministic', async () => {
  const regenerated = await generateDeathStar();
  assert.ok(
    regenerated.glb.equals(bytes),
    'Regenerated GLB must match the committed asset byte for byte',
  );
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
