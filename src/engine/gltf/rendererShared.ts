import { mat4, type Mat4 } from '../math/mat4';
import type { Vec3 } from '../math/vec3';
import {
  GLTF_VERTEX_FLOATS,
  type GltfAsset,
  type GltfDraw,
  type GltfFrame,
  type GltfImage,
  type GltfMaterial,
  type GltfSampler,
} from './types';

// vec4-aligned layouts shared by std140 GLSL and WGSL. Keep the shader structs
// and these packing functions together when adding material/frame properties.
export const FRAME_FLOATS = 52;
export const OBJECT_FLOATS = 36;
export const MATERIAL_FLOATS = 24;
export const FRAME_BYTES = FRAME_FLOATS * 4;
export const OBJECT_BYTES = OBJECT_FLOATS * 4;
export const MATERIAL_BYTES = MATERIAL_FLOATS * 4;

export const MATERIAL_TEXTURE_SLOTS = [
  { property: 'baseColorTexture', srgb: true },
  { property: 'metallicRoughnessTexture', srgb: false },
  { property: 'normalTexture', srgb: false },
  { property: 'occlusionTexture', srgb: false },
  { property: 'emissiveTexture', srgb: true },
] as const;

const DEFAULT_SAMPLER: GltfSampler = {
  magFilter: 9729,
  minFilter: 9729,
  wrapS: 33071,
  wrapT: 33071,
};

export interface TexturePlan {
  key: string;
  // An absent source is the spec-defined white sample for an absent slot.
  source?: number;
  srgb: boolean;
  mipmapped: boolean;
}

export interface SamplerPlan {
  key: string;
  descriptor: GltfSampler;
}

export interface MaterialBinding {
  textureKey: string;
  samplerKey: string;
}

export interface PreparedMaterial {
  name: string;
  alphaMode: GltfMaterial['alphaMode'];
  doubleSided: boolean;
  uniforms: Float32Array<ArrayBuffer>;
  bindings: MaterialBinding[];
}

export interface PreparedDraw {
  index: number;
  name: string;
  primitiveIndex: number;
  materialIndex: number;
  material: PreparedMaterial;
  transform: Float32Array<ArrayBuffer>;
  source: GltfDraw;
  visible: boolean;
  center: Vec3;
  model: Float32Array<ArrayBuffer>;
  normal: Float32Array<ArrayBuffer>;
  handedness: number;
  depth: number;
}

export interface RenderPlan {
  textures: TexturePlan[];
  samplers: SamplerPlan[];
  materials: PreparedMaterial[];
  draws: PreparedDraw[];
}

export function requiredItem<T>(
  items: readonly T[],
  index: number,
  label: string,
): T {
  const item = items[index];
  if (!Number.isSafeInteger(index) || index < 0 || item === undefined) {
    throw new Error(`glTF ${label}: missing resource at index ${index}.`);
  }
  return item;
}

export function requiredResource<T>(
  resources: ReadonlyMap<string, T>,
  key: string,
  label: string,
): T {
  const resource = resources.get(key);
  if (resource === undefined) {
    throw new Error(`glTF ${label}: missing resource "${key}".`);
  }
  return resource;
}

export function usesMipmaps(sampler: GltfSampler): boolean {
  switch (sampler.minFilter) {
    case 9728:
    case 9729:
      return false;
    case 9984:
    case 9985:
    case 9986:
    case 9987:
      return true;
    default:
      throw new Error(`glTF unsupported minFilter: ${sampler.minFilter}.`);
  }
}

function addressMode(wrap: GltfSampler['wrapS']): GPUAddressMode {
  switch (wrap) {
    case 33071:
      return 'clamp-to-edge';
    case 33648:
      return 'mirror-repeat';
    case 10497:
      return 'repeat';
    default:
      throw new Error(`glTF unsupported sampler wrap: ${wrap}.`);
  }
}

