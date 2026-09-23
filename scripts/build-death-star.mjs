import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { validateBytes } from 'gltf-validator';
import {
  computeBounds,
  computeTangents,
  createTriangleIndices,
} from '../src/engine/gltf/mesh.mjs';
import {
  clamp,
  mix,
  smoothstep,
  random,
  hash,
  noise,
} from './lib/procedural.mjs';
import { writePbrGlb } from './lib/write-pbr-glb.mjs';

export const STATION_BUDGET = {
  triangles: 15000,
  drawCalls: 2,
  fileBytes: 3 * 1024 * 1024,
  textureBytesWithMipmaps: 20 * 1024 * 1024,
};

const WIDTH = 2048;
const HEIGHT = 1024;
const GUTTER = 8;
const RADIUS = 10;
const DISH_RADIUS = 3.05;
const DISH_ANGLE = Math.asin(DISH_RADIUS / RADIUS);
const REGIONS = [
  { x: 0, y: 0, width: 1536, height: 1024 },
  { x: 1536, y: 0, width: 512, height: 512 },
  { x: 1536, y: 512, width: 512, height: 512 },
];
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (v, s) => v.map((value) => value * s);
const add = (a, b) => a.map((value, i) => value + b[i]);
const subtract = (a, b) => a.map((value, i) => value - b[i]);
const normalize = (v) => scale(v, 1 / Math.hypot(...v));
const DISH_AXIS = normalize([-0.32, 0.36, 0.875]);
const DISH_U = normalize(cross([0, 1, 0], DISH_AXIS));
const DISH_V = cross(DISH_AXIS, DISH_U);

function uv(region, u, v) {
  const rect = REGIONS[region];
  return [
    (rect.x + GUTTER + clamp(u) * (rect.width - 2 * GUTTER)) / WIDTH,
    (rect.y + GUTTER + clamp(v) * (rect.height - 2 * GUTTER)) / HEIGHT,
  ];
}

function direction(alpha, beta) {
  return add(
    scale(DISH_AXIS, Math.cos(alpha)),
    scale(
      add(scale(DISH_U, Math.cos(beta)), scale(DISH_V, Math.sin(beta))),
      Math.sin(alpha),
    ),
  );
}

function shellBoundary(y, iteration) {
  if (iteration < 3 && Math.abs(y) < 0.045) return 1.1;
  if (iteration === 1) return y > 0 ? 0.36 : 0.19;
  const latitude = Math.abs(y);
  const base =
    y > 0
      ? 0.38 - latitude * 0.43
      : 0.04 + smoothstep(0.48, 0.96, latitude) * 0.34;
  return (
    base +
    (iteration >= 5
      ? (hash(Math.floor((y * RADIUS) / 0.26), 74, 621) - 0.5) * 0.125 +
        Math.sin(y * 21) * 0.025
      : 0)
  );
}

function shellPresent(n, iteration, inset = 0) {
  const boundary = shellBoundary(n[1], iteration) + inset;
  return n[0] <= boundary;
}

class Mesh {
  constructor(name, { doubleSided = false } = {}) {
    this.name = name;
    this.doubleSided = doubleSided;
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.indices = [];
  }

  polygon(points, coords, normals) {
    if (points.length < 3) return;
    let area;
    for (let i = 1; i < points.length - 1; i++) {
      const candidate = cross(
        subtract(points[i], points[0]),
        subtract(points[i + 1], points[0]),
      );
      if (Math.hypot(...candidate) > 1e-9) {
        area = candidate;
        break;
      }
    }
    if (!area) return;
    const face = normalize(area);
    if (!face.every(Number.isFinite))
      throw new Error(`Degenerate face in ${this.name}.`);
    const start = this.positions.length / 3;
    for (let i = 0; i < points.length; i++) {
      this.positions.push(...points[i]);
      this.normals.push(...(normals?.[i] ?? face));
      this.uvs.push(...coords[i]);
    }
    for (let i = 1; i < points.length - 1; i++) {
      if (
        Math.hypot(
          ...cross(
            subtract(points[i], points[0]),
            subtract(points[i + 1], points[0]),
          ),
        ) > 1e-9
      ) {
        this.indices.push(start, start + i, start + i + 1);
      }
    }
  }

  quad(points, region, u = 0, v = 0, width = 0.1, height = 0.1) {
    this.polygon(points, [
      uv(region, u, v),
      uv(region, u + width, v),
      uv(region, u + width, v + height),
      uv(region, u, v + height),
    ]);
  }

