import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import sharp from 'sharp';
import { validateBytes } from 'gltf-validator';
import { generateBrokenRing, MODEL_BUDGET } from './build-broken-ring.mjs';
import { hash } from './lib/procedural.mjs';

let glb;
let document;
let binary;
let metrics;

before(async () => {
  glb = await readFile(
    new URL('../public/models/broken-ring.glb', import.meta.url),
  );
  metrics = JSON.parse(
    await readFile(
      new URL('../public/models/broken-ring.metrics.json', import.meta.url),
      'utf8',
    ),
  );
  const jsonLength = glb.readUInt32LE(12);
  document = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
  binary = glb.subarray(28 + jsonLength);
});

function readAccessor(index) {
  const accessor = document.accessors[index];
  const view = document.bufferViews[accessor.bufferView];
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const bytes = accessor.componentType === 5123 ? 2 : 4;
  const read =
    accessor.componentType === 5126
      ? (offset) => binary.readFloatLE(offset)
      : accessor.componentType === 5123
        ? (offset) => binary.readUInt16LE(offset)
        : (offset) => binary.readUInt32LE(offset);
  return Array.from({ length: accessor.count }, (_, item) =>
    Array.from({ length: components }, (_, component) =>
      read(
        start +
          item * (view.byteStride ?? components * bytes) +
          component * bytes,
      ),
    ),
  );
}

function bufferViewBytes(
  index,
  sourceDocument = document,
  sourceBinary = binary,
) {
  const view = sourceDocument.bufferViews[index];
  return sourceBinary.subarray(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  );
}

function encodedImage(index, sourceDocument = document, sourceBinary = binary) {
  return bufferViewBytes(
    sourceDocument.images[index].bufferView,
    sourceDocument,
    sourceBinary,
  );
}

test('the delivered file is a self-contained GLB 2.0 with no decoder extensions', () => {
  assert.equal(glb.readUInt32LE(0), 0x46546c67);
  assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.byteLength);
  assert.equal(glb.readUInt32LE(16), 0x4e4f534a);
  const jsonLength = glb.readUInt32LE(12);
  assert.equal(glb.readUInt32LE(24 + jsonLength), 0x004e4942);
  assert.equal(glb.readUInt32LE(20 + jsonLength), binary.byteLength);
  assert.equal(document.buffers[0].byteLength, binary.byteLength);
  assert.equal(document.asset.version, '2.0');
  assert.equal(document.asset.extras.iteration, 5);
  assert.equal(document.extensionsRequired, undefined);
  assert.equal(document.extensionsUsed, undefined);
  assert.equal(document.animations, undefined);
  assert.equal(document.skins, undefined);
  for (const entry of [...document.buffers, ...document.images]) {
    assert.equal(entry.uri, undefined);
  }
  for (const view of document.bufferViews) {
    assert.equal(view.byteOffset % 4, 0);
    assert.ok(view.byteOffset + view.byteLength <= binary.byteLength);
  }
});

test('Khronos validation reports zero errors and warnings', async () => {
  const report = await validateBytes(new Uint8Array(glb), { maxIssues: 50 });
  assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues));
  assert.equal(report.issues.numWarnings, 0, JSON.stringify(report.issues));
});

test('actual mesh counts and payload stay within the final realtime budgets', () => {
  let triangles = 0;
  let vertices = 0;
  let draws = 0;
  for (const mesh of document.meshes) {
    for (const primitive of mesh.primitives) {
      assert.equal(primitive.mode, 4);
      assert.equal(primitive.material, 0);
      assert.equal(primitive.targets, undefined);
      triangles += document.accessors[primitive.indices].count / 3;
      vertices += document.accessors[primitive.attributes.POSITION].count;
      draws++;
    }
  }
  assert.equal(document.meshes.length, 2);
  assert.equal(triangles, metrics.triangles);
  assert.equal(vertices, metrics.vertices);
  assert.equal(draws, metrics.drawCalls);
  assert.equal(glb.byteLength, metrics.fileBytes);
  assert.equal(document.asset.extras.triangles, triangles);
  assert.ok(triangles <= MODEL_BUDGET.triangles);
  assert.ok(draws <= MODEL_BUDGET.drawCalls);
  assert.ok(glb.byteLength <= MODEL_BUDGET.fileBytes);
  assert.deepEqual(metrics.budget, MODEL_BUDGET);
});