export function gpuSamplerDescriptor(
  sampler: GltfSampler,
): GPUSamplerDescriptor {
  if (sampler.magFilter !== 9728 && sampler.magFilter !== 9729) {
    throw new Error(`glTF unsupported magFilter: ${sampler.magFilter}.`);
  }
  const mipmapped = usesMipmaps(sampler);
  return {
    addressModeU: addressMode(sampler.wrapS),
    addressModeV: addressMode(sampler.wrapT),
    magFilter: sampler.magFilter === 9728 ? 'nearest' : 'linear',
    minFilter:
      sampler.minFilter === 9728 ||
      sampler.minFilter === 9984 ||
      sampler.minFilter === 9986
        ? 'nearest'
        : 'linear',
    mipmapFilter:
      sampler.minFilter === 9986 || sampler.minFilter === 9987
        ? 'linear'
        : 'nearest',
    lodMinClamp: 0,
    // Without this clamp WebGPU would still select lower levels for the two
    // glTF filters that explicitly prohibit mipmapping.
    lodMaxClamp: mipmapped ? 32 : 0,
  };
}

function samplerKey(sampler: GltfSampler): string {
  return `${sampler.magFilter}/${sampler.minFilter}/${sampler.wrapS}/${sampler.wrapT}`;
}

export function materialUniforms(
  material: GltfMaterial,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(MATERIAL_FLOATS);
  out.set(material.baseColor, 0);
  out.set(material.emissive, 4);
  out[7] = material.metallic;
  out[8] = material.roughness;
  out[9] = material.normalScale;
  out[10] = material.occlusionStrength;
  out[11] = material.alphaCutoff;
  out[12] =
    material.alphaMode === 'MASK' ? 1 : material.alphaMode === 'BLEND' ? 2 : 0;
  out[13] = material.normalTexture === undefined ? 0 : 1;
  out[14] = material.doubleSided ? 1 : 0;
  for (const [slot, { property }] of MATERIAL_TEXTURE_SLOTS.entries()) {
    const info = material[property];
    if (info && info.texCoord !== 0 && info.texCoord !== 1) {
      throw new Error(
        `glTF ${material.name}: ${property} requires UV0 or UV1.`,
      );
    }
    out[16 + slot] = info?.texCoord ?? 0;
  }
  if (!out.every(Number.isFinite)) {
    throw new Error(`glTF ${material.name}: non-finite material property.`);
  }
  return out;
}

function assertMatrix(matrix: Mat4, label: string, affine = false): void {
  if (matrix.length !== 16 || !matrix.every(Number.isFinite)) {
    throw new Error(`glTF ${label} must be a finite 4x4 matrix.`);
  }
  if (
    affine &&
    (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1)
  ) {
    throw new Error(`glTF ${label} must be an affine transform.`);
  }
}

export function createRenderPlan(asset: GltfAsset): RenderPlan {
  const textures = new Map<string, TexturePlan>();
  const samplers = new Map<string, SamplerPlan>();

  const addSampler = (descriptor: GltfSampler): string => {
    gpuSamplerDescriptor(descriptor);
    const key = samplerKey(descriptor);
    if (!samplers.has(key)) {
      samplers.set(key, { key, descriptor: { ...descriptor } });
    }
    return key;
  };

  const materials = asset.materials.map((material): PreparedMaterial => {
    const bindings = MATERIAL_TEXTURE_SLOTS.map(
      ({ property, srgb }): MaterialBinding => {
        const info = material[property];
        if (info === undefined) {
          const key = 'default:white';
          textures.set(key, { key, srgb: false, mipmapped: false });
          return {
            textureKey: key,
            samplerKey: addSampler(DEFAULT_SAMPLER),
          };
        }
        const texture = requiredItem(asset.textures, info.texture, property);
        requiredItem(asset.images, texture.source, `${property} image`);
        const sampler = requiredItem(
          asset.samplers,
          texture.sampler,
          `${property} sampler`,
        );
        const key = `${texture.source}/${srgb ? 'srgb' : 'linear'}`;
        const existing = textures.get(key);
        textures.set(key, {
          key,
          source: texture.source,
          srgb,
          mipmapped: usesMipmaps(sampler) || existing?.mipmapped === true,
        });
        return {
          textureKey: key,
          samplerKey: addSampler(sampler),
        };
      },
    );
    return {
      name: material.name,
      alphaMode: material.alphaMode,
      doubleSided: material.doubleSided,
      uniforms: materialUniforms(material),
      bindings,
    };
  });

  for (const primitive of asset.primitives) {
    const vertexCount = primitive.vertices.length / GLTF_VERTEX_FLOATS;
    if (
      !Number.isInteger(vertexCount) ||
      vertexCount === 0 ||
      primitive.indices.length === 0 ||
      primitive.indices.length % 3 !== 0
    ) {
      throw new Error(`glTF ${primitive.name}: invalid triangle geometry.`);
    }
    requiredItem(materials, primitive.material, `${primitive.name} material`);
    for (const index of primitive.indices) {
      if (index >= vertexCount) {
        throw new Error(`glTF ${primitive.name}: vertex index out of bounds.`);
      }
    }
  }

  const draws = asset.draws.map((draw, index): PreparedDraw => {
    const primitive = requiredItem(
      asset.primitives,
      draw.primitive,
      `${draw.name} primitive`,
    );
    const material = requiredItem(
      materials,
      primitive.material,
      `${draw.name} material`,
    );
    assertMatrix(draw.transform, `${draw.name} transform`, true);
    const center: Vec3 = [
      (primitive.bounds.min[0] + primitive.bounds.max[0]) * 0.5,
      (primitive.bounds.min[1] + primitive.bounds.max[1]) * 0.5,
      (primitive.bounds.min[2] + primitive.bounds.max[2]) * 0.5,
    ];
    if (!center.every(Number.isFinite)) {
      throw new Error(`glTF ${primitive.name}: non-finite bounds.`);
    }
    return {
      index,
      name: draw.name,
      primitiveIndex: draw.primitive,
      materialIndex: primitive.material,
      material,
      transform: draw.transform,
      source: draw,
      visible: draw.visible !== false,
      center,
      model: new Float32Array(16),
      normal: new Float32Array(16),
      handedness: 1,
      depth: 0,
    };
  });

  return {
    textures: [...textures.values()],
    samplers: [...samplers.values()],
    materials,
    draws,
  };
}

