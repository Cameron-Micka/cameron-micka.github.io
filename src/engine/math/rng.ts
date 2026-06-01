// Deterministic seeding utilities used for procedural planet generation.

// 32-bit string hash (FNV-1a variant) → seed integer.
export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 PRNG — fast, deterministic, returns [0, 1).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

import type { Vec3 } from './vec3';

// Approximate Poisson-disk distribution of N points on a unit sphere via a
// seeded Fibonacci-sphere with jitter. Deterministic for a given seed.
export function fibonacciSpherePoints(count: number, seed: number): Vec3[] {
  const rand = mulberry32(seed);
  const points: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const jitter = 0.18;
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i + (rand() - 0.5) * jitter;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    const jy = y + (rand() - 0.5) * jitter * 0.5;
    const len = Math.hypot(x, jy, z) || 1;
    points.push([x / len, jy / len, z / len]);
  }
  return points;
}
