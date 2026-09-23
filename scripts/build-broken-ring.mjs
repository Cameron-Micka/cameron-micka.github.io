import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { validateBytes } from 'gltf-validator';
import { writePbrGlb } from './lib/write-pbr-glb.mjs';
import {
  clamp,
  mix,
  smoothstep,
  random,
  hash,
  noise,
  fbm,
} from './lib/procedural.mjs';
import {
  computeBounds,
  computeNormals,
  computeTangents,
  createTriangleIndices,
} from '../src/engine/gltf/mesh.mjs';

const ATLAS_WIDTH = 2048;
const ATLAS_HEIGHT = 1024;
const GUTTER = 8;
const REGIONS = [
  { name: 'habitat', top: 0, height: 512 },
  { name: 'hull', top: 512, height: 256 },
  { name: 'rim', top: 768, height: 128 },
  { name: 'fracture', top: 896, height: 128 },
];

export const MODEL_BUDGET = {
  triangles: 15000,
  drawCalls: 2,
  fileBytes: 3 * 1024 * 1024,
  textureBytesWithMipmaps: 20 * 1024 * 1024,
};

const ITERATION_BUDGET = {
  triangles: 20000,
  drawCalls: 3,
  fileBytes: 4 * 1024 * 1024,
  textureBytesWithMipmaps: 28 * 1024 * 1024,
};

function ridges(x, y, seed = 0) {
  let sum = 0;
  let weight = 0.57;
  let total = 0;
  let previous = 1;
  for (let octave = 0; octave < 5; octave++) {
    const ridge = (1 - Math.abs(noise(x, y, seed + octave * 91) * 2 - 1)) ** 3;
    sum += ridge * weight * previous;
    total += weight;
    previous = mix(0.5, 1, ridge);
    x = x * 2.15 + 0.73;
    y = y * 2.15 + 0.39;
    weight *= 0.52;
  }
  return sum / total;
}

function terrain(u, v, iteration) {
  const final = iteration >= 5;
  const x = u * (final ? 100 : 64);
  const y = v * (final ? 7.5 : 4.2);
  const warpX = x + (noise(x * 0.8, y * 0.8, 912) - 0.5) * (final ? 0.38 : 2.4);
  const warpY = y + (noise(x * 0.8, y * 0.8, 181) - 0.5) * (final ? 0.27 : 1.7);
  const scale = final ? 0.26 : 0.43;
  const continent = fbm(warpX * scale, warpY * scale, 341, 4);
  const land = smoothstep(final ? 0.33 : 0.38, final ? 0.37 : 0.425, continent);
  const ridgeScale = final ? 1.8 : 1.45;
  const mountains = ridges(warpX * ridgeScale, warpY * ridgeScale, 932);
  return { land, mountains, continent };
}

function crackDistance(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let first = Infinity;
  let second = Infinity;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const px = ix + ox + hash(ix + ox, iy + oy, 391);
      const py = iy + oy + hash(ix + ox, iy + oy, 719);
      const distance = (px - x) ** 2 + (py - y) ** 2;
      if (distance < first) {
        second = first;
        first = distance;
      } else if (distance < second) {
        second = distance;
      }
    }
  }
  return Math.sqrt(second) - Math.sqrt(first);
}

function atlasUV(region, u, v) {
  const { top, height } = REGIONS[region];
  return [
    (GUTTER + clamp(u) * (ATLAS_WIDTH - GUTTER * 2)) / ATLAS_WIDTH,
    (top + GUTTER + clamp(v) * (height - GUTTER * 2)) / ATLAS_HEIGHT,
  ];
}

class MeshBuilder {
  constructor(name, physicalUVs = false) {
    this.name = name;
    this.physicalUVs = physicalUVs;
    this.positions = [];
    this.uvs = [];
    this.indices = [];
  }

