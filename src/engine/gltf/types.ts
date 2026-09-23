import type { Mat4 } from '../math/mat4';
import type { Vec3 } from '../math/vec3';

export interface GltfBounds {
  min: Vec3;
  max: Vec3;
}

export const GLTF_VERTEX_FLOATS = 18;
export const GLTF_VERTEX_BYTES = GLTF_VERTEX_FLOATS * 4;

export interface GltfPrimitive {
  name: string;
  // position(3), normal(3), tangent(4), uv0(2), uv1(2), color(4).
  vertices: Float32Array<ArrayBuffer>;
  indices: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
  material: number;
  bounds: GltfBounds;
}

export interface GltfTextureInfo {
  texture: number;
  texCoord: 0 | 1;
}

export interface GltfMaterial {
  name: string;
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  emissive: Vec3;
  normalScale: number;
  occlusionStrength: number;
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff: number;
  doubleSided: boolean;
  baseColorTexture?: GltfTextureInfo;
  metallicRoughnessTexture?: GltfTextureInfo;
  normalTexture?: GltfTextureInfo;
  occlusionTexture?: GltfTextureInfo;
  emissiveTexture?: GltfTextureInfo;
}

export interface GltfSampler {
  magFilter: 9728 | 9729;
  minFilter: 9728 | 9729 | 9984 | 9985 | 9986 | 9987;
  wrapS: 33071 | 33648 | 10497;
  wrapT: 33071 | 33648 | 10497;
}

export interface GltfImage {
  name: string;
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array<ArrayBuffer>;
}

export interface GltfTexture {
  source: number;
  sampler: number;
}

export interface GltfDraw {
  name: string;
  primitive: number;
  transform: Float32Array<ArrayBuffer>;
  visible?: boolean;
}

export interface GltfAsset {
  primitives: GltfPrimitive[];
  materials: GltfMaterial[];
  images: GltfImage[];
  textures: GltfTexture[];
  samplers: GltfSampler[];
  draws: GltfDraw[];
  bounds: GltfBounds;
  extras: unknown;
  warnings: string[];
  stats: {
    triangles: number;
    vertices: number;
    drawCalls: number;
    fileBytes: number;
  };
}

export interface GltfLight {
  // World-space direction from the shaded surface toward the light.
  direction: Vec3;
  color: Vec3;
}

export interface GltfFrame {
  // Both adapters accept the site's [0, 1] clip-depth projection convention.
  viewProjection: Mat4;
  view: Mat4;
  cameraPosition: Vec3;
  model?: Mat4;
  keyLight: GltfLight;
  fillLight: GltfLight;
  ambientSky: Vec3;
  ambientGround: Vec3;
  fog?: { color: Vec3; density: number };
  exposure?: number;
  // tonemapped leaves gamma encoding to an LDR host composite.
  output?: 'linear' | 'tonemapped' | 'srgb';
  wireframe?: boolean;
}

export interface GltfRenderStats {
  drawCalls: number;
  triangles: number;
  lines: number;
  geometryBytes: number;
  textureBytes: number;
}
