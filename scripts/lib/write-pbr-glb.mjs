export function writePbrGlb(meshes, textures, extras, metadata) {
  const chunks = [];
  const materialSides = [
    ...new Set(meshes.map((mesh) => mesh.doubleSided ?? false)),
  ];
  let length = 0;
  const gltf = {
    asset: {
      version: '2.0',
      generator: metadata.generator,
      copyright:
        'Original procedural geometry and textures; no extracted game assets.',
      extras,
    },
    scene: 0,
    scenes: [{ name: metadata.sceneName, nodes: [0] }],
    nodes: [
      {
        name: metadata.rootName,
        children: meshes.map((_, index) => index + 1),
      },
    ],
    meshes: [],
    materials: materialSides.map((doubleSided) => ({
      name: doubleSided
        ? `${metadata.materialName} / double-sided`
        : metadata.materialName,
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicRoughnessTexture: { index: 2 },
        metallicFactor: 1,
        roughnessFactor: 1,
      },
      normalTexture: { index: 1, scale: 1 },
      occlusionTexture: { index: 2, strength: 0.8 },
      emissiveTexture: { index: 3 },
      emissiveFactor: [1, 1, 1],
      alphaMode: 'OPAQUE',
      doubleSided,
    })),
    textures: textures.map((_, index) => ({ sampler: 0, source: index })),
    samplers: [
      { magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 },
    ],
    images: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };

  function bufferView(bytes, target) {
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const index = gltf.bufferViews.length;
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: length,
      byteLength: data.length,
      ...(target ? { target } : {}),
    });
    chunks.push(data);
    const padding = (4 - (data.length % 4)) % 4;
    if (padding) chunks.push(Buffer.alloc(padding));
    length += data.length + padding;
    return index;
  }

  function accessor(data, type, components, bounds) {
    const componentType =
      data instanceof Float32Array
        ? 5126
        : data instanceof Uint32Array
          ? 5125
          : 5123;
    const index = gltf.accessors.length;
    gltf.accessors.push({
      bufferView: bufferView(data, type === 'SCALAR' ? 34963 : 34962),
      componentType,
      count: data.length / components,
      type,
      ...bounds,
    });
    return index;
  }

  for (const mesh of meshes) {
    const meshIndex = gltf.meshes.length;
    gltf.nodes.push({ name: mesh.name, mesh: meshIndex });
    gltf.meshes.push({
      name: mesh.name,
      primitives: [
        {
          attributes: {
            POSITION: accessor(mesh.positions, 'VEC3', 3, {
              min: mesh.min,
              max: mesh.max,
            }),
            NORMAL: accessor(mesh.normals, 'VEC3', 3),
            TANGENT: accessor(mesh.tangents, 'VEC4', 4),
            TEXCOORD_0: accessor(mesh.uvs, 'VEC2', 2),
          },
          indices: accessor(mesh.indices, 'SCALAR', 1),
          material: materialSides.indexOf(mesh.doubleSided ?? false),
          mode: 4,
        },
      ],
    });
  }
  for (const texture of textures) {
    gltf.images.push({
      name: texture.name,
      bufferView: bufferView(texture.data),
      mimeType: texture.mimeType,
    });
  }
  gltf.buffers.push({ byteLength: length });
  const json = Buffer.from(JSON.stringify(gltf));
  const jsonChunk = Buffer.concat([
    json,
    Buffer.alloc((4 - (json.length % 4)) % 4, 0x20),
  ]);
  const binChunk = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}