  beam(a, b, width, depth = width, texture = 0.1) {
    const along = normalize(subtract(b, a));
    const across = normalize(
      cross(along, Math.abs(along[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]),
    );
    const up = cross(along, across);
    const corners = [a, b].flatMap((center) => [
      add(add(center, scale(across, -width / 2)), scale(up, -depth / 2)),
      add(add(center, scale(across, width / 2)), scale(up, -depth / 2)),
      add(add(center, scale(across, width / 2)), scale(up, depth / 2)),
      add(add(center, scale(across, -width / 2)), scale(up, depth / 2)),
    ]);
    for (const face of [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ]) {
      this.quad(
        face.map((index) => corners[index]),
        1,
        texture,
        0.2,
        0.025,
        0.12,
      );
    }
  }

  finish(weld = false) {
    let positions = new Float32Array(this.positions);
    let normals = new Float32Array(this.normals);
    let uvs = new Float32Array(this.uvs);
    let sourceIndices = this.indices;
    if (weld) {
      const unique = new Map();
      const vertices = [];
      const remap = new Map();
      const p = [],
        n = [],
        t = [];
      for (const index of sourceIndices) {
        if (remap.has(index)) continue;
        const values = [
          ...positions.subarray(index * 3, index * 3 + 3),
          ...normals.subarray(index * 3, index * 3 + 3),
          ...uvs.subarray(index * 2, index * 2 + 2),
        ];
        const key = values.join(',');
        let target = unique.get(key);
        if (target === undefined) {
          target = vertices.length;
          unique.set(key, target);
          vertices.push(index);
          p.push(...values.slice(0, 3));
          n.push(...values.slice(3, 6));
          t.push(...values.slice(6, 8));
        }
        remap.set(index, target);
      }
      sourceIndices = sourceIndices.map((index) => remap.get(index));
      positions = new Float32Array(p);
      normals = new Float32Array(n);
      uvs = new Float32Array(t);
    }
    const indices = createTriangleIndices(sourceIndices, positions.length / 3);
    const tangents = computeTangents(positions, normals, uvs, indices);
    return {
      name: this.name,
      doubleSided: this.doubleSided,
      positions,
      normals,
      uvs,
      indices,
      tangents,
      ...computeBounds(positions),
    };
  }
}

function clipPolygon(vertices, distance) {
  const output = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const da = distance(a.point);
    const db = distance(b.point);
    if (da >= 0) output.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      output.push({
        point: a.point.map((value, axis) => mix(value, b.point[axis], t)),
        normal: normalize(
          a.normal.map((value, axis) => mix(value, b.normal[axis], t)),
        ),
        uv: a.uv.map((value, axis) => mix(value, b.uv[axis], t)),
      });
    }
  }
  return output;
}

