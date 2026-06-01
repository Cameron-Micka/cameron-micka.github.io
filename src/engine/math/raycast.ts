import { mat4, type Mat4 } from './mat4';
import { vec3, type Vec3 } from './vec3';

export interface Ray {
  origin: Vec3;
  dir: Vec3; // normalized
}

// Build a world-space ray from normalized device coordinates (-1..1).
export function rayFromNDC(
  ndcX: number,
  ndcY: number,
  invViewProj: Mat4,
): Ray {
  const near = unproject(ndcX, ndcY, 0, invViewProj);
  const far = unproject(ndcX, ndcY, 1, invViewProj);
  return { origin: near, dir: vec3.normalize(vec3.sub(far, near)) };
}

function unproject(x: number, y: number, z: number, m: Mat4): Vec3 {
  const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  const ww = m[3]! * x + m[7]! * y + m[11]! * z + m[15]! || 1;
  return [wx / ww, wy / ww, wz / ww];
}

// Returns nearest positive intersection distance, or -1 if no hit.
export function raySphere(ray: Ray, center: Vec3, radius: number): number {
  const oc = vec3.sub(ray.origin, center);
  const b = vec3.dot(oc, ray.dir);
  const c = vec3.dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t0 = -b - sq;
  if (t0 >= 0) return t0;
  const t1 = -b + sq;
  return t1 >= 0 ? t1 : -1;
}

export function rayPointAt(ray: Ray, t: number): Vec3 {
  return vec3.add(ray.origin, vec3.scale(ray.dir, t));
}

export { mat4 };
