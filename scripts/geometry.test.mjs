import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server;
let geometry;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  geometry = await server.ssrLoadModule('/src/engine/geometry.ts');
});

after(async () => {
  await server?.close();
});

for (let subdivisions = 0; subdivisions <= 4; subdivisions++) {
  test(`icosphere subdivision ${subdivisions} has closed, clockwise topology`, () => {
    const mesh = geometry.createIcosphere(subdivisions);
    assert.equal(mesh.vertexCount, 10 * 4 ** subdivisions + 2);
    assert.equal(mesh.indexCount, 60 * 4 ** subdivisions);
    assert.equal(mesh.positions.length, mesh.vertexCount * 3);
    assert.equal(mesh.uvs.length, mesh.vertexCount * 2);
    assert.deepEqual(mesh.normals, mesh.positions);
    assert.ok(mesh.indices instanceof Uint16Array);

    const vertices = new Set();
    for (let i = 0; i < mesh.vertexCount; i++) {
      const position = mesh.positions.subarray(i * 3, i * 3 + 3);
      assert.ok(Math.abs(Math.hypot(...position) - 1) < 1e-6);
      vertices.add(position.join(','));
    }
    assert.equal(vertices.size, mesh.vertexCount);
    for (const uv of mesh.uvs) assert.ok(uv >= 0 && uv <= 1);

    const edges = new Map();
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const face = Array.from(mesh.indices.subarray(i, i + 3));
      for (const index of face) assert.ok(index < mesh.vertexCount);
      const [a, b, c] = face.map((index) =>
        mesh.positions.subarray(index * 3, index * 3 + 3),
      );
      const ab = b.map((value, axis) => value - a[axis]);
      const ac = c.map((value, axis) => value - a[axis]);
      const cross = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      assert.ok(cross.reduce((dot, value, axis) => dot + value * a[axis], 0) < 0);

      for (let side = 0; side < 3; side++) {
        const start = face[side];
        const end = face[(side + 1) % 3];
        const key = `${Math.min(start, end)},${Math.max(start, end)}`;
        const edge = edges.get(key) ?? { count: 0, direction: 0 };
        edge.count++;
        edge.direction += start < end ? 1 : -1;
        edges.set(key, edge);
      }
    }
    assert.equal(edges.size, 30 * 4 ** subdivisions);
    for (const edge of edges.values()) {
      assert.equal(edge.count, 2);
      assert.equal(edge.direction, 0);
    }
    const lines = geometry.trianglesToLineIndices(mesh.indices, mesh.vertexCount);
    assert.equal(lines.length, edges.size * 2);
    const interleaved = geometry.interleave(mesh);
    assert.equal(interleaved.length, mesh.vertexCount * 8);
    for (let i = 0; i < mesh.vertexCount; i++) {
      assert.deepEqual(Array.from(interleaved.subarray(i * 8, i * 8 + 8)), [
        ...mesh.positions.subarray(i * 3, i * 3 + 3),
        ...mesh.normals.subarray(i * 3, i * 3 + 3),
        ...mesh.uvs.subarray(i * 2, i * 2 + 2),
      ]);
    }
  });
}

test('both renderers share the subdivision ladder and angular LOD boundaries', () => {
  assert.deepEqual(geometry.SPHERE_LODS, [4, 3, 2, 1]);
  assert.equal(geometry.SPHERE_LODS_WEBGL2, geometry.SPHERE_LODS);
  assert.deepEqual(geometry.createIcosphere(), geometry.createIcosphere(4));
  for (const [angularSize, expected] of [
    [0.1, 0], [0.06, 0], [0.059, 1], [0.025, 1],
    [0.024, 2], [0.012, 2], [0.011, 3], [0, 3],
  ]) {
    assert.equal(geometry.selectSphereLod([0, 0, 0], angularSize, [0, 0, 1]), expected);
  }
  assert.equal(geometry.selectSphereLod([0, 0, 0], 1, [0, 0, 0]), 0);
});

test('high subdivision meshes retain indices beyond the 16-bit range', () => {
  const mesh = geometry.createIcosphere(7);
  assert.ok(mesh.indices instanceof Uint32Array);
  assert.equal(mesh.vertexCount, 163842);
  assert.equal(mesh.indexCount, 983040);
  let maxIndex = 0;
  for (const index of mesh.indices) maxIndex = Math.max(maxIndex, index);
  assert.equal(maxIndex, mesh.vertexCount - 1);
});

test('invalid subdivision counts are rejected', () => {
  for (const subdivisions of [-1, 0.5, 8, NaN, Infinity]) {
    assert.throws(() => geometry.createIcosphere(subdivisions), RangeError);
  }
});
