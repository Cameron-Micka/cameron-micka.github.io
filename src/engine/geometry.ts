export interface GeometryData {
  positions: Float32Array<ArrayBuffer>; // xyz
  normals: Float32Array<ArrayBuffer>; // xyz
  uvs: Float32Array<ArrayBuffer>; // uv
  indices: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
  vertexCount: number;
  indexCount: number;
}

// UV sphere. Normals equal positions (unit sphere), used as the base mesh for
// every procedural planet; the shader displaces/colors it from noise.
export function createSphere(
  latBands = 48,
  lonBands = 64,
): GeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat * Math.PI) / latBands;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let lon = 0; lon <= lonBands; lon++) {
      const phi = (lon * 2 * Math.PI) / lonBands;
      const x = Math.cos(phi) * sinT;
      const y = cosT;
      const z = Math.sin(phi) * sinT;
      positions.push(x, y, z);
      normals.push(x, y, z);
      uvs.push(lon / lonBands, lat / latBands);
    }
  }

  const stride = lonBands + 1;
  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const a = lat * stride + lon;
      const b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const vertexCount = positions.length / 3;
  const indexArray =
    vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
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
export type SphereLod = readonly [latBands: number, lonBands: number];

export const SPHERE_LODS: readonly SphereLod[] = [
  [48, 64],
  [32, 40],
  [20, 26],
  [12, 16],
];

// WebGL2 runs a slightly cheaper base tessellation than WebGPU (it targets
// weaker hardware), so it has its own ladder with the same number of levels.
export const SPHERE_LODS_WEBGL2: readonly SphereLod[] = [
  [40, 56],
  [28, 36],
  [18, 24],
  [12, 16],
];

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
  return LOD_ANGULAR_THRESHOLDS.length;
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


