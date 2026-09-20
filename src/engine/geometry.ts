export interface GeometryData {
  positions: Float32Array<ArrayBuffer>; // xyz
  normals: Float32Array<ArrayBuffer>; // xyz
  uvs: Float32Array<ArrayBuffer>; // uv
  indices: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
  vertexCount: number;
  indexCount: number;
}

// Subdivide an icosahedron and project each midpoint onto the unit sphere.
// Shared edge vertices keep the mesh watertight, including in wireframe.
export function createIcosphere(subdivisions = 4): GeometryData {
  if (!Number.isInteger(subdivisions) || subdivisions < 0 || subdivisions > 7) {
    throw new RangeError('Icosphere subdivisions must be an integer from 0 to 7');
  }
  const positions: number[] = [];
  const uvs: number[] = [];
  const addVertex = (x: number, y: number, z: number): number => {
    const length = Math.hypot(x, y, z);
    const index = positions.length / 3;
    positions.push(x / length, y / length, z / length);
    return index;
  };
  const t = (1 + Math.sqrt(5)) / 2;
  for (const [x, y, z] of [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ]) {
    addVertex(x!, y!, z!);
  }
  // Clockwise when viewed from outside, matching both renderers' culling.
  let indices = [
    0, 5, 11, 0, 1, 5, 0, 7, 1, 0, 10, 7, 0, 11, 10,
    1, 9, 5, 5, 4, 11, 11, 2, 10, 10, 6, 7, 7, 8, 1,
    3, 4, 9, 3, 2, 4, 3, 6, 2, 3, 8, 6, 3, 9, 8,
    4, 5, 9, 2, 11, 4, 6, 10, 2, 8, 7, 6, 9, 1, 8,
  ];

  for (let level = 0; level < subdivisions; level++) {
    const vertexCount = positions.length / 3;
    const midpoints = new Map<number, number>();
    const midpoint = (a: number, b: number): number => {
      const key = Math.min(a, b) * vertexCount + Math.max(a, b);
      const cached = midpoints.get(key);
      if (cached !== undefined) return cached;
      const index = addVertex(
        positions[a * 3]! + positions[b * 3]!,
        positions[a * 3 + 1]! + positions[b * 3 + 1]!,
        positions[a * 3 + 2]! + positions[b * 3 + 2]!,
      );
      midpoints.set(key, index);
      return index;
    };
    const refined: number[] = [];
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]!;
      const b = indices[i + 1]!;
      const c = indices[i + 2]!;
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      refined.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    indices = refined;
  }

  // Preserve the vertex layout; procedural sphere shaders use positions, not UVs.
  for (let i = 0; i < positions.length; i += 3) {
    uvs.push(
      Math.atan2(positions[i + 2]!, positions[i]!) / (2 * Math.PI) + 0.5,
      Math.acos(Math.max(-1, Math.min(1, positions[i + 1]!))) / Math.PI,
    );
  }

  const vertexCount = positions.length / 3;
  const indexArray =
    vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: indexArray,
    vertexCount,
    indexCount: indices.length,
  };
}

// Level-of-detail tessellations for the sphere mesh, ordered finest first.
// Index 0 is the full-detail mesh used for bodies that fill a large part of
// the screen (the focused planet, the sun); the coarser levels are swapped in
// as a body shrinks with distance, where the extra vertices are invisible.
// Subdivision counts: 5,120 / 1,280 / 320 / 80 triangles.
export const SPHERE_LODS: readonly number[] = [4, 3, 2, 1];

// Matching tessellation keeps silhouettes and interpolated surface detail
// consistent when switching renderers.
export const SPHERE_LODS_WEBGL2: readonly number[] = SPHERE_LODS;

// Angular-size (radius / distance) thresholds, one per LOD boundary. A body
// whose apparent size is at least ANGULAR[i] uses LOD i. Distance-based rather
// than pixel-based so it stays independent of viewport size and FOV, which is
// good enough here: the camera FOV never changes.
const LOD_ANGULAR_THRESHOLDS = [0.06, 0.025, 0.012];

// Pick a LOD index (0 = finest) for a body of the given world radius, seen
// from `cameraPos`. Returns an index into SPHERE_LODS / SPHERE_LODS_WEBGL2.
export function selectSphereLod(
  center: readonly [number, number, number] | Float32Array | number[],
  radius: number,
  cameraPos: readonly [number, number, number] | Float32Array | number[],
): number {
  const dx = center[0]! - cameraPos[0]!;
  const dy = center[1]! - cameraPos[1]!;
  const dz = center[2]! - cameraPos[2]!;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const angular = radius / Math.max(dist, 1e-4);
  for (let i = 0; i < LOD_ANGULAR_THRESHOLDS.length; i++) {
    if (angular >= LOD_ANGULAR_THRESHOLDS[i]!) return i;
  }
  // Clamped so the ladder stays in bounds if either array gains a level
  // without the other.
  return Math.min(LOD_ANGULAR_THRESHOLDS.length, SPHERE_LODS.length - 1);
}

// Flat annulus in the XZ plane. uv.x = radial fraction (0 inner .. 1 outer),
// uv.y = angle fraction (0..1 around the ring). Used as the planetary ring mesh.
export function createRingGeometry(
  inner = 1.35,
  outer = 2.1,
  segments = 96,
): GeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    positions.push(c * inner, 0, s * inner);
    normals.push(0, 1, 0);
    uvs.push(0, i / segments);
    positions.push(c * outer, 0, s * outer);
    normals.push(0, 1, 0);
    uvs.push(1, i / segments);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
    vertexCount: positions.length / 3,
    indexCount: indices.length,
  };
}

// Interleave position(3) + normal(3) + uv(2) = 8 floats per vertex.
export function interleave(geo: GeometryData): Float32Array<ArrayBuffer> {
  const out = new Float32Array(geo.vertexCount * 8);
  for (let i = 0; i < geo.vertexCount; i++) {
    out[i * 8 + 0] = geo.positions[i * 3 + 0]!;
    out[i * 8 + 1] = geo.positions[i * 3 + 1]!;
    out[i * 8 + 2] = geo.positions[i * 3 + 2]!;
    out[i * 8 + 3] = geo.normals[i * 3 + 0]!;
    out[i * 8 + 4] = geo.normals[i * 3 + 1]!;
    out[i * 8 + 5] = geo.normals[i * 3 + 2]!;
    out[i * 8 + 6] = geo.uvs[i * 2 + 0]!;
    out[i * 8 + 7] = geo.uvs[i * 2 + 1]!;
  }
  return out;
}

// Convert a triangle index list into a deduplicated edge (line-list) index
// list: each triangle contributes its three edges, shared edges emitted once.
// Used to draw meshes as wireframe.
export function trianglesToLineIndices(
  indices: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
  vertexCount: number,
): Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> {
  const seen = new Set<number>();
  const out: number[] = [];
  const addEdge = (a: number, b: number) => {
    const key = Math.min(a, b) * vertexCount + Math.max(a, b);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a, b);
  };
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!;
    const b = indices[i + 1]!;
    const c = indices[i + 2]!;
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  return vertexCount > 65535 ? new Uint32Array(out) : new Uint16Array(out);
}