function shell(
  mesh,
  { radius, rings, segments, region, iteration, inset = 0, closed = false },
) {
  const startAngle = closed ? 0 : DISH_ANGLE;
  for (let row = 0; row < rings; row++) {
    const a0 = mix(startAngle, Math.PI, row / rings);
    const a1 = mix(startAngle, Math.PI, (row + 1) / rings);
    for (let column = 0; column < segments; column++) {
      const b0 = (column / segments) * Math.PI * 2;
      const b1 = ((column + 1) / segments) * Math.PI * 2;
      const mid = direction((a0 + a1) / 2, (b0 + b1) / 2);
      let recessed = false;
      if (!closed && iteration >= 4) {
        const boundary = shellBoundary(mid[1], iteration);
        if (region === 1 && mid[0] < boundary - 0.16) continue;
        const lowerBays =
          mid[1] < -0.25 &&
          mid[1] > -0.62 &&
          mid[0] > -0.76 &&
          mid[0] < 0.08 &&
          Math.abs(mid[2]) > 0.35;
        if (
          region === 0 &&
          lowerBays &&
          noise(mid[0] * 22, mid[1] * 57, 329) > 0.53
        ) {
          if (iteration < 5) continue;
          recessed = mid[0] > -0.1 && hash(row, column, 552) > 0.5;
        }
      }
      if (!closed && iteration === 1 && !shellPresent(mid, iteration, inset))
        continue;
      const normals = [
        direction(a0, b0),
        direction(a1, b0),
        direction(a1, b1),
        direction(a0, b1),
      ];
      const points = normals.map((n) =>
        scale(n, recessed ? radius - 0.25 : radius),
      );
      const coords = [
        uv(region, column / segments, row / rings),
        uv(region, column / segments, (row + 1) / rings),
        uv(region, (column + 1) / segments, (row + 1) / rings),
        uv(region, (column + 1) / segments, row / rings),
      ];
      if (recessed) {
        const u = hash(row, column, 819) * 0.65;
        const v = hash(row, column, 828) * 0.65;
        coords.splice(
          0,
          4,
          uv(1, u, v),
          uv(1, u, v + 0.25),
          uv(1, u + 0.25, v + 0.25),
          uv(1, u + 0.25, v),
        );
        const surface = normals.map((n) => scale(n, radius));
        for (let edge = 0; edge < 4; edge++) {
          const next = (edge + 1) % 4;
          mesh.quad(
            [surface[edge], points[edge], points[next], surface[next]],
            1,
            u,
            v,
            0.035,
            0.12,
          );
        }
      }
      if (!closed && iteration >= 2) {
        let polygon = points.map((point, index) => ({
          point,
          uv: coords[index],
          normal: normals[index],
        }));
        if (row === rings - 1) polygon.splice(2, 1);
        let parts;
        if (iteration >= 3 && region === 0) {
          const cut = (part) => {
            if (
              iteration < 5 ||
              Math.abs(mid[0] - shellBoundary(mid[1], iteration)) > 0.2
            ) {
              return [
                clipPolygon(
                  part,
                  (p) =>
                    shellBoundary(p[1] / radius, iteration) - p[0] / radius,
                ),
              ];
            }
            const result = [];
            const first = Math.floor(
              Math.min(...part.map((v) => v.point[1])) / 0.26,
            );
            const last = Math.floor(
              Math.max(...part.map((v) => v.point[1])) / 0.26,
            );
            for (let layer = first; layer <= last; layer++) {
              const bottom = layer * 0.26;
              const top = bottom + 0.26;
              const sliced = clipPolygon(
                clipPolygon(part, (p) => p[1] - bottom),
                (p) => top - p[1],
              );
              const limit =
                shellBoundary((bottom + top) / (2 * radius), iteration) *
                radius;
              result.push(clipPolygon(sliced, (p) => limit - p[0]));
            }
            return result;
          };
          parts = [
            ...cut(clipPolygon(polygon, (p) => p[1] - 0.42)),
            ...cut(clipPolygon(polygon, (p) => -p[1] - 0.42)),
            clipPolygon(
              clipPolygon(polygon, (p) => 0.42 - p[1]),
              (p) => p[1] - 0.1,
            ),
            clipPolygon(
              clipPolygon(polygon, (p) => p[1] + 0.42),
              (p) => -p[1] - 0.1,
            ),
          ];
        } else {
          polygon = clipPolygon(
            polygon,
            (p) =>
              shellBoundary(p[1] / radius, iteration) + inset - p[0] / radius,
          );
          parts =
            region === 0
              ? [
                  clipPolygon(polygon, (p) => p[1] - 0.1),
                  clipPolygon(polygon, (p) => -p[1] - 0.1),
                ]
              : [polygon];
        }
        for (const part of parts) {
          mesh.polygon(
            part.map((v) => v.point),
            part.map((v) => v.uv),
            part.map((v) => v.normal),
          );
        }
      } else if (row === rings - 1) {
        mesh.polygon(
          [points[0], points[1], points[3]],
          [coords[0], coords[1], coords[3]],
          [normals[0], normals[1], normals[3]],
        );
      } else {
        mesh.polygon(points, coords, normals);
      }
    }
  }
}