export function updateDrawTransforms(
  draws: PreparedDraw[],
  frame: GltfFrame,
): void {
  assertMatrix(frame.view, 'frame.view', true);
  if (frame.model) assertMatrix(frame.model, 'frame.model', true);
  for (const draw of draws) {
    draw.visible = draw.source.visible !== false;
    if (!draw.visible) continue;
    draw.transform = draw.source.transform;
    assertMatrix(draw.transform, `${draw.name} transform`, true);
    const model = draw.model;
    if (frame.model) mat4.multiply(model, frame.model, draw.transform);
    else model.set(draw.transform);
    const determinant =
      model[0]! * (model[5]! * model[10]! - model[6]! * model[9]!) -
      model[4]! * (model[1]! * model[10]! - model[2]! * model[9]!) +
      model[8]! * (model[1]! * model[6]! - model[2]! * model[5]!);
    if (
      !Number.isFinite(determinant) ||
      determinant === 0 ||
      !mat4.invert(draw.normal, model)
    ) {
      throw new Error(
        `glTF ${draw.name}: singular or non-finite model matrix.`,
      );
    }
    for (let column = 0; column < 4; column++) {
      for (let row = column + 1; row < 4; row++) {
        const a = column * 4 + row;
        const b = row * 4 + column;
        const value = draw.normal[a]!;
        draw.normal[a] = draw.normal[b]!;
        draw.normal[b] = value;
      }
    }
    if (!draw.normal.every(Number.isFinite)) {
      throw new Error(`glTF ${draw.name}: normal transform overflow.`);
    }
    draw.handedness = determinant < 0 ? -1 : 1;
    const [cx, cy, cz] = draw.center;
    const x = model[0]! * cx + model[4]! * cy + model[8]! * cz + model[12]!;
    const y = model[1]! * cx + model[5]! * cy + model[9]! * cz + model[13]!;
    const z = model[2]! * cx + model[6]! * cy + model[10]! * cz + model[14]!;
    const view = frame.view;
    draw.depth = view[2]! * x + view[6]! * y + view[10]! * z + view[14]!;
  }
  draws.sort((a, b) => {
    const aBlend = a.material.alphaMode === 'BLEND';
    const bBlend = b.material.alphaMode === 'BLEND';
    if (aBlend !== bBlend) return aBlend ? 1 : -1;
    // The site's camera looks along -Z: more-negative view-space Z is farther.
    return aBlend ? a.depth - b.depth || a.index - b.index : a.index - b.index;
  });
}

export function writeObjectUniforms(
  out: Float32Array<ArrayBuffer>,
  offset: number,
  draw: PreparedDraw,
): void {
  out.set(draw.model, offset);
  out.set(draw.normal, offset + 16);
  out[offset + 32] = draw.handedness;
  out[offset + 33] = 0;
  out[offset + 34] = 0;
  out[offset + 35] = 0;
}

