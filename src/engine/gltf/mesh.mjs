function validateAttribute(values, name, components, expectedLength) {
  if (!(values instanceof Float32Array)) {
    throw new TypeError(`${name} must be a Float32Array.`);
  }
  if (
    values.length % components !== 0 ||
    (expectedLength !== undefined && values.length !== expectedLength)
  ) {
    throw new RangeError(`${name} has an invalid component count.`);
  }
  for (let index = 0; index < values.length; index++) {
    if (!Number.isFinite(values[index])) {
      throw new RangeError(`${name}[${index}] must be finite.`);
    }
  }
}

function validatePositions(positions) {
  validateAttribute(positions, 'positions', 3);
  if (positions.length === 0) {
    throw new RangeError('positions must contain at least one vertex.');
  }
  return positions.length / 3;
}

function validateIndices(indices, vertexCount) {
  if (!(indices instanceof Uint16Array || indices instanceof Uint32Array)) {
    throw new TypeError('indices must be a Uint16Array or Uint32Array.');
  }
  if (indices.length % 3 !== 0) {
    throw new RangeError('indices must contain complete triangles.');
  }
  for (let index = 0; index < indices.length; index++) {
    if (indices[index] >= vertexCount) {
      throw new RangeError(`indices[${index}] is outside the vertex range.`);
    }
  }
}

/** Choose the smallest glTF index type without using a primitive-restart value. */
export function createTriangleIndices(indices, vertexCount) {
  if (!Array.isArray(indices)) {
    throw new TypeError('indices must be an array of numbers.');
  }
  if (
    !Number.isInteger(vertexCount) ||
    vertexCount < 1 ||
    vertexCount > 0xffffffff
  ) {
    throw new RangeError(
      'vertexCount must be an integer from 1 to 4294967295.',
    );
  }
  if (indices.length % 3 !== 0) {
    throw new RangeError('indices must contain complete triangles.');
  }
  let maximum = 0;
  for (let index = 0; index < indices.length; index++) {
    const value = indices[index];
    if (!Number.isInteger(value) || value < 0 || value >= vertexCount) {
      throw new RangeError(`indices[${index}] is outside the vertex range.`);
    }
    maximum = Math.max(maximum, value);
  }
  return maximum < 0xffff ? new Uint16Array(indices) : new Uint32Array(indices);
}

/**
 * Accumulate triangle area vectors before normalizing. Unreferenced vertices
 * and vertices with zero total area retain a zero normal.
 */
export function computeNormals(positions, indices) {
  const vertexCount = validatePositions(positions);
  validateIndices(indices, vertexCount);
  const normals = new Float32Array(positions.length);

  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = indices[triangle] * 3;
    const b = indices[triangle + 1] * 3;
    const c = indices[triangle + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const x = aby * acz - abz * acy;
    const y = abz * acx - abx * acz;
    const z = abx * acy - aby * acx;
    for (let corner = 0; corner < 3; corner++) {
      const offset = indices[triangle + corner] * 3;
      normals[offset] += x;
      normals[offset + 1] += y;
      normals[offset + 2] += z;
    }
  }

  for (let offset = 0; offset < normals.length; offset += 3) {
    const x = normals[offset];
    const y = normals[offset + 1];
    const z = normals[offset + 2];
    const length = Math.sqrt(x * x + y * y + z * z);
    if (!Number.isFinite(length)) {
      throw new RangeError(
        'Normal accumulation overflowed; rescale positions.',
      );
    }
    if (length > 0) {
      const inverseLength = 1 / length;
      normals[offset] = x * inverseLength;
      normals[offset + 1] = y * inverseLength;
      normals[offset + 2] = z * inverseLength;
    }
  }
  return normals;
}

/**
 * Build xyzw tangent frames using Gram-Schmidt projection and UV handedness.
 * Zero-area UV triangles contribute nothing. If no usable tangent remains,
 * project the least-aligned positive coordinate axis onto the normal plane
 * (ties choose X, then Y, then Z), normalize it, and use handedness +1.
 * Normals may be non-unit, but must be nonzero.
 */