function dish(mesh, iteration) {
  const depth = iteration >= 3 ? 1.0 : 1.3;
  const lip = Math.sqrt(RADIUS * RADIUS - DISH_RADIUS * DISH_RADIUS);
  const position = (r, angle) =>
    add(
      scale(DISH_AXIS, lip - depth * (1 - (r / DISH_RADIUS) ** 2)),
      add(
        scale(DISH_U, Math.cos(angle) * r),
        scale(DISH_V, Math.sin(angle) * r),
      ),
    );
  const normal = (r, angle) =>
    normalize(
      subtract(
        DISH_AXIS,
        scale(
          add(scale(DISH_U, Math.cos(angle)), scale(DISH_V, Math.sin(angle))),
          (2 * depth * r) / (DISH_RADIUS * DISH_RADIUS),
        ),
      ),
    );
  const coords = (r, angle) =>
    uv(
      2,
      0.5 + (Math.cos(angle) * r) / (2 * DISH_RADIUS),
      0.5 + (Math.sin(angle) * r) / (2 * DISH_RADIUS),
    );
  const rings = 9;
  const sectors = iteration >= 5 ? 64 : 72;
  for (let row = 0; row < rings; row++) {
    const inner = (row / rings) * DISH_RADIUS;
    const outer = ((row + 1) / rings) * DISH_RADIUS;
    for (let sector = 0; sector < sectors; sector++) {
      const a = (sector / sectors) * Math.PI * 2;
      const b = ((sector + 1) / sectors) * Math.PI * 2;
      const vertices =
        row === 0
          ? [
              [inner, a],
              [outer, a],
              [outer, b],
            ]
          : [
              [inner, a],
              [outer, a],
              [outer, b],
              [inner, b],
            ];
      mesh.polygon(
        vertices.map(([r, angle]) => position(r, angle)),
        vertices.map(([r, angle]) => coords(r, angle)),
        vertices.map(([r, angle]) => normal(r, angle)),
      );
    }
  }
}

function belt(mesh, y0, y1, radius, region, v = 0.85) {
  for (let segment = 0; segment < 128; segment++) {
    const a = (segment / 128) * Math.PI * 2;
    const b = ((segment + 1) / 128) * Math.PI * 2;
    const at = (y, theta) => [
      Math.sin(theta) * radius,
      y,
      Math.cos(theta) * radius,
    ];
    mesh.quad(
      [at(y0, a), at(y0, b), at(y1, b), at(y1, a)],
      region,
      segment / 128,
      v,
      1 / 128,
      0.05,
    );
  }
}

function hullUV(n) {
  const alpha = Math.acos(clamp(dot(n, DISH_AXIS), -1, 1));
  const beta =
    (Math.atan2(dot(n, DISH_V), dot(n, DISH_U)) + Math.PI * 2) % (Math.PI * 2);
  return uv(
    0,
    beta / (Math.PI * 2),
    (alpha - DISH_ANGLE) / (Math.PI - DISH_ANGLE),
  );
}

function armorPatch(mesh, x0, x1, y0, y1, side) {
  const point = (x, y) => [
    x,
    y,
    side * Math.sqrt(Math.max(0.002, RADIUS * RADIUS - x * x - y * y)),
  ];
  let points = [point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)];
  if (side < 0) points = points.reverse();
  const normals = points.map(normalize);
  const inner = points.map((p) => scale(p, 0.993));
  const coords = normals.map(hullUV);
  mesh.polygon(points, coords, normals);
  mesh.polygon(
    [...inner].reverse(),
    [...coords].reverse(),
    [...normals].reverse().map((n) => scale(n, -1)),
  );
  for (const index of [1, 2]) {
    const next = (index + 1) % 4;
    mesh.quad(
      [points[index], inner[index], inner[next], points[next]],
      1,
      0.5,
      0.6,
      0.03,
      0.01,
    );
  }
}

function fragmentedArmor(mesh, iteration) {
  const rng = random(32983);
  for (const side of [1, -1]) {
    for (let row = 0; row < 90; row++) {
      const y0 = -9.65 + (row * 19.3) / 89;
      if (Math.abs(y0) < 0.5) continue;
      const y1 =
        y0 + (iteration >= 5 ? 0.025 + rng() * 0.12 : 0.045 + rng() * 0.19);
      const halfWidth =
        Math.sqrt(RADIUS * RADIUS - Math.max(y0 * y0, y1 * y1)) - 0.025;
      const boundary =
        shellBoundary((y0 + y1) / (2 * RADIUS), iteration) * RADIUS;
      const x0 = boundary - 0.32 - rng() * 0.22;
      const x1 = Math.min(halfWidth, boundary + 0.18 + rng() ** 1.5 * 1.95);
      if (x0 < -halfWidth || x0 >= x1 || halfWidth < 0.1) continue;
      armorPatch(mesh, x0, x1, y0, y1, side);
      if (rng() < 0.34 && x1 + 0.6 < halfWidth) {
        const a = x1 + 0.1 + rng() * 0.6;
        const b = Math.min(halfWidth, a + 0.1 + rng() * 0.5);
        armorPatch(mesh, a, b, y0, Math.min(y1, y0 + 0.12), side);
      }
    }
  }
}

