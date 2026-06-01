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