  addShard(center, length, width, depth, theta, roll, uvOffset) {
    const tangent = [-Math.sin(theta), Math.cos(theta), 0];
    const radial = [Math.cos(theta), Math.sin(theta), 0];
    const polygon = [
      [-0.5, -0.32],
      [-0.17, -0.55],
      [0.48, -0.38],
      [0.6, 0.15],
      [0.1, 0.47],
      [-0.46, 0.28],
    ];
    const vertices = [];
    for (const side of [-1, 1]) {
      for (const [x, y] of polygon) {
        const along = x * length;
        const axial =
          y * width * Math.cos(roll) - side * depth * Math.sin(roll);
        const outward =
          y * width * Math.sin(roll) + side * depth * Math.cos(roll);
        vertices.push(
          center.map(
            (value, index) =>
              value +
              tangent[index] * along +
              radial[index] * outward +
              (index === 2 ? axial : 0),
          ),
        );
      }
    }
    for (let index = 1; index < polygon.length - 1; index++) {
      this.triangle(
        [vertices[0], vertices[index + 1], vertices[index]],
        1,
        uvOffset,
      );
      this.triangle(
        [vertices[6], vertices[index + 6], vertices[index + 7]],
        1,
        uvOffset,
      );
    }
    for (let index = 0; index < polygon.length; index++) {
      const next = (index + 1) % polygon.length;
      this.triangle(
        [vertices[index], vertices[next], vertices[next + 6]],
        3,
        uvOffset,
      );
      this.triangle(
        [vertices[index], vertices[next + 6], vertices[index + 6]],
        3,
        uvOffset,
      );
    }
  }

  addChip(center, size, uvOffset) {
    const points = [
      [0, 0, size * 0.62],
      [-size * 0.5, -size * 0.32, -size * 0.3],
      [size * 0.5, -size * 0.32, -size * 0.3],
      [0, size * 0.6, -size * 0.3],
    ].map((point) => point.map((value, index) => value + center[index]));
    const faces = [
      [0, 1, 2],
      [0, 2, 3],
      [0, 3, 1],
      [1, 3, 2],
    ];
    for (const [index, face] of faces.entries()) {
      this.triangle(
        face.map((vertex) => points[vertex]),
        index === 0 ? 3 : 1,
        uvOffset,
      );
    }
  }