function internalPanels(mesh) {
  const rng = random(11983);
  for (let i = 0; i < 160; i++) {
    const y = -8.8 + rng() * 17.6;
    const r = Math.sqrt(100 - y * y) * (0.7 + rng() * 0.16);
    const angle = 0.24 + rng() * (Math.PI - 0.48);
    const y1 = y + 0.08 + rng() * 0.22;
    const angle1 = angle + 0.018 + rng() * 0.11;
    const at = (theta, height, scale = 1) => [
      r * Math.sin(theta) * scale,
      height,
      r * Math.cos(theta) * scale,
    ];
    const front = [at(angle, y), at(angle1, y), at(angle1, y1), at(angle, y1)];
    const u = rng() * 0.7;
    const v = rng() * 0.7;
    mesh.quad(front, 1, u, v, 0.17, 0.07);
    mesh.quad(
      [
        at(angle, y1, 0.991),
        at(angle1, y1, 0.991),
        at(angle1, y, 0.991),
        at(angle, y, 0.991),
      ],
      1,
      u,
      v,
      0.17,
      0.07,
    );
  }
}

function buildGeometry(iteration) {
  const body = new Mesh(
    'Unfinished battle station / armor and recessed dish',
    { doubleSided: true },
  );
  const skeleton = new Mesh(
    'Unfinished battle station / interior, decks and framework',
  );
  shell(body, {
    radius: RADIUS,
    rings: 44,
    segments: iteration >= 5 ? 88 : 96,
    region: 0,
    iteration,
  });
  dish(body, iteration);
  if (iteration === 1) {
    belt(body, -0.07, 0.07, RADIUS + 0.012, 1);
  } else {
    belt(body, -0.095, 0.095, RADIUS - 0.12, 1);
    for (const sign of [-1, 1]) {
      const y = sign * 0.1;
      for (let segment = 0; segment < 128; segment++) {
        const a = (segment / 128) * Math.PI * 2;
        const b = ((segment + 1) / 128) * Math.PI * 2;
        const at = (r, theta) => [Math.sin(theta) * r, y, Math.cos(theta) * r];
        const points = [at(9.88, a), at(10, a), at(10, b), at(9.88, b)];
        body.quad(
          sign < 0 ? points : points.reverse(),
          1,
          segment / 128,
          0.1,
          1 / 128,
          0.05,
        );
      }
    }
  }
  shell(skeleton, {
    radius: 8.1,
    rings: iteration >= 5 ? 10 : iteration >= 4 ? 14 : 18,
    segments: iteration >= 5 ? 24 : iteration >= 4 ? 40 : 48,
    region: 1,
    iteration,
    inset: 0.2,
    closed: iteration >= 5,
  });
  if (iteration >= 4) fragmentedArmor(body, iteration);
  if (iteration >= 5) internalPanels(skeleton);
  const rng = random(1983);
  const levels =
    iteration >= 5 ? 59 : iteration >= 4 ? 63 : iteration >= 2 ? 45 : 25;
  const sectors = iteration >= 4 ? 8 : iteration >= 2 ? 10 : 12;
  for (let row = 0; row < levels; row++) {
    const y = -9.2 + (row * 18.4) / (levels - 1);
    const span = Math.sqrt(RADIUS * RADIUS - y * y);
    const boundary = shellBoundary(y / RADIUS, iteration) * RADIUS;
    if (boundary >= span) continue;
    const start = Math.asin(clamp(boundary / span, -0.8, 0.98));
    for (let sector = 0; sector < sectors; sector++) {
      if (rng() < 0.2) continue;
      const a =
        mix(start, Math.PI - start, sector / sectors) +
        (iteration >= 5 ? rng() * 0.07 : 0);
      const b =
        mix(start, Math.PI - start, (sector + 1) / sectors) -
        (iteration >= 5 ? 0.01 + rng() * 0.075 : 0.012);
      const outerScale =
        iteration >= 4
          ? 0.79 + 0.19 * (1 - Math.abs(y) / 10) + rng() * 0.035
          : 0.88 + rng() * 0.1;
      const outer =
        span * (iteration >= 5 ? Math.min(0.985, outerScale) : outerScale);
      const inner =
        iteration >= 2
          ? outer - 0.16 - rng() * 0.55
          : span * (0.66 + rng() * 0.12);
      const at = (r, theta, dy) => [
        r * Math.sin(theta),
        y + dy,
        r * Math.cos(theta),
      ];
      skeleton.quad(
        [at(inner, a, 0), at(outer, a, 0), at(outer, b, 0), at(inner, b, 0)],
        1,
        rng() * 0.8,
        0.1,
        0.12,
        0.24,
      );
      skeleton.quad(
        [
          at(inner, b, -0.06),
          at(outer, b, -0.06),
          at(outer, a, -0.06),
          at(inner, a, -0.06),
        ],
        1,
        rng() * 0.8,
        0.35,
        0.12,
        0.24,
      );
      skeleton.quad(
        [
          at(outer, a, -0.06),
          at(outer, b, -0.06),
          at(outer, b, 0),
          at(outer, a, 0),
        ],
        1,
        rng() * 0.8,
        0.6,
        0.15,
        0.025,
      );
      if (iteration >= 2 && row > 0 && row < levels - 1 && rng() < 0.26) {
        const theta = (a + b) / 2;
        skeleton.beam(
          at((outer + inner) / 2, theta, -0.04),
          at((outer + inner) / 2, theta, 0.48),
          0.05,
          0.05,
          rng() * 0.8,
        );
      }
    }
  }
  return [body.finish(iteration >= 5), skeleton.finish(iteration >= 5)];
}

