import { mat4 } from '../math/mat4';
import { computeBounds, computeNormals, computeTangents } from './mesh.mjs';
import {
  GLTF_VERTEX_FLOATS,
  type GltfAsset,
  type GltfBounds,
  type GltfDraw,
  type GltfImage,
  type GltfMaterial,
  type GltfPrimitive,
  type GltfSampler,
  type GltfTextureInfo,
} from './types';

type ObjectValue = Record<string, unknown>;
type Bytes = Uint8Array<ArrayBuffer>;

export interface GlbParseOptions {
  scene?: number;
  // URI -> bytes for external buffers/images. Data URIs need no resolver.
  resources?: ReadonlyMap<string, Bytes>;
}

export interface GlbLoadOptions {
  scene?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

const MAX_BYTES = 256 * 1024 * 1024;
const MAX_ELEMENTS = 16 * 1024 * 1024;
const COMPONENT_BYTES: Readonly<Record<number, number>> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};
const TYPE_SIZE: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
};

function fail(message: string): never {
  throw new Error(`GLB: ${message}`);
}

function isObject(value: unknown): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function object(value: unknown, label: string): ObjectValue {
  if (!isObject(value)) fail(`${label} must be an object.`);
  return value;
}

function list(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  return value;
}

function number(value: unknown, label: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${label} must be a finite number.`);
  }
  return value;
}

function integer(value: unknown, label: string, fallback?: number): number {
  const result = number(value, label, fallback);
  if (!Number.isSafeInteger(result) || result < 0) {
    fail(`${label} must be a nonnegative safe integer.`);
  }
  return result;
}

function boolean(value: unknown, label: string, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(`${label} must be a boolean.`);
  return value;
}

function text(value: unknown, label: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') fail(`${label} must be a string.`);
  return value;
}

function choice<T extends number | string>(
  value: unknown,
  values: readonly T[],
  label: string,
  fallback?: T,
): T {
  if (value === undefined && fallback !== undefined) return fallback;
  const selected = values.find((candidate) => candidate === value);
  if (selected === undefined)
    fail(`${label}: unsupported value ${String(value)}.`);
  return selected;
}

function vector(value: unknown, fallback: number[], label: string): number[] {
  if (value === undefined) return [...fallback];
  const array = list(value, label);
  if (array.length !== fallback.length) fail(`${label} has the wrong length.`);
  return array.map((component) => number(component, label));
}

function unit(value: unknown, label: string, fallback: number): number {
  const result = number(value, label, fallback);
  if (result < 0 || result > 1) fail(`${label} must be between 0 and 1.`);
  return result;
}

function index<T>(values: readonly T[], value: unknown, label: string): T {
  const result = values[integer(value, label)];
  if (result === undefined) fail(`${label} references an out-of-range index.`);
  return result;
}

function range(
  offset: number,
  length: number,
  total: number,
  label: string,
): void {
  if (!Number.isSafeInteger(offset + length) || offset + length > total) {
    fail(`${label} exceeds its buffer bounds.`);
  }
}

function container(input: ArrayBuffer | Bytes) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 20 || bytes.byteLength > MAX_BYTES) {
    fail('file length must be between 20 bytes and 256 MiB.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) fail('invalid GLB magic.');
  if (view.getUint32(4, true) !== 2) fail('only GLB 2.0 is supported.');
  if (view.getUint32(8, true) !== bytes.byteLength)
    fail('header length does not match the file.');
  let json: ObjectValue | undefined;
  let binary: Bytes | undefined;
  const warnings: string[] = [];
  for (let offset = 12; offset < bytes.byteLength; ) {
    range(offset, 8, bytes.byteLength, 'chunk header');
    const length = view.getUint32(offset, true);
    const kind = view.getUint32(offset + 4, true);
    if (length % 4 !== 0) fail('chunk length must be aligned to four bytes.');
    range(offset + 8, length, bytes.byteLength, 'chunk');
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (offset === 12 && kind !== 0x4e4f534a)
      fail('the first chunk must be JSON.');
    if (kind === 0x4e4f534a) {
      if (json) fail('duplicate JSON chunk.');
      json = object(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(chunk)),
        'document',
      );
    } else if (kind === 0x004e4942) {
      if (binary) fail('duplicate BIN chunk.');
      binary = chunk;
    } else {
      warnings.push(`Ignored unknown GLB chunk type 0x${kind.toString(16)}.`);
    }
    offset += length + 8;
  }
  if (!json) fail('missing JSON chunk.');
  return { json, binary, byteLength: bytes.byteLength, warnings };
}

function dataUri(uri: string): Bytes {
  const match = /^data:([^,]*),(.*)$/s.exec(uri);
  if (!match) fail('invalid data URI.');
  const header = match[1]!;
  const payload = match[2]!;
  if (header.endsWith(';base64')) {
    const decoded = atob(payload);
    if (decoded.length > MAX_BYTES) fail('data URI exceeds 256 MiB.');
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  }
  const output: number[] = [];
  for (let offset = 0; offset < payload.length; offset++) {
    const character = payload[offset]!;
    if (character === '%') {
      const hex = payload.slice(offset + 1, offset + 3);
      if (!/^[0-9a-f]{2}$/i.test(hex))
        fail('invalid percent encoding in data URI.');
      output.push(Number.parseInt(hex, 16));
      offset += 2;
    } else {
      const byte = character.charCodeAt(0);
      if (byte > 127) fail('non-ASCII data URI bytes must be percent encoded.');
      output.push(byte);
    }
  }
  if (output.length > MAX_BYTES) fail('data URI exceeds 256 MiB.');
  return new Uint8Array(output);
}

interface BufferSlice {
  bytes: Bytes;
  bufferOffset: number;
  stride?: number;
}

interface Accessor {
  values: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
  count: number;
  size: number;
  type: string;
  component: number;
  normalized: boolean;
}

function readComponent(
  view: DataView,
  offset: number,
  component: number,
): number {
  switch (component) {
    case 5120:
      return view.getInt8(offset);
    case 5121:
      return view.getUint8(offset);
    case 5122:
      return view.getInt16(offset, true);
    case 5123:
      return view.getUint16(offset, true);
    case 5125:
      return view.getUint32(offset, true);
    case 5126:
      return view.getFloat32(offset, true);
    default:
      return fail(`unsupported accessor componentType ${component}.`);
  }
}

function normalizedValue(value: number, component: number): number {
  switch (component) {
    case 5120:
      return Math.max(-1, value / 127);
    case 5121:
      return value / 255;
    case 5122:
      return Math.max(-1, value / 32767);
    case 5123:
      return value / 65535;
    default:
      return fail('only 8-bit and 16-bit integer accessors can be normalized.');
  }
}

function getAccessors(source: ObjectValue, buffers: Bytes[]) {
  const views = list(source.bufferViews, 'bufferViews').map(
    (entry, id): BufferSlice => {
      const item = object(entry, `bufferViews[${id}]`);
      const buffer = index(buffers, item.buffer, `bufferViews[${id}].buffer`);
      const offset = integer(item.byteOffset, 'bufferView.byteOffset', 0);
      const length = integer(item.byteLength, 'bufferView.byteLength');
      range(offset, length, buffer.byteLength, 'bufferView');
      const stride =
        item.byteStride === undefined
          ? undefined
          : integer(item.byteStride, 'byteStride');
      if (
        stride !== undefined &&
        (stride < 4 || stride > 252 || stride % 4 !== 0)
      ) {
        fail(
          'bufferView.byteStride must be a multiple of four between 4 and 252.',
        );
      }
      return {
        bytes: buffer.subarray(offset, offset + length),
        bufferOffset: offset,
        stride,
      };
    },
  );
  const descriptions = list(source.accessors, 'accessors');
  const cache = new Map<number, Accessor>();
  function accessor(id: unknown): Accessor {
    const key = integer(id, 'accessor index');
    const cached = cache.get(key);
    if (cached) return cached;
    const item = object(
      index(descriptions, key, 'accessor'),
      `accessors[${key}]`,
    );
    const component = integer(item.componentType, 'accessor.componentType');
    const bytesPerComponent = COMPONENT_BYTES[component];
    if (!bytesPerComponent) fail(`unsupported componentType ${component}.`);
    const type = text(item.type, 'accessor.type');
    const size = TYPE_SIZE[type];
    if (!size) fail(`accessor type ${type} is not a static mesh attribute.`);
    const count = integer(item.count, 'accessor.count');
    if (count === 0 || count * size > MAX_ELEMENTS)
      fail('accessor count is empty or too large.');
    const normalized = boolean(item.normalized, 'accessor.normalized');
    if (normalized && ![5120, 5121, 5122, 5123].includes(component)) {
      fail('invalid normalized accessor component type.');
    }
    const values =
      type === 'SCALAR' && !normalized && component !== 5126
        ? new Uint32Array(count)
        : new Float32Array(count * size);

    function read(
      slice: BufferSlice,
      offset: number,
      elements: number,
      store: (item: number, channel: number, value: number) => void,
    ) {
      const packed = bytesPerComponent! * size!;
      const stride = slice.stride ?? packed;
      if (
        stride < packed ||
        stride % bytesPerComponent! !== 0 ||
        offset % bytesPerComponent! !== 0 ||
        slice.bufferOffset % bytesPerComponent! !== 0
      ) {
        fail('misaligned accessor or invalid accessor stride.');
      }
      range(
        offset,
        (elements - 1) * stride + packed,
        slice.bytes.byteLength,
        'accessor',
      );
      const view = new DataView(
        slice.bytes.buffer,
        slice.bytes.byteOffset,
        slice.bytes.byteLength,
      );
      for (let element = 0; element < elements; element++) {
        for (let channel = 0; channel < size!; channel++) {
          const raw = readComponent(
            view,
            offset + element * stride + channel * bytesPerComponent!,
            component,
          );
          if (!Number.isFinite(raw))
            fail('accessor contains a non-finite value.');
          store(
            element,
            channel,
            normalized ? normalizedValue(raw, component) : raw,
          );
        }
      }
    }

    if (item.bufferView !== undefined) {
      read(
        index(views, item.bufferView, 'accessor.bufferView'),
        integer(item.byteOffset, 'accessor.byteOffset', 0),
        count,
        (element, channel, value) => {
          values[element * size + channel] = value;
        },
      );
    } else if (item.byteOffset !== undefined && item.byteOffset !== 0) {
      fail('an accessor without a bufferView cannot have a byteOffset.');
    }
    if (item.sparse !== undefined) {
      const sparse = object(item.sparse, 'accessor.sparse');
      const sparseCount = integer(sparse.count, 'sparse.count');
      if (sparseCount < 1 || sparseCount > count)
        fail('invalid sparse accessor count.');
      const indices = object(sparse.indices, 'sparse.indices');
      const sparseValues = object(sparse.values, 'sparse.values');
      const indexType = choice(
        indices.componentType,
        [5121, 5123, 5125],
        'sparse index componentType',
      );
      const indexBytes = COMPONENT_BYTES[indexType]!;
      const indicesView = index(
        views,
        indices.bufferView,
        'sparse.indices.bufferView',
      );
      const valueView = index(
        views,
        sparseValues.bufferView,
        'sparse.values.bufferView',
      );
      if (indicesView.stride || valueView.stride)
        fail('sparse bufferViews cannot have byteStride.');
      const indexOffset = integer(
        indices.byteOffset,
        'sparse.indices.byteOffset',
        0,
      );
      if ((indicesView.bufferOffset + indexOffset) % indexBytes !== 0)
        fail('misaligned sparse indices.');
      range(
        indexOffset,
        sparseCount * indexBytes,
        indicesView.bytes.byteLength,
        'sparse indices',
      );
      const indexData = new DataView(
        indicesView.bytes.buffer,
        indicesView.bytes.byteOffset,
        indicesView.bytes.byteLength,
      );
      const replacements: number[] = [];
      for (let i = 0; i < sparseCount; i++) {
        const replacement = readComponent(
          indexData,
          indexOffset + i * indexBytes,
          indexType,
        );
        if (
          replacement >= count ||
          replacement <= (replacements[i - 1] ?? -1)
        ) {
          fail('sparse indices must be in range and strictly increasing.');
        }
        replacements.push(replacement);
      }
      read(
        valueView,
        integer(sparseValues.byteOffset, 'sparse.values.byteOffset', 0),
        sparseCount,
        (element, channel, value) => {
          values[replacements[element]! * size + channel] = value;
        },
      );
    }
    const result = { values, count, size, type, component, normalized };
    cache.set(key, result);
    return result;
  }
  return { views, accessor };
}

function defaultMaterial(): GltfMaterial {
  return {
    name: 'Default glTF material',
    baseColor: [1, 1, 1, 1],
    metallic: 1,
    roughness: 1,
    emissive: [0, 0, 0],
    normalScale: 1,
    occlusionStrength: 1,
    alphaMode: 'OPAQUE',
    alphaCutoff: 0.5,
    doubleSided: false,
  };
}

function material(
  entry: unknown,
  id: number,
  textureCount: number,
): GltfMaterial {
  const item = object(entry, `materials[${id}]`);
  const pbr =
    item.pbrMetallicRoughness === undefined
      ? {}
      : object(item.pbrMetallicRoughness, 'pbrMetallicRoughness');
  const output = defaultMaterial();
  output.name = text(item.name, 'material.name', `Material ${id}`);
  const base = vector(pbr.baseColorFactor, [1, 1, 1, 1], 'baseColorFactor');
  base.forEach((component) => unit(component, 'baseColorFactor', 1));
  output.baseColor = [base[0]!, base[1]!, base[2]!, base[3]!];
  const emissive = vector(item.emissiveFactor, [0, 0, 0], 'emissiveFactor');
  emissive.forEach((component) => unit(component, 'emissiveFactor', 0));
  output.emissive = [emissive[0]!, emissive[1]!, emissive[2]!];
  output.metallic = unit(pbr.metallicFactor, 'metallicFactor', 1);
  output.roughness = unit(pbr.roughnessFactor, 'roughnessFactor', 1);
  output.alphaMode = choice(
    item.alphaMode,
    ['OPAQUE', 'MASK', 'BLEND'],
    'alphaMode',
    'OPAQUE',
  );
  output.alphaCutoff = number(item.alphaCutoff, 'alphaCutoff', 0.5);
  if (output.alphaCutoff < 0) fail('alphaCutoff must not be negative.');
  output.doubleSided = boolean(item.doubleSided, 'doubleSided');
  const info = (value: unknown, label: string): GltfTextureInfo | undefined => {
    if (value === undefined) return undefined;
    const description = object(value, label);
    const texture = integer(description.index, `${label}.index`);
    if (texture >= textureCount) fail(`${label} references a missing texture.`);
    const texCoord = choice(
      description.texCoord,
      [0, 1],
      `${label}.texCoord (UV0/UV1 supported)`,
      0,
    );
    return { texture, texCoord };
  };
  output.baseColorTexture = info(pbr.baseColorTexture, 'baseColorTexture');
  output.metallicRoughnessTexture = info(
    pbr.metallicRoughnessTexture,
    'metallicRoughnessTexture',
  );
  output.normalTexture = info(item.normalTexture, 'normalTexture');
  output.occlusionTexture = info(item.occlusionTexture, 'occlusionTexture');
  output.emissiveTexture = info(item.emissiveTexture, 'emissiveTexture');
  if (item.normalTexture !== undefined) {
    output.normalScale = number(
      object(item.normalTexture, 'normalTexture').scale,
      'normalTexture.scale',
      1,
    );
  }
  if (item.occlusionTexture !== undefined) {
    output.occlusionStrength = unit(
      object(item.occlusionTexture, 'occlusionTexture').strength,
      'occlusionTexture.strength',
      1,
    );
  }
  return output;
}

function nodeMatrix(node: ObjectValue): Float32Array<ArrayBuffer> {
  const result = mat4.create();
  if (node.matrix !== undefined) {
    if (
      node.translation !== undefined ||
      node.rotation !== undefined ||
      node.scale !== undefined
    ) {
      fail('node.matrix cannot be combined with TRS properties.');
    }
    const matrix = vector(node.matrix, Array.from(result), 'node.matrix');
    if (
      matrix[3] !== 0 ||
      matrix[7] !== 0 ||
      matrix[11] !== 0 ||
      matrix[15] !== 1
    ) {
      fail('node.matrix must be affine.');
    }
    result.set(matrix);
  } else {
    const t = vector(node.translation, [0, 0, 0], 'node.translation');
    const r = vector(node.rotation, [0, 0, 0, 1], 'node.rotation');
    const s = vector(node.scale, [1, 1, 1], 'node.scale');
    if (Math.abs(Math.hypot(...r) - 1) > 1e-4)
      fail('node.rotation must be a unit quaternion.');
    mat4.fromRotationTranslationScale(
      result,
      [r[0]!, r[1]!, r[2]!, r[3]!],
      [t[0]!, t[1]!, t[2]!],
      1,
    );
    for (let axis = 0; axis < 3; axis++) {
      for (let row = 0; row < 3; row++) result[axis * 4 + row]! *= s[axis]!;
    }
  }
  if (!result.every(Number.isFinite))
    fail('node transform exceeds float32 range.');
  if (!mat4.invert(mat4.create(), result))
    fail('singular node transforms are not supported.');
  return new Float32Array(result);
}

function addBounds(
  target: GltfBounds,
  bounds: GltfBounds,
  transform: Float32Array,
): void {
  for (let corner = 0; corner < 8; corner++) {
    const x = corner & 1 ? bounds.max[0] : bounds.min[0];
    const y = corner & 2 ? bounds.max[1] : bounds.min[1];
    const z = corner & 4 ? bounds.max[2] : bounds.min[2];
    for (let axis = 0; axis < 3; axis++) {
      const value =
        transform[axis]! * x +
        transform[4 + axis]! * y +
        transform[8 + axis]! * z +
        transform[12 + axis]!;
      target.min[axis] = Math.min(target.min[axis]!, value);
      target.max[axis] = Math.max(target.max[axis]!, value);
    }
  }
}

export function parseGlb(
  input: ArrayBuffer | Bytes,
  options: GlbParseOptions = {},
): GltfAsset {
  const { json: source, binary, byteLength, warnings } = container(input);
  const asset = object(source.asset, 'asset');
  if (
    asset.version !== '2.0' ||
    (asset.minVersion !== undefined && asset.minVersion !== '2.0')
  ) {
    fail('only glTF 2.0 is supported.');
  }
  const required = list(source.extensionsRequired, 'extensionsRequired');
  if (required.length)
    fail(
      `required extensions are not supported: ${required.map((entry) => text(entry, 'extension')).join(', ')}.`,
    );
  for (const extension of list(source.extensionsUsed, 'extensionsUsed')) {
    warnings.push(
      `Ignored optional extension ${text(extension, 'extension')}; using its core glTF fallback.`,
    );
  }
  if (
    list(source.animations, 'animations').length ||
    list(source.skins, 'skins').length
  ) {
    fail(
      'animations and skinning are not supported by the static-mesh renderer.',
    );
  }
  const resolve = (uri: string): Bytes => {
    if (uri.startsWith('data:')) return dataUri(uri);
    const bytes = options.resources?.get(uri);
    if (!bytes)
      fail(
        `external resource "${uri}" was not supplied; use loadGlb() or provide resources.`,
      );
    if (bytes.byteLength > MAX_BYTES)
      fail(`external resource "${uri}" exceeds 256 MiB.`);
    return bytes;
  };
  const buffers = list(source.buffers, 'buffers').map((entry, id) => {
    const item = object(entry, `buffers[${id}]`);
    const length = integer(item.byteLength, 'buffer.byteLength');
    const bytes =
      item.uri === undefined
        ? id === 0
          ? binary
          : undefined
        : resolve(text(item.uri, 'buffer.uri'));
    if (!bytes)
      fail('only buffer 0 can refer to the GLB BIN chunk, and it must exist.');
    range(0, length, bytes.byteLength, 'buffer');
    if (item.uri === undefined && bytes.byteLength - length > 3)
      fail('BIN padding exceeds three bytes.');
    return bytes.subarray(0, length);
  });
  const { views, accessor } = getAccessors(source, buffers);
  const images = list(source.images, 'images').map((entry, id): GltfImage => {
    const item = object(entry, `images[${id}]`);
    if ((item.uri === undefined) === (item.bufferView === undefined)) {
      fail('image must specify exactly one of uri or bufferView.');
    }
    const bytes =
      item.uri !== undefined
        ? resolve(text(item.uri, 'image.uri'))
        : index(views, item.bufferView, 'image.bufferView').bytes;
    const png =
      bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
    const jpeg =
      bytes.length >= 3 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255;
    if (!png && !jpeg) fail('only PNG and JPEG images are supported.');
    const mimeType = png ? 'image/png' : 'image/jpeg';
    if (item.mimeType !== undefined && item.mimeType !== mimeType)
      fail('image MIME type does not match its bytes.');
    if (item.bufferView !== undefined && item.mimeType === undefined)
      fail('bufferView images require a MIME type.');
    return {
      name: text(item.name, 'image.name', `Image ${id}`),
      bytes: bytes.slice(),
      mimeType,
    };
  });
  const defaultSampler: GltfSampler = {
    magFilter: 9729,
    minFilter: 9987,
    wrapS: 10497,
    wrapT: 10497,
  };
  const samplers = list(source.samplers, 'samplers').map(
    (entry): GltfSampler => {
      const item = object(entry, 'sampler');
      return {
        magFilter: choice(item.magFilter, [9728, 9729], 'magFilter', 9729),
        minFilter: choice(
          item.minFilter,
          [9728, 9729, 9984, 9985, 9986, 9987],
          'minFilter',
          9987,
        ),
        wrapS: choice(item.wrapS, [33071, 33648, 10497], 'wrapS', 10497),
        wrapT: choice(item.wrapT, [33071, 33648, 10497], 'wrapT', 10497),
      };
    },
  );
  const defaultSamplerId = samplers.push(defaultSampler) - 1;
  const textures = list(source.textures, 'textures').map((entry) => {
    const item = object(entry, 'texture');
    const imageId = integer(item.source, 'texture.source');
    index(images, imageId, 'texture.source');
    const sampler =
      item.sampler === undefined
        ? defaultSamplerId
        : integer(item.sampler, 'texture.sampler');
    if (item.sampler !== undefined && sampler >= defaultSamplerId)
      fail('texture.sampler references a missing sampler.');
    index(samplers, sampler, 'texture.sampler');
    return { source: imageId, sampler };
  });
  const materials = list(source.materials, 'materials').map((entry, id) =>
    material(entry, id, textures.length),
  );
  const defaultMaterialId = materials.push(defaultMaterial()) - 1;
  const primitives: GltfPrimitive[] = [];
  const meshes = list(source.meshes, 'meshes').map((entry, meshId) => {
    const mesh = object(entry, `meshes[${meshId}]`);
    if (mesh.weights !== undefined) fail('morph targets are not supported.');
    const meshName = text(mesh.name, 'mesh.name', `Mesh ${meshId}`);
    const items = list(mesh.primitives, 'mesh.primitives');
    if (!items.length) fail('mesh has no primitives.');
    return items.map((entry, primitiveId) => {
      const item = object(entry, 'primitive');
      if (item.targets !== undefined) fail('morph targets are not supported.');
      const mode = choice(
        item.mode,
        [4, 5, 6],
        'primitive mode (only triangles, strips and fans supported)',
        4,
      );
      const attributes = object(item.attributes, 'primitive.attributes');
      if (
        Object.keys(attributes).some(
          (key) => key.startsWith('JOINTS_') || key.startsWith('WEIGHTS_'),
        )
      ) {
        fail('skinned vertex attributes are not supported.');
      }
      const p = accessor(attributes.POSITION);
      if (p.type !== 'VEC3' || p.component !== 5126 || p.normalized)
        fail('POSITION must be a float VEC3.');
      const selectedMaterial =
        item.material === undefined
          ? defaultMaterialId
          : integer(item.material, 'primitive.material');
      if (item.material !== undefined && selectedMaterial >= defaultMaterialId)
        fail('primitive.material references a missing material.');
      const material = index(materials, selectedMaterial, 'primitive.material');
      const vertexCount = p.count;
      const attribute = (
        name: string,
        sizes: number[],
        colorOrUV = false,
      ): Float32Array<ArrayBuffer> | undefined => {
        if (attributes[name] === undefined) return undefined;
        const a = accessor(attributes[name]);
        if (a.count !== vertexCount || !sizes.includes(a.size))
          fail(`${name} has an invalid shape or vertex count.`);
        if (
          a.component !== 5126 &&
          !(colorOrUV && [5121, 5123].includes(a.component) && a.normalized)
        ) {
          fail(`${name} has an unsupported component type or normalization.`);
        }
        return new Float32Array(a.values);
      };
      let positions = new Float32Array(p.values);
      let normals = attribute('NORMAL', [3]);
      let tangents = attribute('TANGENT', [4]);
      let uv0 = attribute('TEXCOORD_0', [2], true);
      let uv1 = attribute('TEXCOORD_1', [2], true);
      let color = attribute('COLOR_0', [3, 4], true);
      for (const slot of [
        material.baseColorTexture,
        material.metallicRoughnessTexture,
        material.normalTexture,
        material.occlusionTexture,
        material.emissiveTexture,
      ]) {
        if (slot && !(slot.texCoord === 0 ? uv0 : uv1))
          fail(`material requires missing TEXCOORD_${slot.texCoord}.`);
      }
      let rawIndices: Uint32Array<ArrayBuffer>;
      if (item.indices !== undefined) {
        const a = accessor(item.indices);
        if (
          a.type !== 'SCALAR' ||
          ![5121, 5123, 5125].includes(a.component) ||
          a.normalized
        ) {
          fail('indices must be unnormalized unsigned SCALAR values.');
        }
        const restart = 2 ** (COMPONENT_BYTES[a.component]! * 8) - 1;
        rawIndices = new Uint32Array(a.values);
        if (
          rawIndices.some((value) => value >= vertexCount || value === restart)
        )
          fail(
            'primitive index is out of range or a forbidden primitive-restart value.',
          );
      } else {
        rawIndices = Uint32Array.from({ length: vertexCount }, (_, i) => i);
      }
      if (mode === 4) {
        if (rawIndices.length % 3 !== 0)
          fail('triangle index count must be divisible by three.');
      } else {
        const triangles: number[] = [];
        for (let i = 2; i < rawIndices.length; i++) {
          const a = mode === 6 ? rawIndices[0]! : rawIndices[i - 2]!;
          const b = rawIndices[i - 1]!;
          const c = rawIndices[i]!;
          if (a === b || b === c || c === a) continue;
          if (mode === 5 && i % 2 !== 0) triangles.push(b, a, c);
          else triangles.push(a, b, c);
        }
        rawIndices = new Uint32Array(triangles);
      }
      if (!rawIndices.length) fail('primitive has no drawable triangles.');
      if (!normals) {
        // glTF requires flat face normals when NORMAL is absent.
        const expand = (
          values: Float32Array<ArrayBuffer> | undefined,
          size: number,
        ) => {
          if (!values) return undefined;
          if (rawIndices.length * size > MAX_ELEMENTS)
            fail('expanded geometry is too large.');
          const expanded = new Float32Array(rawIndices.length * size);
          for (let i = 0; i < rawIndices.length; i++) {
            expanded.set(
              values.subarray(
                rawIndices[i]! * size,
                (rawIndices[i]! + 1) * size,
              ),
              i * size,
            );
          }
          return expanded;
        };
        positions = expand(positions, 3)!;
        uv0 = expand(uv0, 2);
        uv1 = expand(uv1, 2);
        color = expand(color, color ? color.length / vertexCount : 4);
        tangents = undefined;
        rawIndices = Uint32Array.from(
          { length: rawIndices.length },
          (_, i) => i,
        );
        normals = computeNormals(positions, rawIndices);
      }
      const count = positions.length / 3;
      if (count * GLTF_VERTEX_FLOATS > MAX_ELEMENTS)
        fail('interleaved geometry exceeds the vertex budget.');
      for (let i = 0; i < normals.length; i += 3) {
        const length = Math.hypot(
          normals[i]!,
          normals[i + 1]!,
          normals[i + 2]!,
        );
        if (length < 1e-8) fail('NORMAL contains a zero vector.');
        normals[i]! /= length;
        normals[i + 1]! /= length;
        normals[i + 2]! /= length;
      }
      uv0 ??= new Float32Array(count * 2);
      uv1 ??= new Float32Array(count * 2);
      tangents ??= computeTangents(
        positions,
        normals,
        material.normalTexture?.texCoord === 1 ? uv1 : uv0,
        rawIndices,
      );
      for (let i = 0; i < tangents.length; i += 4) {
        if (
          Math.abs(tangents[i + 3]!) !== 1 ||
          Math.hypot(tangents[i]!, tangents[i + 1]!, tangents[i + 2]!) < 1e-8
        ) {
          fail('TANGENT must have a nonzero direction and w = +1 or -1.');
        }
      }
      const vertices = new Float32Array(count * GLTF_VERTEX_FLOATS);
      const colorSize = color ? color.length / count : 4;
      for (let i = 0; i < count; i++) {
        const offset = i * GLTF_VERTEX_FLOATS;
        vertices.set(positions.subarray(i * 3, i * 3 + 3), offset);
        vertices.set(normals.subarray(i * 3, i * 3 + 3), offset + 3);
        vertices.set(tangents.subarray(i * 4, i * 4 + 4), offset + 6);
        vertices.set(uv0.subarray(i * 2, i * 2 + 2), offset + 10);
        vertices.set(uv1.subarray(i * 2, i * 2 + 2), offset + 12);
        for (let c = 0; c < 4; c++) {
          vertices[offset + 14 + c] =
            color && c < colorSize ? color[i * colorSize + c]! : 1;
        }
      }
      const maximumIndex = rawIndices.reduce(
        (maximum, value) => Math.max(maximum, value),
        0,
      );
      const indices =
        maximumIndex < 65535 ? new Uint16Array(rawIndices) : rawIndices;
      const primitive = primitives.length;
      primitives.push({
        name: `${meshName} / primitive ${primitiveId}`,
        vertices,
        indices,
        material: selectedMaterial,
        bounds: computeBounds(positions),
      });
      return primitive;
    });
  });
  const nodes = list(source.nodes, 'nodes').map((entry) =>
    object(entry, 'node'),
  );
  const parents = new Map<number, number>();
  const children = nodes.map((node, parent) =>
    list(node.children, 'node.children').map((entry) => {
      const child = integer(entry, 'node child');
      index(nodes, child, 'node child');
      if (parents.has(child))
        fail(
          'a node cannot have multiple parents or duplicate child references.',
        );
      parents.set(child, parent);
      return child;
    }),
  );
  const states = new Uint8Array(nodes.length);
  const local = nodes.map(nodeMatrix);
  const visit = (id: number, depth: number): void => {
    if (states[id] === 1) fail('scene graph contains a cycle.');
    if (states[id] === 2) return;
    if (depth > 512) fail('scene graph exceeds 512 levels.');
    states[id] = 1;
    for (const child of children[id]!) visit(child, depth + 1);
    states[id] = 2;
  };
  nodes.forEach((node, id) => {
    if (node.skin !== undefined || node.weights !== undefined)
      fail('skinning and morph targets are not supported.');
    visit(id, 0);
  });
  const scenes = list(source.scenes, 'scenes');
  const sceneId = options.scene ?? integer(source.scene, 'scene', 0);
  const scene = object(index(scenes, sceneId, 'scene'), 'scene');
  const roots = list(scene.nodes, 'scene.nodes').map((entry) =>
    integer(entry, 'scene node'),
  );
  const draws: GltfDraw[] = [];
  const visited = new Set<number>();
  const bounds: GltfBounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  const drawNode = (id: number, parent: Float32Array): void => {
    const node = index(nodes, id, 'scene node');
    if (visited.has(id)) fail('scene references a node more than once.');
    visited.add(id);
    const transform = new Float32Array(16);
    mat4.multiply(transform, parent, local[id]!);
    if (!transform.every(Number.isFinite))
      fail('world transform exceeds float32 range.');
    if (node.mesh !== undefined) {
      for (const primitive of index(meshes, node.mesh, 'node.mesh')) {
        draws.push({
          name: text(node.name, 'node.name', `Node ${id}`),
          primitive,
          transform,
        });
        addBounds(bounds, primitives[primitive]!.bounds, transform);
      }
    }
    for (const child of children[id]!) drawNode(child, transform);
  };
  for (const root of roots) {
    if (parents.has(root))
      fail('scene root must not be a child of another node.');
    drawNode(root, mat4.create());
  }
  if (!draws.length) fail('selected scene contains no static triangle meshes.');
  const stats = {
    triangles: draws.reduce(
      (sum, draw) => sum + primitives[draw.primitive]!.indices.length / 3,
      0,
    ),
    vertices: primitives.reduce(
      (sum, primitive) => sum + primitive.vertices.length / GLTF_VERTEX_FLOATS,
      0,
    ),
    drawCalls: draws.length,
    fileBytes: byteLength,
  };
  return {
    primitives,
    materials,
    images,
    textures,
    samplers,
    draws,
    bounds,
    extras: asset.extras,
    warnings,
    stats,
  };
}

export async function loadGlb(
  url: string | URL,
  options: GlbLoadOptions = {},
): Promise<GltfAsset> {
  const request = options.fetch ?? fetch;
  const response = await request(url, { signal: options.signal });
  if (!response.ok) fail(`download failed: HTTP ${response.status} (${url}).`);
  const input = await response.arrayBuffer();
  options.signal?.throwIfAborted();
  const { json } = container(input);
  const uris = new Set<string>();
  for (const entry of [
    ...list(json.buffers, 'buffers'),
    ...list(json.images, 'images'),
  ]) {
    const item = object(entry, 'resource');
    if (item.uri !== undefined) {
      const uri = text(item.uri, 'resource.uri');
      if (!uri.startsWith('data:')) uris.add(uri);
    }
  }
  const resources = new Map<string, Bytes>();
  if (uris.size) {
    const base =
      response.url ||
      new URL(url, typeof location === 'undefined' ? undefined : location.href)
        .href;
    await Promise.all(
      [...uris].map(async (uri) => {
        const resolved = new URL(uri, base);
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:')
          fail(`unsupported resource URL protocol ${resolved.protocol}.`);
        const resource = await request(resolved, { signal: options.signal });
        if (!resource.ok)
          fail(`resource "${uri}" failed: HTTP ${resource.status}.`);
        resources.set(uri, new Uint8Array(await resource.arrayBuffer()));
      }),
    );
  }
  options.signal?.throwIfAborted();
  return parseGlb(input, { scene: options.scene, resources });
}