function writeVector(
  out: Float32Array<ArrayBuffer>,
  offset: number,
  vector: Vec3,
  label: string,
): void {
  if (!vector.every(Number.isFinite)) {
    throw new Error(`glTF ${label} must be finite.`);
  }
  out.set(vector, offset);
}

function writeDirection(
  out: Float32Array<ArrayBuffer>,
  offset: number,
  direction: Vec3,
): void {
  writeVector(out, offset, direction, 'light direction');
  const length = Math.hypot(...direction) || 1;
  out[offset] = direction[0] / length;
  out[offset + 1] = direction[1] / length;
  out[offset + 2] = direction[2] / length;
}

export function writeFrameUniforms(
  out: Float32Array<ArrayBuffer>,
  frame: GltfFrame,
  targetIsSrgb: boolean,
): void {
  assertMatrix(frame.viewProjection, 'frame.viewProjection');
  const exposure = frame.exposure ?? 1;
  if (!Number.isFinite(exposure) || exposure < 0) {
    throw new Error('glTF exposure must be finite and nonnegative.');
  }
  const mapped = frame.output === 'srgb' || frame.output === 'tonemapped';
  if (!mapped && targetIsSrgb) {
    throw new Error(
      'glTF linear output requires a linear render target, not an sRGB attachment.',
    );
  }
  out.fill(0);
  out.set(frame.viewProjection, 0);
  writeVector(out, 16, frame.cameraPosition, 'camera position');
  out[19] = exposure;
  writeDirection(out, 20, frame.keyLight.direction);
  writeVector(out, 24, frame.keyLight.color, 'key light color');
  writeDirection(out, 28, frame.fillLight.direction);
  writeVector(out, 32, frame.fillLight.color, 'fill light color');
  writeVector(out, 36, frame.ambientSky, 'ambient sky');
  writeVector(out, 40, frame.ambientGround, 'ambient ground');
  out[44] = mapped ? 1 : 0;
  out[45] = targetIsSrgb || frame.output === 'tonemapped' ? 1 : 0;
  out[46] = frame.wireframe ? 1 : 0;
  if (frame.fog) {
    if (!Number.isFinite(frame.fog.density) || frame.fog.density < 0) {
      throw new Error('glTF fog density must be finite and nonnegative.');
    }
    writeVector(out, 48, frame.fog.color, 'fog color');
    out[51] = frame.fog.density;
  }
}

export function mipLevelCount(
  width: number,
  height: number,
  mipmapped: boolean,
): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error('glTF texture dimensions must be positive integers.');
  }
  return mipmapped ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
}

export function textureByteLength(
  width: number,
  height: number,
  levels: number,
): number {
  let bytes = 0;
  for (let level = 0; level < levels; level++) {
    bytes += width * height * 4;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
  return bytes;
}

export function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

export function closeImages(images: ReadonlyMap<number, ImageBitmap>): void {
  for (const image of images.values()) image.close();
}

export async function decodeImages(
  images: readonly GltfImage[],
  textures: readonly TexturePlan[],
  maxDimension: number,
): Promise<Map<number, ImageBitmap>> {
  const decoded = new Map<number, ImageBitmap>();
  try {
    for (const texture of textures) {
      if (texture.source === undefined || decoded.has(texture.source)) continue;
      const image = requiredItem(images, texture.source, 'image');
      try {
        if (typeof createImageBitmap !== 'function') {
          throw new Error('createImageBitmap is unavailable in this browser.');
        }
        const bitmap = await createImageBitmap(
          new Blob([image.bytes], { type: image.mimeType }),
          {
            imageOrientation: 'none',
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none',
          },
        );
        decoded.set(texture.source, bitmap);
        if (
          bitmap.width <= 0 ||
          bitmap.height <= 0 ||
          bitmap.width > maxDimension ||
          bitmap.height > maxDimension
        ) {
          throw new Error(
            `dimensions ${bitmap.width}x${bitmap.height} exceed the GPU limit ${maxDimension}.`,
          );
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `Failed to decode glTF image "${image.name}" (${texture.source}): ${message}`,
          { cause },
        );
      }
    }
    return decoded;
  } catch (error) {
    closeImages(decoded);
    throw error;
  }
}