test('geometry has finite attributes, valid indices, and orthonormal tangent frames', () => {
  for (const mesh of document.meshes) {
    const primitive = mesh.primitives[0];
    const positions = readAccessor(primitive.attributes.POSITION);
    const normals = readAccessor(primitive.attributes.NORMAL);
    const tangents = readAccessor(primitive.attributes.TANGENT);
    const uvs = readAccessor(primitive.attributes.TEXCOORD_0);
    assert.equal(normals.length, positions.length);
    assert.equal(tangents.length, positions.length);
    assert.equal(uvs.length, positions.length);
    for (let index = 0; index < positions.length; index++) {
      for (const value of [
        ...positions[index],
        ...normals[index],
        ...tangents[index],
        ...uvs[index],
      ]) {
        assert.ok(Number.isFinite(value));
      }
      assert.ok(Math.abs(Math.hypot(...normals[index]) - 1) < 0.0001);
      assert.ok(
        Math.abs(Math.hypot(...tangents[index].slice(0, 3)) - 1) < 0.0001,
      );
      assert.ok(
        Math.abs(
          normals[index].reduce(
            (sum, value, axis) => sum + value * tangents[index][axis],
            0,
          ),
        ) < 0.0001,
      );
      assert.ok(Math.abs(tangents[index][3]) === 1);
      assert.ok(uvs[index].every((value) => value >= 0 && value <= 1));
    }
    const indices = readAccessor(primitive.indices).flat();
    assert.equal(indices.length % 3, 0);
    for (let index = 0; index < indices.length; index += 3) {
      const face = indices.slice(index, index + 3);
      assert.ok(face.every((vertex) => vertex < positions.length));
      const [a, b, c] = face.map((vertex) => positions[vertex]);
      const ab = b.map((value, axis) => value - a[axis]);
      const ac = c.map((value, axis) => value - a[axis]);
      const area = Math.hypot(
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      );
      assert.ok(area > 1e-10, `${mesh.name} has a degenerate triangle`);
    }
  }
});

test('all four PBR maps decode, match their metrics, and fit the memory budget', async () => {
  assert.equal(document.images.length, 4);
  let memory = 0;
  for (const [index, image] of document.images.entries()) {
    const encoded = encodedImage(index);
    const decoded = await sharp(encoded).metadata();
    assert.equal(image.mimeType, index === 0 ? 'image/jpeg' : 'image/png');
    assert.equal(decoded.width, index === 0 ? 2048 : 1024);
    assert.equal(decoded.height, index === 0 ? 1024 : 512);
    assert.equal(decoded.hasAlpha, false);
    assert.equal(decoded.width, metrics.textures[index].width);
    assert.equal(decoded.height, metrics.textures[index].height);
    assert.equal(encoded.length, metrics.textures[index].bytes);
    memory += Math.ceil((decoded.width * decoded.height * 4 * 4) / 3);
  }
  assert.equal(memory, metrics.textureBytesWithMipmaps);
  assert.ok(memory <= MODEL_BUDGET.textureBytesWithMipmaps);
});

test('terrain, metal, occlusion, normals and heat share one opaque PBR atlas', async () => {
  assert.equal(document.materials.length, 1);
  const material = document.materials[0];
  assert.equal(material.alphaMode, 'OPAQUE');
  assert.equal(material.doubleSided, false);
  assert.equal(material.pbrMetallicRoughness.baseColorTexture.index, 0);
  assert.equal(material.normalTexture.index, 1);
  assert.equal(material.pbrMetallicRoughness.metallicRoughnessTexture.index, 2);
  assert.equal(material.occlusionTexture.index, 2);
  assert.equal(material.emissiveTexture.index, 3);
  assert.deepEqual(material.emissiveFactor, [1, 1, 1]);
  const { data, info } = await sharp(encodedImage(2))
    .raw()
    .toBuffer({ resolveWithObject: true });
  let maximumMetal = 0;
  for (let y = 8; y < 248; y++) {
    for (let x = 8; x < info.width - 8; x++) {
      assert.equal(
        data[(y * info.width + x) * info.channels + 2],
        0,
        'Habitat terrain must not be metallic',
      );
    }
  }
  for (let offset = 2; offset < data.length; offset += info.channels) {
    maximumMetal = Math.max(maximumMetal, data[offset]);
  }
  assert.ok(maximumMetal > 200, 'Hull plating must retain a metallic response');
});