export function computeTangents(positions, normals, uvs, indices) {
  const vertexCount = validatePositions(positions);
  validateAttribute(normals, 'normals', 3, positions.length);
  validateAttribute(uvs, 'uvs', 2, vertexCount * 2);
  validateIndices(indices, vertexCount);
  const alongU = new Float64Array(positions.length);
  const alongV = new Float64Array(positions.length);

  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = indices[triangle];
    const b = indices[triangle + 1];
    const c = indices[triangle + 2];
    const du1 = uvs[b * 2] - uvs[a * 2];
    const dv1 = uvs[b * 2 + 1] - uvs[a * 2 + 1];
    const du2 = uvs[c * 2] - uvs[a * 2];
    const dv2 = uvs[c * 2 + 1] - uvs[a * 2 + 1];
    const determinant = du1 * dv2 - du2 * dv1;
    if (determinant === 0) continue;

    const inverse = 1 / determinant;
    for (let axis = 0; axis < 3; axis++) {
      const edge1 = positions[b * 3 + axis] - positions[a * 3 + axis];
      const edge2 = positions[c * 3 + axis] - positions[a * 3 + axis];
      const u = (edge1 * dv2 - edge2 * dv1) * inverse;
      const v = (edge2 * du1 - edge1 * du2) * inverse;
      for (let corner = 0; corner < 3; corner++) {
        const offset = indices[triangle + corner] * 3 + axis;
        alongU[offset] += u;
        alongV[offset] += v;
      }
    }
  }

  const tangents = new Float32Array(vertexCount * 4);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const offset = vertex * 3;
    const nx = normals[offset];
    const ny = normals[offset + 1];
    const nz = normals[offset + 2];
    const normalLengthSquared = nx * nx + ny * ny + nz * nz;
    if (normalLengthSquared === 0) {
      throw new RangeError(`normals must be nonzero at vertex ${vertex}.`);
    }
    const ux = alongU[offset];
    const uy = alongU[offset + 1];
    const uz = alongU[offset + 2];
    const vx = alongV[offset];
    const vy = alongV[offset + 1];
    const vz = alongV[offset + 2];
    const projection = (nx * ux + ny * uy + nz * uz) / normalLengthSquared;
    let x = ux - nx * projection;
    let y = uy - ny * projection;
    let z = uz - nz * projection;
    let length = Math.hypot(x, y, z);
    if (!Number.isFinite(length) || !Number.isFinite(Math.hypot(vx, vy, vz))) {
      throw new RangeError(
        `Tangent accumulation overflowed at vertex ${vertex}.`,
      );
    }

    let handedness = 1;
    if (length <= Number.EPSILON * 8 * Math.hypot(ux, uy, uz)) {
      const ax = Math.abs(nx);
      const ay = Math.abs(ny);
      const az = Math.abs(nz);
      const axis = ax <= ay && ax <= az ? 0 : ay <= az ? 1 : 2;
      const component = normals[offset + axis] / normalLengthSquared;
      x = (axis === 0 ? 1 : 0) - nx * component;
      y = (axis === 1 ? 1 : 0) - ny * component;
      z = (axis === 2 ? 1 : 0) - nz * component;
      length = Math.hypot(x, y, z);
    } else {
      const orientation =
        (ny * z - nz * y) * vx +
        (nz * x - nx * z) * vy +
        (nx * y - ny * x) * vz;
      handedness = orientation < 0 ? -1 : 1;
    }
    tangents[vertex * 4] = x / length;
    tangents[vertex * 4 + 1] = y / length;
    tangents[vertex * 4 + 2] = z / length;
    tangents[vertex * 4 + 3] = handedness;
  }
  return tangents;
}

/** Compute an axis-aligned box from nonempty, finite xyz positions. */
export function computeBounds(positions) {
  validatePositions(positions);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[offset + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return { min, max };
}