function hullPattern(n, iteration) {
  const lon = Math.atan2(n[0], n[2]) / (2 * Math.PI) + 0.5;
  const lat = Math.asin(clamp(n[1], -1, 1)) / Math.PI + 0.5;
  if (iteration >= 3) {
    const row = Math.floor(lat * 18);
    const column = Math.floor(lon * 76);
    const px = (lon * 76) % 1;
    const py = (lat * 18) % 1;
    const panel = hash(column, row, 971);
    const smallX = (lon * 384) % 1;
    const smallRows = iteration >= 4 ? 90 : 192;
    const smallY = (lat * smallRows) % 1;
    const cell = hash(Math.floor(lon * 384), Math.floor(lat * smallRows), 179);
    const moduleX = (lon * 152 + (Math.floor(lat * 72) % 2) * 0.5) % 1;
    const moduleY = (lat * 72) % 1;
    const longLine =
      (lon * 540) % 1 < 0.12 &&
      hash(Math.floor(lon * 540), Math.floor(lat * 36), 982) > 0.4;
    const seam = px < 0.026 || py < 0.018;
    const module =
      moduleX > 0.2 && moduleX < 0.85 && moduleY > 0.22 && moduleY < 0.75;
    const recess =
      smallX > 0.12 &&
      smallX < (iteration >= 4 ? 0.38 : 0.7) &&
      smallY > 0.2 &&
      smallY < 0.75 &&
      cell > (iteration >= 4 ? 0.74 : 0.63);
    let shade = 117 * (0.88 + panel * 0.24);
    shade *= seam ? 0.71 : longLine ? 0.81 : recess ? 0.66 : module ? 0.92 : 1;
    let exposed = 0;
    if (iteration >= 5) {
      const belt =
        smoothstep(0.16, 0.27, -n[1]) * (1 - smoothstep(0.53, 0.67, -n[1]));
      const side =
        smoothstep(-0.88, -0.66, n[0]) * (1 - smoothstep(0.04, 0.2, n[0]));
      const bays =
        noise(n[0] * 8, n[1] * 19, 324) +
        (hash(Math.floor(lat * 250), 72, 244) - 0.5) * 0.23;
      exposed = belt * side * smoothstep(0.33, 0.61, bays);
      const rail = (lat * 320) % 1 < 0.16 ? 31 : 0;
      shade = mix(
        shade,
        21 +
          hash(Math.floor(lon * 420), Math.floor(lat * 250), 426) * 31 +
          rail,
        exposed,
      );
    }
    return {
      color: [shade, shade * (124 / 117), shade * (132 / 117)],
      height:
        (seam ? 0.18 : recess ? 0.2 : longLine ? 0.24 : module ? 0.28 : 0.31) -
        exposed * 0.075,
      roughness: 0.65 + panel * 0.15,
      metalness: 1,
      ao: (seam || recess ? 0.69 : 1) * (1 - exposed * 0.3),
    };
  }
  const row = Math.floor(lat * 34);
  const column = Math.floor(lon * 112 + (row % 2) * 0.3);
  const u = (lon * 112 + (row % 2) * 0.3) % 1;
  const v = (lat * 34) % 1;
  const seam = u < 0.034 || v < 0.034;
  const shade = seam
    ? 52
    : 114 + hash(column, row, 87) * 30 + noise(lon * 340, lat * 160, 712) * 9;
  return {
    color: [shade * 0.96, shade * 0.98, shade * 1.04],
    height: seam ? 0.18 : 0.35,
    roughness: seam ? 0.84 : 0.68,
    metalness: seam ? 0.55 : 0.72,
    ao: seam ? 0.65 : 1,
    light: 0,
    iteration,
  };
}

