export function glb(document, binary = Buffer.alloc(0), unknownChunk = false) {
  const json = Buffer.from(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const binaryLength = Math.ceil(binary.length / 4) * 4;
  const length =
    20 +
    jsonLength +
    (binaryLength ? 8 + binaryLength : 0) +
    (unknownChunk ? 12 : 0);
  const out = Buffer.alloc(length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(length, 8);
  out.writeUInt32LE(jsonLength, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  out.fill(0x20, 20, 20 + jsonLength);
  json.copy(out, 20);
  let offset = 20 + jsonLength;
  if (binaryLength) {
    out.writeUInt32LE(binaryLength, offset);
    out.writeUInt32LE(0x004e4942, offset + 4);
    binary.copy(out, offset + 8);
    offset += 8 + binaryLength;
  }
  if (unknownChunk) {
    out.writeUInt32LE(4, offset);
    out.writeUInt32LE(0x41424344, offset + 4);
  }
  return new Uint8Array(out);
}

export class GlbFixture {
  document = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: {} }] }],
    buffers: [{ byteLength: 0 }],
    bufferViews: [],
    accessors: [],
  };
  parts = [];
  length = 0;

  constructor() {
    this.primitive.attributes.POSITION = this.attribute(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      'VEC3',
    );
  }

  get primitive() {
    return this.document.meshes[0].primitives[0];
  }

  bytes(data, stride) {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const id = this.document.bufferViews.length;
    this.document.bufferViews.push({
      buffer: 0,
      byteOffset: this.length,
      byteLength: bytes.length,
      ...(stride === undefined ? {} : { byteStride: stride }),
    });
    this.parts.push(bytes);
    const padding = (4 - (bytes.length % 4)) % 4;
    this.parts.push(Buffer.alloc(padding));
    this.length += bytes.length + padding;
    return id;
  }

  attribute(data, type, extra = {}) {
    const componentType =
      data instanceof Float32Array
        ? 5126
        : data instanceof Uint8Array
          ? 5121
          : data instanceof Uint16Array
            ? 5123
            : 5125;
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const id = this.document.accessors.length;
    this.document.accessors.push({
      bufferView: this.bytes(data),
      componentType,
      type,
      count: data.length / size,
      ...extra,
    });
    return id;
  }

  normals() {
    this.primitive.attributes.NORMAL = this.attribute(
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      'VEC3',
    );
    return this;
  }

  uv(set = 0) {
    this.primitive.attributes[`TEXCOORD_${set}`] = this.attribute(
      new Float32Array([0, 0, 1, 0, 0, 1]),
      'VEC2',
    );
    return this;
  }

  texture(png) {
    this.document.images = [
      { bufferView: this.bytes(png), mimeType: 'image/png' },
    ];
    this.document.textures = [{ source: 0 }];
    this.document.materials = [{}];
    this.primitive.material = 0;
    return this;
  }

  build(unknownChunk = false) {
    this.document.buffers[0].byteLength = this.length;
    return glb(this.document, Buffer.concat(this.parts), unknownChunk);
  }
}
