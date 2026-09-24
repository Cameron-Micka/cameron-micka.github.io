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

test('the thinner ring preserves the broken body and batched debris topology', () => {
  const expected = [
    'bf022f4c4c98c159965dba1d250fb897470da417f71898d1be20ec02f70c24d4',
    'ce19b2eef81786f23e2e545d946ef0d93d762f942072c589a8ae03a97a036ff3',
  ];
  for (const [index, mesh] of document.meshes.entries()) {
    const primitive = mesh.primitives[0];
    const digest = createHash('sha256');
    digest.update(
      bufferViewBytes(document.accessors[primitive.indices].bufferView),
    );
    assert.equal(digest.digest('hex'), expected[index], mesh.name);
  }
});

test('actual ring geometry has a 2.2-wide band and 0.18-thick shell at the original radius', () => {
  assert.deepEqual(metrics.dimensions, {
    radius: 10,
    bandWidth: 2.2,
    shellThickness: 0.18,
  });
  const primitive = document.meshes[0].primitives[0];
  const positions = readAccessor(primitive.attributes.POSITION);
  const uvs = readAccessor(primitive.attributes.TEXCOORD_0);
  const centralHull = positions.filter((_, index) => {
    const [u, v] = uvs[index];
    return Math.abs(u - 0.5) < 1e-6 && v >= 520 / 1024 && v <= 760 / 1024;
  });
  assert.equal(centralHull.length, 17);
  const width =
    Math.max(...centralHull.map((p) => p[2])) -
    Math.min(...centralHull.map((p) => p[2]));
  assert.ok(Math.abs(width - 2.2) < 1e-4, `Actual band width: ${width}`);
  for (const v of [0, 1]) {
    const inner =
      positions[
        uvs.findIndex(
          (uv) =>
            Math.abs(uv[0] - 0.5) < 1e-6 &&
            Math.abs(uv[1] - (8 + v * 496) / 1024) < 1e-6,
        )
      ];
    const outer =
      positions[
        uvs.findIndex(
          (uv) =>
            Math.abs(uv[0] - 0.5) < 1e-6 &&
            Math.abs(uv[1] - (520 + v * 240) / 1024) < 1e-6,
        )
      ];
    assert.ok(inner && outer, 'Both shell surfaces must be present');
    const outerRadius = Math.hypot(outer[0], outer[1]);
    const thickness = outerRadius - Math.hypot(inner[0], inner[1]);
    assert.ok(Math.abs(outerRadius - 10) < 1e-4);
    assert.ok(
      Math.abs(thickness - 0.18) < 2e-6,
      `Actual shell thickness: ${thickness}`,
    );
  }
  assert.ok(Math.abs(metrics.arcDegrees - 197.67043932013402) < 1e-8);
});

test('the original orange fire and fracture heat map is preserved pixel-for-pixel', async () => {
  const pixels = await sharp(encodedImage(3)).raw().toBuffer();
  assert.equal(
    createHash('sha256').update(pixels).digest('hex'),
    'dcbf45145ae5d2868c4628e401b8055e07a48c592842198ec4c80656939d98bb',
  );
});

test('metallic hull changes preserve habitat and fracture colors, normals, and ORM', async () => {
  const regions = [
    {
      name: 'habitat',
      top: 0,
      height: 512,
      hashes: [
        'ffda124a6e026c045d396e48b6499f1c1be4b196c9ae99fd08035bcc10440f9a',
        '5769bfb88982aaced892c778161cc73f5633dde9726371fb7d8f2c90b90cbb57',
        '2e4dca4e4a102443b5599ccffe581688c664e01774def281a3e58ae5becdc87d',
      ],
    },
    {
      name: 'fracture',
      top: 896,
      height: 128,
      hashes: [
        'f410e8922e9ea7b29909e30a363c575f96b643cd86340550f2b390f2ba85432f',
        '764778b1ab47a3517ecb7351f12f2db75c66185e75461f862ad3c4e6fa3b47b9',
        'd754d6f3ed43657ee6b1c6f22a437ab38c16996cc3ad344f69888a877eea19db',
      ],
    },
  ];
  for (const region of regions) {
    for (const [index, digest] of region.hashes.entries()) {
      const scale = index === 0 ? 1 : 0.5;
      const pixels = await sharp(encodedImage(index))
        .extract({
          left: 8 * scale,
          top: (region.top + 8) * scale,
          width: 2032 * scale,
          height: (region.height - 16) * scale,
        })
        .raw()
        .toBuffer();
      assert.equal(
        createHash('sha256').update(pixels).digest('hex'),
        digest,
        `${region.name} / ${document.images[index].name}`,
      );
    }
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

test('silver-blue hull plating retains dark recesses and circular hardware at physical scale', async () => {
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
  let blue = 0;
  let dark = 0;
  let bright = 0;
  for (let y = 524; y < 756; y++) {
    for (let x = 1030; x < 1320; x++) {
      const value = luminance(x, y);
      total += value;
      const offset = (y * info.width + x) * info.channels;
      if (data[offset + 2] > data[offset]) blue++;
      if (value < 60) dark++;
      if (value > 140) bright++;
      samples++;
    }
  }
  assert.ok(
    total / samples > 90 && total / samples < 150,
    'Metal must not read as dark graphite',
  );
  assert.ok(
    blue / samples > 0.85,
    'Intact metal should retain a cool silver-blue tint',
  );
  assert.ok(
    dark / samples > 0.1,
    'Recesses must remain darker than the plating',
  );
  assert.ok(
    bright / samples > 0.25,
    'Bare metal must retain bright reflectance',
  );
  const aspect =
    (((metrics.arcDegrees * Math.PI) / 180) * metrics.dimensions.radius) /
    metrics.dimensions.bandWidth;
  for (const module of [8, 10, 11]) {
    const u = (module + 0.5) / 18;
    const v = (module % 2 ? 0.3 : 0.7) + (hash(module, 0, 439) - 0.5) * 0.05;
    const radius = 0.08 + hash(module, 0, 553) * 0.045;
    let cap = 0;
    for (let index = 0; index < 8; index++) {
      const angle = ((index + 0.5) / 8) * Math.PI * 2;
      cap += sample(
        u + (Math.cos(angle) * radius * 0.4) / aspect,
        v + Math.sin(angle) * radius * 0.4,
      );
    }
    assert.ok(cap / 8 > sample(u, v) + 20, `Missing circular inset ${module}`);
  }
});

test('intact hull ORM has reflective metal plates rather than uniform matte shading', async () => {
  const { data, info } = await sharp(encodedImage(2))
    .raw()
    .toBuffer({ resolveWithObject: true });
  let samples = 0;
  let roughness = 0;
  let metallic = 0;
  let polished = 0;
  let rough = 0;
  for (let y = 262; y < 378; y++) {
    for (let x = 515; x < 660; x++) {
      const offset = (y * info.width + x) * info.channels;
      const r = data[offset + 1] / 255;
      const m = data[offset + 2] / 255;
      roughness += r;
      metallic += m;
      if (r < 0.55 && m > 0.8) polished++;
      if (r > 0.58) rough++;
      samples++;
    }
  }
  assert.ok(roughness / samples > 0.35 && roughness / samples < 0.55);
  assert.ok(metallic / samples > 0.85);
  assert.ok(
    polished / samples > 0.6,
    'Most intact plates should reflect the scene lights',
  );
  assert.ok(
    rough / samples > 0.05,
    'Mechanical recesses need a distinct rougher finish',
  );
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