test('the texture refresh preserves the broken body, debris, and UV layout', () => {
  const expected = [
    '7518e6cb78a7d8534ed157bb06254e4daf14663fb2ec23765f70f398d8a8e7bb',
    '8313d6f95d00c3e31e348decb0d4545c5c513b2d4ba7ea8de67ed04c2870811f',
  ];
  for (const [index, mesh] of document.meshes.entries()) {
    const primitive = mesh.primitives[0];
    const digest = createHash('sha256');
    for (const accessor of [
      primitive.attributes.POSITION,
      primitive.attributes.TEXCOORD_0,
      primitive.indices,
    ]) {
      digest.update(bufferViewBytes(document.accessors[accessor].bufferView));
    }
    assert.equal(digest.digest('hex'), expected[index], mesh.name);
  }
});

test('the original orange fire and fracture heat map is preserved pixel-for-pixel', async () => {
  const pixels = await sharp(encodedImage(3)).raw().toBuffer();
  assert.equal(
    createHash('sha256').update(pixels).digest('hex'),
    'dcbf45145ae5d2868c4628e401b8055e07a48c592842198ec4c80656939d98bb',
  );
});

test('muting the habitat preserves exterior colors, normals, and surface response', async () => {
  const { data, info } = await sharp(encodedImage(0))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const exterior = data.subarray(512 * info.width * info.channels);
  assert.equal(
    createHash('sha256').update(exterior).digest('hex'),
    '10c06f105e88d4be2a74e46cebd4a2c08c35dcb76b22d7716973d111b26e06cc',
    'Hull, rim, and fracture colors must remain unchanged',
  );
  const expected = [
    '53869aa0b2ea74af823e9eaeeecaaf7604c9fb18c51c86709565e2f4e5ea4403',
    '0766033cdff16dd4f8867c1eb4b6e5fc68273ea4296ed99cc80bd0e8d3bc3f72',
  ];
  for (const [index, digest] of expected.entries()) {
    const pixels = await sharp(encodedImage(index + 1)).raw().toBuffer();
    assert.equal(
      createHash('sha256').update(pixels).digest('hex'),
      digest,
      document.images[index + 1].name,
    );
  }
});

test('the intact habitat retains muted blue water, sage-green land, and limited snow', async () => {
  const { data, info } = await sharp(encodedImage(0))
    .raw()
    .toBuffer({ resolveWithObject: true });
  let samples = 0;
  let saturation = 0;
  let water = 0;
  let waterSaturation = 0;
  let vegetation = 0;
  let vegetationSaturation = 0;
  let snow = 0;
  // Sample the habitat atlas away from gutters and the scorched ends.
  for (let y = 16; y < 496; y++) {
    for (let x = 350; x < 1680; x++) {
      const offset = (y * info.width + x) * info.channels;
      const [r, g, b] = data.subarray(offset, offset + 3);
      const maximum = Math.max(r, g, b);
      const minimum = Math.min(r, g, b);
      const pixelSaturation = (maximum - minimum) / Math.max(1, maximum);
      samples++;
      saturation += pixelSaturation;
      if (b > g * 1.05 && g > r * 1.08 && b > 45) {
        water++;
        waterSaturation += pixelSaturation;
      }
      if (g > r * 1.04 && g > b * 1.04) {
        vegetation++;
        vegetationSaturation += pixelSaturation;
      }
      if (minimum > 155 && maximum - minimum < 45) snow++;
    }
  }
  assert.ok(water / samples > 0.2 && water / samples < 0.65);
  assert.ok(vegetation / samples > 0.2 && vegetation / samples < 0.7);
  assert.ok(snow / samples > 0.01 && snow / samples < 0.2);
  assert.ok(
    saturation / samples > 0.12 && saturation / samples < 0.26,
    'The habitat should remain muted without becoming grayscale',
  );
  assert.ok(
    waterSaturation / water > 0.2 && waterSaturation / water < 0.4,
    'Water should retain a subdued blue-gray tint',
  );
  assert.ok(
    vegetationSaturation / vegetation > 0.07 &&
      vegetationSaturation / vegetation < 0.19,
    'Land should retain a subdued sage-green tint',
  );
});