  grid(uSteps, vSteps, position, uv, reverse = false) {
    const start = this.positions.length / 3;
    for (let u = 0; u <= uSteps; u++) {
      for (let v = 0; v <= vSteps; v++) {
        this.positions.push(...position(u / uSteps, v / vSteps));
        this.uvs.push(...uv(u / uSteps, v / vSteps));
      }
    }
    for (let u = 0; u < uSteps; u++) {
      for (let v = 0; v < vSteps; v++) {
        const a = start + u * (vSteps + 1) + v;
        const b = a + vSteps + 1;
        if (reverse) {
          this.indices.push(a, a + 1, b, a + 1, b + 1, b);
        } else {
          this.indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
  }

  triangle(points, region, uvOffset = 0) {
    const first = this.positions.length / 3;
    this.positions.push(...points.flat());
    if (this.physicalUVs) {
      // World-scaled UVs prevent thin cut faces becoming long emissive streaks.
      const a = points[1].map((value, index) => value - points[0][index]);
      const b = points[2].map((value, index) => value - points[0][index]);
      const length = Math.hypot(...a);
      const along =
        a.reduce((sum, value, index) => sum + value * b[index], 0) / length;
      const across = Math.sqrt(
        Math.max(
          0,
          b.reduce((sum, value) => sum + value * value, 0) - along * along,
        ),
      );
      const spanU = region === 3 ? 2.6 : 34.5;
      const spanV = region === 3 ? 0.24 : 2.6;
      const us = [0, length / spanU, along / spanU];
      const minU = Math.min(...us);
      const maxU = Math.max(...us);
      const start = region === 3 ? 0.12 + uvOffset * 0.22 : uvOffset;
      const origin = Math.min(start, 0.98 - (maxU - minU));
      this.uvs.push(
        ...atlasUV(region, origin - minU, 0.12),
        ...atlasUV(region, origin + us[1] - minU, 0.12),
        ...atlasUV(region, origin + us[2] - minU, 0.12 + across / spanV),
      );
    } else {
      this.uvs.push(
        ...atlasUV(region, uvOffset, 0.15),
        ...atlasUV(region, uvOffset + 0.016, 0.15),
        ...atlasUV(region, uvOffset + 0.008, 0.85),
      );
    }
    this.indices.push(first, first + 1, first + 2);
  }

  finish() {
    const positions = new Float32Array(this.positions);
    const uvs = new Float32Array(this.uvs);
    const indices = createTriangleIndices(this.indices, positions.length / 3);
    const normals = computeNormals(positions, indices);
    const tangents = computeTangents(positions, normals, uvs, indices);
    const { min, max } = computeBounds(positions);
    return {
      name: this.name,
      positions,
      normals,
      tangents,
      uvs,
      indices,
      min,
      max,
    };
  }
}

function buildGeometry(iteration) {
  const mesh = new MeshBuilder(
    'Broken ring / habitat and superstructure',
    iteration >= 5,
  );
  const radius = 10;
  const thickness = 0.24;
  const width = 2.6;
  const startAngle = iteration >= 3 ? 0.66 : iteration >= 2 ? 0.12 : -0.22;
  const endAngle = iteration >= 3 ? 4.11 : Math.PI * 1.29;
  const segments = iteration >= 5 ? 128 : 160;
  const crossSegments = 16;

  function tear(v, seed) {
    const sample = clamp(v) * crossSegments;
    const cell = Math.min(crossSegments - 1, Math.floor(sample));
    const fine = mix(hash(cell, seed), hash(cell + 1, seed), sample - cell);
    if (iteration >= 4) {
      const coarseSample = clamp(v) * 5;
      const coarseCell = Math.min(4, Math.floor(coarseSample));
      const coarse = mix(
        hash(coarseCell, seed, 523),
        hash(coarseCell + 1, seed, 523),
        coarseSample - coarseCell,
      );
      return (
        coarse * 0.15 +
        fine * 0.055 -
        Math.exp(-(((v - 0.24) / 0.085) ** 2)) * 0.06 +
        Math.exp(-(((v - 0.68) / 0.07) ** 2)) * 0.065
      );
    }
    return (
      fine * 0.12 +
      Math.sin(v * 18 + seed) * 0.055 +
      Math.sin(v * 41 + seed) * 0.027
    );
  }

  function angle(t, v) {
    const intact = mix(startAngle, endAngle, t);
    if (iteration < 2) return intact;
    return intact + (1 - t) ** 9 * tear(v, 81) - t ** 9 * tear(v, 32);
  }

  function point(t, v, radial = radius) {
    const theta = angle(t, v);
    const damage = iteration >= 2 ? (1 - t) ** 12 + t ** 12 * 0.65 : 0;
    radial += damage * Math.sin(v * 21 + 1.7) * 0.09;
    return [
      Math.cos(theta) * radial,
      Math.sin(theta) * radial,
      (v - 0.5) * width + damage * Math.sin(v * 12) * 0.09,
    ];
  }

  mesh.grid(
    segments,
    crossSegments,
    (u, v) => {
      let relief = 0;
      if (iteration >= 3) {
        const { land, mountains } = terrain(u, v, iteration);
        const margin =
          smoothstep(0, 0.05, Math.min(u, 1 - u)) *
          smoothstep(0, 0.08, Math.min(v, 1 - v));
        relief = land * mountains * margin * (iteration >= 5 ? 0.045 : 0.09);
      }
      return point(u, v, radius - thickness - relief);
    },
    (u, v) => atlasUV(0, u, v),
    true,
  );
  mesh.grid(
    segments,
    crossSegments,
    (u, v) => point(u, v),
    (u, v) => atlasUV(1, u, v),
  );
  for (const edge of [0, 1]) {
    mesh.grid(
      segments,
      2,
      (u, v) => point(u, edge, radius - thickness + v * thickness),
      (u, v) => atlasUV(2, u, v),
      edge === 1,
    );
  }
  for (const end of [0, 1]) {
    mesh.grid(
      crossSegments,
      3,
      (u, v) => point(end, u, radius - thickness + v * thickness),
      (u, v) => atlasUV(3, u, v),
      end === 0,
    );
  }
  if (iteration >= 2) {
    for (const edge of [0, 1]) {
      const va = edge === 0 ? -0.025 : 0.982;
      const vb = edge === 0 ? 0.018 : 1.025;
      const inner = radius - thickness - 0.055;
      const outer = radius + 0.035;
      for (const side of [0, 1]) {
        mesh.grid(
          segments,
          1,
          (u, v) => point(u, mix(va, vb, v), side ? outer : inner),
          (u, v) => atlasUV(2, u, v * 0.3 + side * 0.6),
          side === 0,
        );
        mesh.grid(
          segments,
          1,
          (u, v) => point(u, side ? vb : va, mix(inner, outer, v)),
          (u, v) => atlasUV(2, u, v),
          side === 1,
        );
      }
      for (const end of [0, 1]) {
        mesh.grid(
          1,
          1,
          (u, v) => point(end, mix(va, vb, u), mix(inner, outer, v)),
          (u, v) => atlasUV(3, u, v),
          end === 0,
        );
      }
    }
  }
  const debris = new MeshBuilder(
    'Debris / all opaque shards batched into one mesh',
    iteration >= 5,
  );
  if (iteration >= 4) {
    const rng = random(41704);
    for (const end of [0, 1]) {
      const count =
        iteration >= 5 ? (end === 0 ? 142 : 64) : end === 0 ? 86 : 42;
      const direction = end === 0 ? -1 : 1;
      for (let index = 0; index < count; index++) {
        const v = rng();
        const theta = angle(end, v);
        const distance =
          index < 5
            ? 0.3 + rng() * 1.0
            : 0.25 + rng() ** 0.7 * (end === 0 ? 3.9 : 3.0);
        const spread = (rng() - 0.5) * distance * 0.7;
        const axial = (rng() - 0.5) * distance * 0.55;
        const origin = point(end, v, radius - thickness * 0.5);
        const center = [
          origin[0] -
            Math.sin(theta) * distance * direction +
            Math.cos(theta) * spread,
          origin[1] +
            Math.cos(theta) * distance * direction +
            Math.sin(theta) * spread,
          origin[2] + axial,
        ];
        const size = index < 5 ? 0.4 + rng() * 0.75 : 0.035 + rng() ** 3 * 0.29;
        const uvOffset =
          end === 0 ? 0.005 + rng() * 0.055 : 0.93 + rng() * 0.035;
        if (iteration >= 5 && size < 0.19) {
          debris.addChip(center, size, uvOffset);
        } else {
          debris.addShard(
            center,
            size,
            size * (0.3 + rng() * 0.7),
            size * 0.07,
            theta + (rng() - 0.5) * 2.4,
            (rng() - 0.5) * 3,
            uvOffset,
          );
        }
      }
      for (let index = 0; index < 8; index++) {
        const v = (index + 0.5) / 8;
        const theta = angle(end, v);
        const center = point(end, v, radius - thickness * 0.45);
        const length = 0.25 + rng() * 0.6;
        center[0] -= Math.sin(theta) * length * direction * 0.2;
        center[1] += Math.cos(theta) * length * direction * 0.2;
        mesh.addShard(
          center,
          length,
          0.045,
          0.025,
          theta + (rng() - 0.5) * 0.18,
          (rng() - 0.5) * 0.5,
          end === 0 ? 0.01 : 0.95,
        );
      }
    }
  }
  return {
    meshes: [
      mesh.finish(),
      ...(debris.indices.length ? [debris.finish()] : []),
    ],
    dimensions: { radius, bandWidth: width, shellThickness: thickness },
    arcDegrees: ((endAngle - startAngle) * 180) / Math.PI,
    iteration,
  };
}

function hullSurface(u, v, detail) {
  const row = Math.floor(v * 24);
  const columns = 150 + Math.floor(hash(row, 0, 663) * 90);
  const panelU = u * columns + hash(row, 0, 408) * 0.8;
  const column = Math.floor(panelU);
  const x = panelU % 1;
  const y = (v * 24) % 1;
  const seam = x < 0.035 || y < 0.055;
  const panel = hash(column, row, 92);
  const fineU = u * 640;
  const fineV = v * 68;
  const fine = hash(Math.floor(fineU), Math.floor(fineV), 574);
  const machinery =
    x > 0.12 && x < 0.84 && y > 0.18 && y < 0.82 && panel > 0.35;
  const groove = machinery && ((fineU % 1) < 0.2 || (fineV % 1) < 0.17);
  const conduit =
    Math.abs(v - 0.18) < 0.008 || Math.abs(v - 0.81) < 0.008;
  let shade = 30 + panel * 24 + detail * 11 + fine * 9;
  let surface = 0.36 + panel * 0.045;
  let roughness = 0.66 + panel * 0.1;
  let ao = 0.94;
  if (seam || conduit) {
    shade *= 0.5;
    surface = 0.29;
    ao = 0.7;
  } else if (machinery) {
    shade *= groove ? 0.55 : 1.1;
    surface += groove ? -0.045 : 0.025;
    ao = groove ? 0.72 : 0.92;
  }
  const bayU = (u * 30 + Math.floor(v * 4) * 0.37) % 1;
  const bayV = (v * 4) % 1;
  if (bayU < 0.027 || bayV < 0.025) {
    shade *= 0.65;
    surface = 0.3;
    ao = 0.72;
  }
  shade *= 0.85 + noise(u * 143, v * 31, 446) * 0.3;
  const rivet =
    fine > 0.973 &&
    (fineU % 1) > 0.35 &&
    (fineU % 1) < 0.7 &&
    (fineV % 1) > 0.2 &&
    (fineV % 1) < 0.6;
  if (!seam && rivet) {
    shade = 112 + fine * 14;
    surface += 0.035;
    roughness = 0.52;
  }

  const module = Math.floor(u * 18);
  // Match the hull's physical aspect ratio rather than the atlas pixel ratio.
  const dx = ((u * 18) % 1 - 0.5) * (34.5 / 2.6 / 18);
  const dy =
    v - (module % 2 ? 0.3 : 0.7) - (hash(module, 0, 439) - 0.5) * 0.05;
  const radius = 0.08 + hash(module, 0, 553) * 0.045;
  const distance = Math.hypot(dx, dy) / radius;
  if (distance < 1) {
    const angle = ((Math.atan2(dy, dx) / (Math.PI * 2) + 1) * 12) % 12;
    const seam = angle % 1 < 0.075 || Math.abs(distance - 0.57) < 0.035;
    if (distance > 0.9) {
      shade = 18 + detail * 8;
      surface = 0.25;
      roughness = 0.83;
      ao = 0.58;
    } else if (distance > 0.82) {
      shade = 75 + detail * 15;
      surface = 0.405;
      roughness = 0.56;
      ao = 0.91;
    } else {
      shade = 48 + hash(module, Math.floor(angle), 713) * 18 + detail * 7;
      if (seam) shade *= 0.5;
      if (distance < 0.21) shade *= 1.2;
      if (distance < 0.065) shade = 16;
      surface = 0.27 + distance * 0.07 - (seam ? 0.025 : 0);
      roughness = 0.69;
      ao = 0.8;
    }
  }
  return {
    color: [shade * 0.88, shade, shade * 0.95],
    surface,
    roughness,
    metalness: 0.88,
    ao,
  };
}

async function buildTextures(iteration) {
  const count = ATLAS_WIDTH * ATLAS_HEIGHT;
  const base = Buffer.alloc(count * 3);
  const orm = Buffer.alloc(count * 3);
  const emissive = Buffer.alloc(count * 3);
  const normal = Buffer.alloc(count * 3);
  const heights = new Float32Array(count);

  for (let region = 0; region < REGIONS.length; region++) {
    const { top, height } = REGIONS[region];
    for (let y = top; y < top + height; y++) {
      const v = clamp((y - top - GUTTER) / (height - GUTTER * 2));
      for (let x = 0; x < ATLAS_WIDTH; x++) {
        const u = clamp((x - GUTTER) / (ATLAS_WIDTH - GUTTER * 2));
        const offset = (y * ATLAS_WIDTH + x) * 3;
        const detail = fbm(u * 90, v * 6, 51, 4);
        let color;
        let surface;
        let roughness;
        let metalness;
        let ao = 1;
        let heat = 0;

        if (region === 0) {
          const land = fbm(u * 28, v * 2.8, 27);
          const altitude = smoothstep(0.36, 0.7, land);
          color = [
            mix(38, 194, altitude),
            mix(71, 208, altitude),
            mix(92, 217, altitude),
          ];
          surface = altitude * 0.7 + detail * 0.12;
          roughness = mix(0.3, 0.86, altitude);
          metalness = 0;
          if (iteration >= 3) {
            const {
              land: originalLand,
              mountains,
              continent,
            } = terrain(u, v, iteration);
            const land =
              iteration >= 5
                ? smoothstep(0.41, 0.47, continent)
                : originalLand;
            const ranges =
              iteration >= 5
                ? smoothstep(0.4, 0.67, fbm(u * 43, v * 4.8, 821, 3))
                : 1;
            const highlands = mountains * (0.55 + ranges * 0.75);
            const snow =
              iteration >= 5
                ? smoothstep(
                    0.49,
                    0.76,
                    highlands + smoothstep(0.5, 0.68, continent) * 0.09,
                  )
                : iteration >= 4
                  ? smoothstep(0.4, 0.64, continent + mountains * 0.22)
                  : smoothstep(0.2, 0.54, mountains + detail * 0.1);
            const shallows = smoothstep(
              0.27,
              iteration >= 5 ? 0.45 : 0.42,
              continent,
            );
            const water =
              iteration >= 5
                ? [
                    mix(54, 80, shallows),
                    mix(71, 100, shallows),
                    mix(81, 110, shallows),
                  ]
                : [
                    mix(12, 40, shallows),
                    mix(34, 84, shallows),
                    mix(49, 94, shallows),
                  ];
            const vegetation =
              iteration >= 5 ? fbm(u * 320, v * 24, 593, 4) : detail;
            let rock =
              iteration >= 5
                ? [
                    mix(80, 119, vegetation) + detail * 6,
                    mix(96, 132, vegetation) + detail * 9,
                    mix(83, 120, vegetation) + detail * 5,
                  ]
                : [74 + detail * 26, 91 + detail * 24, 94 + detail * 29];
            if (iteration >= 5) {
              const shore = 1 - smoothstep(0.45, 0.485, continent);
              const stone = smoothstep(0.22, 0.56, highlands);
              rock = rock.map((channel, index) =>
                mix(
                  mix(channel, [121, 129, 126][index] + detail * 17, stone),
                  [132, 141, 136][index],
                  shore * 0.8,
                ),
              );
            }
            const ice = [
              194 + detail * 32,
              207 + detail * 27,
              214 + detail * 25,
            ];
            color = water.map((channel, index) =>
              mix(channel, mix(rock[index], ice[index], snow), land),
            );
            surface =
              land *
              (0.14 +
                (iteration >= 5 ? highlands : mountains) *
                  (iteration >= 4 ? 0.38 : 0.72));
            roughness =
              iteration >= 4
                ? mix(
                    iteration >= 5 ? 0.3 : 0.48,
                    mix(0.93, 0.85, snow),
                    land,
                  )
                : mix(0.2, mix(0.89, 0.73, snow), land);
            ao = mix(1, 0.85 + mountains * 0.15, land);
          }
        } else if (region === 1 && iteration >= 5) {
          ({ color, surface, roughness, metalness, ao } = hullSurface(
            u,
            v,
            detail,
          ));
        } else if (region === 1) {
          const rows = iteration >= 3 ? 14 : 9;
          const columns = iteration >= 3 ? 124 : 76;
          const row = Math.floor(v * rows);
          const column = Math.floor(u * columns + (row % 2) * 0.5);
          const panelX = (u * columns + (row % 2) * 0.5) % 1;
          const panelY = (v * rows) % 1;
          const seam =
            panelX < 0.025 ||
            panelX > 0.975 ||
            panelY < 0.035 ||
            panelY > 0.965;
          const variation =
            iteration >= 2 ? hash(column, row, 92) * 20 - 10 : 0;
          const shade = seam ? 12 : 39 + detail * 37 + variation;
          color = [shade * 0.86, shade * 0.96, shade * 1.08];
          surface = seam ? 0.12 : 0.4 + detail * 0.08;
          roughness = seam ? 0.85 : 0.57;
          metalness = 0.88;
          ao = seam ? 0.55 : 1;
          if (iteration >= 3) {
            const macroX = (u * 22) % 1;
            const macroY = (v * 3) % 1;
            const frame =
              macroX < 0.032 || macroY < 0.045 || Math.abs(v - 0.5) < 0.02;
            const inset =
              panelX > 0.17 &&
              panelX < 0.76 &&
              panelY > 0.22 &&
              panelY < 0.66 &&
              hash(column, row, 183) > 0.33;
            const vent =
              inset && (panelX * 7) % 1 < 0.32 && hash(column, row, 26) > 0.58;
            if (frame) {
              color = [55 + detail * 12, 64 + detail * 13, 71 + detail * 16];
              surface = 0.57;
              roughness = 0.43;
            } else if (inset) {
              color = color.map((channel) => channel * (vent ? 0.28 : 0.65));
              surface = vent ? 0.08 : 0.26;
              roughness = 0.68;
              ao = vent ? 0.45 : 0.8;
            }
          }
        } else if (region === 2) {
          const rib = (u * (iteration >= 5 ? 216 : 108)) % 1 < 0.1;
          const shade =
            iteration >= 5
              ? rib
                ? 27
                : 44 + detail * 12
              : rib
                ? 42
                : 100 + detail * 22;
          color = [shade * 0.85, shade * 0.95, shade];
          surface = rib ? 0.15 : 0.35;
          roughness = iteration >= 5 ? 0.8 : 0.47;
          metalness = 0.9;
        } else {
          color = [28 + detail * 30, 20 + detail * 18, 18 + detail * 15];
          surface = detail;
          roughness = 0.94;
          metalness = 0.2;
          heat = Math.max(0, detail - 0.55) * 1.6;
        }

        if (iteration >= 2 && region < 3) {
          const damage =
            Math.max(
              1 - smoothstep(0.015, 0.14, u),
              smoothstep(0.88, 0.99, u),
            ) * smoothstep(0.15, 0.62, detail);
          color = color.map((channel) => mix(channel, 18 + detail * 9, damage));
          roughness = mix(roughness, 0.96, damage);
          metalness *= 1 - damage * 0.8;
        }

        if (iteration >= 4) {
          const fractureU = region === 3 ? u * 0.09 : u;
          const fractureV = region === 3 ? v * 0.3 : v;
          const warp = fbm(fractureU * 81, fractureV * 7, 781, 3);
          const distance = crackDistance(
            fractureU * 163 + warp * 2.8,
            fractureV * 10 + noise(fractureU * 53, fractureV * 4, 711) * 2,
          );
          const fissure = 1 - smoothstep(0.015, 0.13, distance);
          const ember = smoothstep(0.38, 0.72, warp);
          const endDamage =
            region === 3
              ? 1
              : Math.max(
                  1 - smoothstep(0.025, region === 1 ? 0.5 : 0.13, u),
                  smoothstep(region === 1 ? 0.69 : 0.88, 0.99, u),
                );
          const scars =
            region === 1
              ? Math.max(endDamage, smoothstep(0.51, 0.72, warp) * 0.38)
              : endDamage;
          heat = clamp(fissure * ember * scars * (iteration >= 5 ? 2.05 : 2.7));
          if (iteration >= 5 && region === 1) {
            heat *=
              0.55 +
              smoothstep(
                0.3,
                0.67,
                noise(fractureU * 39, fractureV * 4.5, 223),
              ) *
                0.45;
          }
          const burn =
            scars * smoothstep(0.2, 0.62, warp) * (region === 3 ? 0.9 : 0.88);
          color = color.map((channel, index) =>
            mix(channel, [22, 18, 15][index] + detail * 7, burn),
          );
          color = color.map((channel, index) =>
            mix(channel, [112, 41, 12][index], heat * 0.55),
          );
          surface -= fissure * scars * 0.18;
          roughness = mix(roughness, 0.97, burn);
          metalness *= 1 - burn * 0.9;
          ao *= 1 - fissure * scars * 0.42;
        }

        for (let channel = 0; channel < 3; channel++) {
          base[offset + channel] = Math.round(clamp(color[channel], 0, 255));
        }
        orm[offset] = Math.round(ao * 255);
        orm[offset + 1] = Math.round(roughness * 255);
        orm[offset + 2] = Math.round(metalness * 255);
        emissive[offset] = Math.round(clamp(heat) * 255);
        emissive[offset + 1] = Math.round(
          clamp(heat * (0.16 + heat * 0.27)) * 255,
        );
        emissive[offset + 2] = Math.round(clamp(heat * heat * 0.035) * 255);
        heights[y * ATLAS_WIDTH + x] = surface;
      }
    }
  }

  for (const { top, height } of REGIONS) {
    for (let y = top; y < top + height; y++) {
      for (let x = 0; x < ATLAS_WIDTH; x++) {
        const left = heights[y * ATLAS_WIDTH + Math.max(0, x - 1)];
        const right =
          heights[y * ATLAS_WIDTH + Math.min(ATLAS_WIDTH - 1, x + 1)];
        const up = heights[Math.max(top, y - 1) * ATLAS_WIDTH + x];
        const down =
          heights[Math.min(top + height - 1, y + 1) * ATLAS_WIDTH + x];
        const terrainScale = iteration >= 5 && top === 0 ? 0.55 : 1;
        const nx = (left - right) * 5 * terrainScale;
        const ny = (up - down) * 3 * terrainScale;
        const length = Math.hypot(nx, ny, 1);
        const offset = (y * ATLAS_WIDTH + x) * 3;
        const quantum = iteration >= 3 ? 2 : 1;
        const encode = (component) =>
          clamp(
            Math.round(((component + 1) * 127.5) / quantum) * quantum,
            0,
            255,
          );
        normal[offset] = encode(nx / length);
        normal[offset + 1] = encode(ny / length);
        normal[offset + 2] = encode(1 / length);
      }
    }
  }

  const image = (data) =>
    sharp(data, {
      raw: { width: ATLAS_WIDTH, height: ATLAS_HEIGHT, channels: 3 },
    });
  async function reducedMap(data, quantum = 1) {
    const width = ATLAS_WIDTH / 2;
    const height = ATLAS_HEIGHT / 2;
    const pixels = await image(data).resize(width, height).raw().toBuffer();
    if (quantum > 1) {
      for (let index = 0; index < pixels.length; index++) {
        pixels[index] = Math.min(
          255,
          Math.round(pixels[index] / quantum) * quantum,
        );
      }
    }
    return sharp(pixels, { raw: { width, height, channels: 3 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  const textures = await Promise.all([
    image(base)
      .jpeg({
        quality: iteration >= 5 ? 92 : iteration >= 3 ? 88 : 90,
        chromaSubsampling: '4:4:4',
      })
      .toBuffer(),
    iteration >= 4
      ? reducedMap(normal, iteration >= 5 ? 2 : 1)
      : image(normal).png({ compressionLevel: 9 }).toBuffer(),
    reducedMap(orm, iteration >= 5 ? 4 : 1),
    reducedMap(emissive),
  ]);
  return textures.map((data, index) => ({
    data,
    name: [
      'Base color (sRGB)',
      'Normal (linear)',
      'ORM (linear)',
      'Heat (sRGB)',
    ][index],
    mimeType: index === 0 ? 'image/jpeg' : 'image/png',
    width:
      index === 0 || (index === 1 && iteration < 4)
        ? ATLAS_WIDTH
        : ATLAS_WIDTH / 2,
    height:
      index === 0 || (index === 1 && iteration < 4)
        ? ATLAS_HEIGHT
        : ATLAS_HEIGHT / 2,
    iteration,
  }));
}

export async function generateBrokenRing({ iteration = 5 } = {}) {
  if (!Number.isInteger(iteration) || iteration < 1 || iteration > 5) {
    throw new Error('Iteration must be an integer between 1 and 5.');
  }
  const { meshes, dimensions, arcDegrees } = buildGeometry(iteration);
  const textures = await buildTextures(iteration);
  const stats = {
    iteration,
    triangles: meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0),
    vertices: meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0),
    drawCalls: meshes.length,
    materials: 1,
    dimensions,
    arcDegrees,
    textures: textures.map(({ name, width, height, data, mimeType }) => ({
      name,
      width,
      height,
      bytes: data.length,
      mimeType,
    })),
    textureBytesWithMipmaps: textures.reduce(
      (sum, texture) =>
        sum + Math.ceil((texture.width * texture.height * 4 * 4) / 3),
      0,
    ),
    geometryBytes: meshes.reduce(
      (sum, mesh) =>
        sum +
        mesh.positions.byteLength +
        mesh.normals.byteLength +
        mesh.tangents.byteLength +
        mesh.uvs.byteLength +
        mesh.indices.byteLength,
      0,
    ),
    budget: iteration === 5 ? MODEL_BUDGET : ITERATION_BUDGET,
  };
  const glb = writePbrGlb(meshes, textures, stats, {
    generator: 'Deterministic broken-ring asset builder',
    sceneName: 'Broken space ring',
    rootName: 'Broken space ring / +Y up / ring in XY / width along Z',
    materialName: 'Habitat, titanium shell and heated fractures / packed PBR',
  });
  stats.fileBytes = glb.byteLength;
  const validation = await validateBytes(new Uint8Array(glb), {
    maxIssues: 30,
  });
  stats.validation = {
    errors: validation.issues.numErrors,
    warnings: validation.issues.numWarnings,
  };
  if (stats.validation.errors || stats.validation.warnings) {
    throw new Error(
      `GLB validation failed:\n${JSON.stringify(validation.issues, null, 2)}`,
    );
  }
  for (const [key, maximum] of Object.entries(stats.budget)) {
    if (stats[key] > maximum) {
      throw new Error(`${key}: ${stats[key]} exceeds the ${maximum} budget.`);
    }
  }
  return { glb, stats };
}

async function main(args) {
  let output = 'public/models/broken-ring.glb';
  let iteration = 5;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help') {
      console.log(
        'Usage: npm run models:build -- [--iteration 1..5] [--output path.glb]',
      );
      return;
    }
    if (argument !== '--output' && argument !== '--iteration') {
      throw new Error(`Unknown option: ${argument}`);
    }
    const value = args[++index];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value.`);
    }
    if (argument === '--output') output = value;
    else iteration = Number(value);
  }
  if (path.extname(output) !== '.glb') {
    throw new Error('The output path must end in .glb.');
  }
  const { glb, stats } = await generateBrokenRing({ iteration });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, glb);
  await writeFile(
    output.replace(/\.glb$/, '.metrics.json'),
    `${JSON.stringify(stats, null, 2)}\n`,
  );
  console.log(`${output}\n${JSON.stringify(stats, null, 2)}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
