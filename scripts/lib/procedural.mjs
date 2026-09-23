export const clamp = (value, low = 0, high = 1) =>
  Math.max(low, Math.min(high, value));
export const mix = (a, b, weight) => a + (b - a) * weight;
export const smoothstep = (a, b, value) => {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function random(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let n = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(x, y, seed = 0) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

export function noise(x, y, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = x - ix;
  const ty = y - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  return mix(
    mix(hash(ix, iy, seed), hash(ix + 1, iy, seed), sx),
    mix(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), sx),
    sy,
  );
}

export function fbm(x, y, seed = 0, octaves = 5) {
  let sum = 0;
  let weight = 0.5;
  let total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum += noise(x, y, seed + octave * 173) * weight;
    total += weight;
    x = x * 2.07 + 5.31;
    y = y * 2.07 + 9.17;
    weight *= 0.5;
  }
  return sum / total;
}
