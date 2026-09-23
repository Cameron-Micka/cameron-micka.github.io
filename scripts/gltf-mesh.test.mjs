import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  computeBounds,
  computeNormals,
  computeTangents,
  createTriangleIndices,
} from '../src/engine/gltf/mesh.mjs';

const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
const indices = new Uint16Array([0, 1, 2]);

function close(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index++) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `component ${index}: ${actual[index]} != ${expected[index]}`,
    );
  }
}

for (const IndexArray of [Uint16Array, Uint32Array]) {
  test(`normals follow triangle winding with ${IndexArray.name}`, () => {
    const forward = computeNormals(positions, new IndexArray([0, 1, 2]));
    assert.ok(forward instanceof Float32Array);
    assert.ok(forward.buffer instanceof ArrayBuffer);
    close(forward, normals);
    close(
      computeNormals(positions, new IndexArray([0, 2, 1])),
      normals.map((value) => -value),
    );
  });
}

test('shared normals are weighted by triangle area, not face count', () => {
  const points = new Float32Array([
    0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 1,
  ]);
  const result = computeNormals(points, new Uint16Array([0, 1, 2, 0, 3, 4]));
  close(result.subarray(0, 3), [1 / Math.sqrt(17), 0, 4 / Math.sqrt(17)]);
  close(result.subarray(3, 9), [0, 0, 1, 0, 0, 1]);
  close(result.subarray(9), [1, 0, 0, 1, 0, 0]);
});

test('zero-area triangles and unused vertices have zero normals', () => {
  const points = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0]);
  close(
    computeNormals(points, new Uint16Array([0, 1, 2])),
    new Float32Array(points.length),
  );
  close(computeNormals(positions, new Uint16Array()), new Float32Array(9));
});

