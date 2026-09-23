type TriangleIndices = Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;

/**
 * Create the smallest glTF triangle index array, promoting index 65535 to uint32
 * because it is the uint16 primitive-restart value. Invalid triangle counts,
 * noninteger indices, and out-of-range indices throw.
 */
export function createTriangleIndices(
  indices: readonly number[],
  vertexCount: number,
): TriangleIndices;

/**
 * Compute area-weighted vertex normals without mutating either input.
 * Positions must contain nonempty, finite xyz triples; indices must reference
 * complete triangles within that vertex array. Invalid inputs throw.
 * Vertices with zero accumulated area (including unused vertices) remain zero.
 * Accumulation uses float32 precision; overflow throws instead of returning NaN.
 */
export function computeNormals(
  positions: Float32Array<ArrayBuffer>,
  indices: TriangleIndices,
): Float32Array<ArrayBuffer>;

/**
 * Compute normalized xyzw tangents without mutating the inputs. Normals and uv
 * pairs must match the vertex count and be finite; normals must be nonzero.
 * Gram-Schmidt projection also supports non-unit normals. Invalid inputs throw.
 *
 * Degenerate UV triangles contribute nothing. If a vertex has no usable tangent,
 * the least-aligned positive axis is projected onto its normal plane and
 * normalized, with w = +1. Ties prefer X, then Y, then Z.
 */
export function computeTangents(
  positions: Float32Array<ArrayBuffer>,
  normals: Float32Array<ArrayBuffer>,
  uvs: Float32Array<ArrayBuffer>,
  indices: TriangleIndices,
): Float32Array<ArrayBuffer>;

/** Return xyz bounds of nonempty, finite positions; invalid inputs throw. */
export function computeBounds(positions: Float32Array<ArrayBuffer>): {
  min: [number, number, number];
  max: [number, number, number];
};