test('dark hull plating retains circular inset hardware at physical scale', async () => {
  const { data, info } = await sharp(encodedImage(0))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const luminance = (x, y) => {
    const offset = (y * info.width + x) * info.channels;
    return (
      data[offset] * 0.2126 +
      data[offset + 1] * 0.7152 +
      data[offset + 2] * 0.0722
    );
  };
  const sample = (u, v) =>
    luminance(Math.round(8 + u * 2032), 512 + Math.round(8 + v * 240));
  let total = 0;
  let samples = 0;
  for (let y = 524; y < 756; y++) {
    for (let x = 1030; x < 1320; x++) {
      total += luminance(x, y);
      samples++;
    }
  }
  assert.ok(total / samples > 20 && total / samples < 60);
  for (const module of [8, 10, 11]) {
    const u = (module + 0.5) / 18;
    const v =
      (module % 2 ? 0.3 : 0.7) + (hash(module, 0, 439) - 0.5) * 0.05;
    const radius = 0.08 + hash(module, 0, 553) * 0.045;
    let cap = 0;
    for (let index = 0; index < 8; index++) {
      const angle = ((index + 0.5) / 8) * Math.PI * 2;
      cap += sample(
        u + (Math.cos(angle) * radius * 0.4) / (34.5 / 2.6),
        v + Math.sin(angle) * radius * 0.4,
      );
    }
    assert.ok(cap / 8 > sample(u, v) + 20, `Missing circular inset ${module}`);
  }
});

test('final textures and geometry regenerate reproducibly', async () => {
  const regenerated = await generateBrokenRing();
  assert.deepEqual(regenerated.stats, metrics);
  const jsonLength = regenerated.glb.readUInt32LE(12);
  const sourceDocument = JSON.parse(
    regenerated.glb.subarray(20, 20 + jsonLength).toString(),
  );
  const sourceBinary = regenerated.glb.subarray(28 + jsonLength);
  assert.deepEqual(sourceDocument, document);
  for (let index = 0; index < document.images.length; index++) {
    assert.ok(
      encodedImage(index, sourceDocument, sourceBinary).equals(
        encodedImage(index),
      ),
      `${document.images[index].name} did not regenerate identically`,
    );
  }
  for (const mesh of document.meshes) {
    const primitive = mesh.primitives[0];
    for (const [name, index] of Object.entries({
      ...primitive.attributes,
      indices: primitive.indices,
    })) {
      const view = document.accessors[index].bufferView;
      const actual = bufferViewBytes(view, sourceDocument, sourceBinary);
      const expected = bufferViewBytes(view);
      if (name === 'TANGENT') {
        // Allow last-bit floating-point differences in generated tangent frames.
        for (let offset = 0; offset < actual.length; offset += 4) {
          assert.ok(
            Math.abs(
              actual.readFloatLE(offset) - expected.readFloatLE(offset),
            ) < 1e-7,
          );
        }
      } else {
        assert.ok(actual.equals(expected), `${mesh.name} ${name} changed`);
      }
    }
  }
});

test('invalid iteration inputs fail explicitly instead of generating a fallback asset', async () => {
  for (const iteration of [0, 6, 2.5, NaN, '5']) {
    await assert.rejects(
      generateBrokenRing({ iteration }),
      /integer between 1 and 5/,
    );
  }
});