function pattern(region, u, v, iteration) {
  if (region === 0)
    return hullPattern(
      direction(mix(DISH_ANGLE, Math.PI, v), u * Math.PI * 2),
      iteration,
    );
  if (region === 2) {
    const x = (u - 0.5) * 2;
    const y = (v - 0.5) * 2;
    const distance = Math.hypot(x, y);
    const angle = (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1;
    const sector = Math.floor(angle * 24);
    const radialLine = (angle * 24) % 1 < 0.026;
    const circularLine = (distance * 8) % 1 < 0.025;
    let shade = 64 + hash(sector, Math.floor(distance * 8), 94) * 30;
    if (radialLine || circularLine) shade *= 0.65;
    if (distance < 0.065) shade = 15;
    if (distance > 0.93) shade += 24;
    if (iteration >= 3) {
      shade = 78 + hash(sector, Math.floor(distance * 5), 94) * 10;
      shade *= radialLine || circularLine ? 0.78 : 1;
      shade *= (angle * 8) % 1 < 0.045 ? 0.7 : 1;
      if (distance < 0.033) shade = 11;
      if (distance > 0.96) shade = 119 + noise(u * 40, v * 40, 772) * 9;
    }
    return {
      color: [shade * 0.96, shade * 0.98, shade * 1.04],
      height: radialLine || circularLine ? 0.1 : 0.23,
      roughness: 0.75,
      metalness: 1,
      ao: distance < 0.065 ? 0.45 : 0.9,
      light: 0,
    };
  }
  const row = Math.floor(v * 24);
  const column = Math.floor(u * 36);
  const line = (v * 24) % 1 < 0.22;
  const inset = (u * 36) % 1 < 0.25 && hash(column, row, 161) > 0.25;
  let shade = 44 + hash(column, row, 144) * 28;
  if (line || inset) shade *= 0.45;
  if (iteration >= 3) {
    const grid = hash(Math.floor(u * 82), Math.floor(v * 95), 144);
    const rail = (v * 95) % 1 < 0.19;
    shade = 62 + grid * 44;
    if (rail) shade *= 0.42;
    if ((u * 82) % 1 < 0.14) shade *= 0.58;
    if (grid > 0.9 && (u * 82) % 1 > 0.4 && (u * 82) % 1 < 0.7) shade += 35;
  }
  return {
    color: [shade * 0.9, shade * 0.95, shade],
    height: line || inset ? 0.1 : 0.4,
    roughness: 0.8,
    metalness: 1,
    ao: line || inset ? 0.55 : 0.88,
    light: 0,
  };
}

async function buildTextures(iteration) {
  const base = Buffer.alloc(WIDTH * HEIGHT * 3);
  const orm = Buffer.alloc(WIDTH * HEIGHT * 3);
  const emission = Buffer.alloc(WIDTH * HEIGHT * 3);
  const normal = Buffer.alloc(WIDTH * HEIGHT * 3);
  const height = new Float32Array(WIDTH * HEIGHT);
  for (const [region, rect] of REGIONS.entries()) {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      const v = clamp((y - rect.y - GUTTER) / (rect.height - 2 * GUTTER));
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const u = clamp((x - rect.x - GUTTER) / (rect.width - 2 * GUTTER));
        const sample = pattern(region, u, v, iteration);
        const offset = (y * WIDTH + x) * 3;
        sample.color.forEach((value, i) => {
          base[offset + i] = Math.round(clamp(value, 0, 255));
        });
        orm[offset] = Math.round(sample.ao * 255);
        orm[offset + 1] = Math.round(sample.roughness * 255);
        orm[offset + 2] = Math.round(sample.metalness * 255);
        height[y * WIDTH + x] = sample.height;
      }
    }
  }
  for (const rect of REGIONS) {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const dx =
          height[y * WIDTH + Math.max(rect.x, x - 1)] -
          height[y * WIDTH + Math.min(rect.x + rect.width - 1, x + 1)];
        const dy =
          height[Math.max(rect.y, y - 1) * WIDTH + x] -
          height[Math.min(rect.y + rect.height - 1, y + 1) * WIDTH + x];
        const n = normalize([dx * 2.6, dy * 2.6, 1]);
        for (let c = 0; c < 3; c++)
          normal[(y * WIDTH + x) * 3 + c] = Math.round((n[c] + 1) * 127.5);
      }
    }
  }
  const raw = (data) =>
    sharp(data, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } });
  const reduced = async (data, quantum) => {
    const pixels = await raw(data)
      .resize(WIDTH / 2, HEIGHT / 2)
      .raw()
      .toBuffer();
    for (let i = 0; i < pixels.length; i++)
      pixels[i] = Math.min(255, Math.round(pixels[i] / quantum) * quantum);
    return sharp(pixels, {
      raw: { width: WIDTH / 2, height: HEIGHT / 2, channels: 3 },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
  };
  const maps = await Promise.all([
    raw(base).jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toBuffer(),
    reduced(normal, 2),
    reduced(orm, 4),
    reduced(emission, 1),
  ]);
  return maps.map((data, index) => ({
    data,
    name: [
      'Hull plating (sRGB)',
      'Panel relief (linear)',
      'Packed ORM (linear)',
      'Unlit emission (sRGB)',
    ][index],
    mimeType: index === 0 ? 'image/jpeg' : 'image/png',
    width: index === 0 ? WIDTH : WIDTH / 2,
    height: index === 0 ? HEIGHT : HEIGHT / 2,
  }));
}

export async function generateDeathStar({ iteration = 5 } = {}) {
  if (!Number.isInteger(iteration) || iteration < 1 || iteration > 5)
    throw new Error('Iteration must be an integer between 1 and 5.');
  const meshes = buildGeometry(iteration);
  const textures = await buildTextures(iteration);
  const stats = {
    iteration,
    triangles: meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0),
    vertices: meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0),
    drawCalls: meshes.length,
    materials: new Set(meshes.map((mesh) => mesh.doubleSided)).size,
    dimensions: {
      radius: RADIUS,
      dishRadius: DISH_RADIUS,
      dishDepth: iteration >= 3 ? 1 : 1.3,
    },
    textures: textures.map(({ data, ...texture }) => ({
      ...texture,
      bytes: data.length,
    })),
    textureBytesWithMipmaps: textures.reduce(
      (sum, t) => sum + Math.ceil((t.width * t.height * 4 * 4) / 3),
      0,
    ),
    geometryBytes: meshes.reduce(
      (sum, mesh) =>
        sum +
        mesh.positions.byteLength +
        mesh.normals.byteLength +
        mesh.uvs.byteLength +
        mesh.tangents.byteLength +
        mesh.indices.byteLength,
      0,
    ),
    budget: STATION_BUDGET,
  };
  const glb = writePbrGlb(meshes, textures, stats, {
    generator: 'Deterministic unfinished battle-station builder',
    sceneName: 'Unfinished battle station / reference-inspired Death Star II',
    rootName: 'Battle station / center origin / +Y up / front +Z',
    materialName: 'Cold painted armor, machinery and dish / packed PBR',
    material: {
      metallicFactor: 0.4,
      normalScale: 1.5,
      occlusionStrength: 1,
      emissiveFactor: [0, 0, 0],
    },
  });
  stats.fileBytes = glb.byteLength;
  const validation = await validateBytes(new Uint8Array(glb), {
    maxIssues: 40,
  });
  stats.validation = {
    errors: validation.issues.numErrors,
    warnings: validation.issues.numWarnings,
  };
  if (stats.validation.errors || stats.validation.warnings)
    throw new Error(
      `GLB validation failed:\n${JSON.stringify(validation.issues, null, 2)}`,
    );
  for (const [key, maximum] of Object.entries(STATION_BUDGET)) {
    if (stats[key] > maximum)
      throw new Error(`${key}: ${stats[key]} exceeds the ${maximum} budget.`);
  }
  return { glb, stats };
}

async function main(args) {
  let output = 'public/models/death-star-ii.glb';
  let iteration = 5;
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument === '--help') {
      console.log(
        'Usage: npm run models:death-star -- [--iteration 1..5] [--output path.glb]',
      );
      return;
    }
    if (argument !== '--output' && argument !== '--iteration')
      throw new Error(`Unknown option: ${argument}`);
    const value = args[++i];
    if (!value || value.startsWith('--'))
      throw new Error(`${argument} requires a value.`);
    if (argument === '--output') output = value;
    else iteration = Number(value);
  }
  if (path.extname(output) !== '.glb')
    throw new Error('Output path must end in .glb.');
  const { glb, stats } = await generateDeathStar({ iteration });
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