test('tangents are normalized and preserve mirrored UV handedness', () => {
  close(
    computeTangents(positions, normals, uvs, indices),
    [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
  );
  const mirrored = new Float32Array([0, 0, -1, 0, 0, 1]);
  close(
    computeTangents(positions, normals, mirrored, new Uint32Array(indices)),
    [-1, 0, 0, -1, -1, 0, 0, -1, -1, 0, 0, -1],
  );
  const reversed = new Uint16Array([0, 2, 1]);
  close(
    computeTangents(
      positions,
      computeNormals(positions, reversed),
      uvs,
      reversed,
    ),
    [1, 0, 0, -1, 1, 0, 0, -1, 1, 0, 0, -1],
  );
});

test('Gram-Schmidt removes the normal component, including non-unit normals', () => {
  const tilted = new Float32Array([0, 0, 0, 1, 0, 1, 0, 1, 0]);
  close(
    computeTangents(
      tilted,
      normals.map((value) => value * 2),
      uvs,
      indices,
    ),
    [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
  );
});

test('degenerate UVs use a deterministic least-aligned-axis fallback', () => {
  const directions = new Float32Array([1, 0, 0, 0, 1, 0, 1, 1, 1]);
  const expected = [
    0,
    1,
    0,
    1,
    1,
    0,
    0,
    1,
    2 / Math.sqrt(6),
    -1 / Math.sqrt(6),
    -1 / Math.sqrt(6),
    1,
  ];
  for (const collapsed of [
    new Float32Array(6),
    new Float32Array([0, 0, 1, 0, 2, 0]),
  ]) {
    const first = computeTangents(positions, directions, collapsed, indices);
    assert.deepEqual(
      first,
      computeTangents(positions, directions, collapsed, indices),
    );
    close(first, expected);
    for (let vertex = 0; vertex < 3; vertex++) {
      const n = directions.subarray(vertex * 3, vertex * 3 + 3);
      const t = first.subarray(vertex * 4, vertex * 4 + 3);
      close(
        [Math.hypot(...t), n[0] * t[0] + n[1] * t[1] + n[2] * t[2]],
        [1, 0],
      );
    }
  }
});

test('degenerate UV faces do not contaminate useful shared tangents', () => {
  const points = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0]);
  const faces = new Uint16Array([0, 1, 2, 0, 3, 1]);
  close(
    computeTangents(
      points,
      computeNormals(points, faces),
      new Float32Array([0, 0, 1, 0, 0, 1, 2, 0]),
      faces,
    ),
    [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
  );
});

test('small but nondegenerate UVs retain their direction and handedness', () => {
  close(
    computeTangents(
      positions,
      normals,
      new Float32Array([0, 0, -1e-12, 0, 0, 1e-12]),
      indices,
    ),
    [-1, 0, 0, -1, -1, 0, 0, -1, -1, 0, 0, -1],
  );
});

test('unused or normal-parallel tangents use the same finite fallback', () => {
  close(
    computeTangents(positions, normals, uvs, new Uint16Array()),
    [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
  );
  close(
    computeTangents(
      positions,
      new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
      uvs,
      indices,
    ),
    [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
  );
});

test('bounds handle negative coordinates, single vertices and typed subarrays', () => {
  const points = new Float32Array([99, 99, 99, -5, -2, -9, -1, -7, -3, 99]);
  assert.deepEqual(computeBounds(points.subarray(3, 9)), {
    min: [-5, -7, -9],
    max: [-1, -2, -3],
  });
  assert.deepEqual(computeBounds(points.subarray(3, 6)), {
    min: [-5, -2, -9],
    max: [-5, -2, -9],
  });
});

test('helpers respect byte offsets, allocate outputs, and do not mutate inputs', () => {
  const points = new Float32Array([99, ...positions, 99]).subarray(1, 10);
  const directions = new Float32Array([99, ...normals, 99]).subarray(1, 10);
  const texcoords = new Float32Array([99, ...uvs, 99]).subarray(1, 7);
  const faces = new Uint16Array([99, ...indices, 99]).subarray(1, 4);
  const inputs = [points, directions, texcoords, faces];
  const snapshots = inputs.map((input) => input.slice());
  const resultNormals = computeNormals(points, faces);
  const resultTangents = computeTangents(points, directions, texcoords, faces);
  close(resultNormals, normals);
  close(resultTangents, [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);
  assert.ok(resultTangents.buffer instanceof ArrayBuffer);
  assert.notEqual(resultNormals.buffer, points.buffer);
  assert.notEqual(resultTangents.buffer, directions.buffer);
  assert.deepEqual(computeBounds(points), { min: [0, 0, 0], max: [1, 1, 0] });
  inputs.forEach((input, index) => assert.deepEqual(input, snapshots[index]));
});

test('invalid position sizes, types and nonfinite values throw explicitly', () => {
  for (const bad of [
    [],
    new Float64Array(positions),
    new Float32Array(),
    new Float32Array(4),
    new Float32Array([NaN, 0, 0]),
    new Float32Array([0, Infinity, 0]),
    new Float32Array([0, 0, -Infinity]),
  ]) {
    for (const operation of [
      () => computeNormals(bad, indices),
      () => computeTangents(bad, normals, uvs, indices),
      () => computeBounds(bad),
    ]) {
      assert.throws(operation, /positions/);
    }
  }
});

test('invalid triangle index types, counts and vertex references throw', () => {
  for (const bad of [
    [0, 1, 2],
    new Uint8Array([0, 1, 2]),
    new Float32Array([0, 1, 2]),
    new Uint16Array([0, 1]),
    new Uint16Array([0, 1, 3]),
    new Uint32Array([0, 1, 0xffffffff]),
  ]) {
    assert.throws(() => computeNormals(positions, bad), /indices/);
    assert.throws(
      () => computeTangents(positions, normals, uvs, bad),
      /indices/,
    );
  }
});

test('tangent inputs require matching finite attributes and nonzero normals', () => {
  for (const bad of [
    [...normals],
    new Float32Array(6),
    new Float32Array([NaN, ...normals.subarray(1)]),
    new Float32Array(9),
  ]) {
    assert.throws(
      () => computeTangents(positions, bad, uvs, indices),
      /normals/,
    );
  }
  for (const bad of [
    [...uvs],
    new Float32Array(4),
    new Float32Array([Infinity, ...uvs.subarray(1)]),
  ]) {
    assert.throws(
      () => computeTangents(positions, normals, bad, indices),
      /uvs/,
    );
  }
});

test('normal overflow fails instead of returning nonfinite attributes', () => {
  assert.throws(
    () =>
      computeNormals(
        new Float32Array([0, 0, 0, 1e30, 0, 0, 0, 1e30, 0]),
        indices,
      ),
    /overflowed/,
  );
});

test('triangle indices use the smallest safe glTF component width', () => {
  for (const [values, count, ExpectedArray] of [
    [[], 1, Uint16Array],
    [[0, 1, 2], 100000, Uint16Array],
    [[0, 65533, 65534], 65535, Uint16Array],
    [[0, 65534, 65535], 65536, Uint32Array],
    [[0, 65535, 65536], 65537, Uint32Array],
    [[0, 1, 0xfffffffe], 0xffffffff, Uint32Array],
  ]) {
    const result = createTriangleIndices(values, count);
    assert.ok(result instanceof ExpectedArray);
    assert.ok(result.buffer instanceof ArrayBuffer);
    assert.deepEqual([...result], values);
  }
});

test('triangle index creation rejects truncation, wrapping and restart values', () => {
  for (const bad of [
    [0, 1],
    [-1, 1, 2],
    [0, 1.5, 2],
    [0, NaN, 2],
    [0, Infinity, 2],
    [0, 1, 3],
    [0, 1, 65536],
    new Array(3),
    new Uint16Array([0, 1, 2]),
  ]) {
    assert.throws(() => createTriangleIndices(bad, 3), /indices/);
  }
  for (const count of [0, -1, 1.5, NaN, Infinity, '3', 0x100000000]) {
    assert.throws(() => createTriangleIndices([0, 1, 2], count), /vertexCount/);
  }
  assert.throws(
    () => createTriangleIndices([0, 1, 0xffffffff], 0xffffffff),
    /indices/,
  );
});

test('normals and tangents support uint32 vertex references above 65535', () => {
  const points = new Float32Array(65538 * 3);
  points.set(positions, 65535 * 3);
  const faces = createTriangleIndices([65535, 65536, 65537], 65538);
  close(computeNormals(points, faces).subarray(65535 * 3), normals);
  const directions = new Float32Array(points.length);
  for (let offset = 2; offset < directions.length; offset += 3) {
    directions[offset] = 1;
  }
  const texcoords = new Float32Array(65538 * 2);
  texcoords.set(uvs, 65535 * 2);
  close(
    computeTangents(points, directions, texcoords, faces).subarray(65535 * 4),
    [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
  );
});

test('delivered ring normals, tangents and bounds are preserved within float32 precision', async () => {
  const glb = await readFile(
    new URL('../public/models/broken-ring.glb', import.meta.url),
  );
  const jsonLength = glb.readUInt32LE(12);
  const document = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
  const binary = glb.subarray(28 + jsonLength);
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const arrays = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  function readAccessor(index) {
    const accessor = document.accessors[index];
    const view = document.bufferViews[accessor.bufferView];
    const ArrayType = arrays[accessor.componentType];
    const count = accessor.count * components[accessor.type];
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    assert.equal(view.byteStride, undefined);
    return new ArrayType(
      binary.buffer.slice(
        binary.byteOffset + offset,
        binary.byteOffset + offset + count * ArrayType.BYTES_PER_ELEMENT,
      ),
    );
  }
  for (const mesh of document.meshes) {
    for (const primitive of mesh.primitives) {
      const points = readAccessor(primitive.attributes.POSITION);
      const faces = readAccessor(primitive.indices);
      const directions = computeNormals(points, faces);
      const tangents = computeTangents(
        points,
        directions,
        readAccessor(primitive.attributes.TEXCOORD_0),
        faces,
      );
      close(directions, readAccessor(primitive.attributes.NORMAL), 2e-7);
      close(tangents, readAccessor(primitive.attributes.TANGENT), 2e-7);
      const accessor = document.accessors[primitive.attributes.POSITION];
      assert.deepEqual(computeBounds(points), {
        min: accessor.min,
        max: accessor.max,
      });
    }
  }
});
