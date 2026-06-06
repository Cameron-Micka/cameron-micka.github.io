import type { FrameState } from './types';

export interface SunFlare {
  u: number;
  v: number;
  strength: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Projects the sun's world position into screen-space UV and derives a flare
// strength that ramps up as the sun nears the centre of view (i.e. as the
// camera looks toward it) and fades to zero once it falls behind the camera or
// drifts well past the frame edge. The strength is additionally gated by
// raycasting the camera->sun ray against every planet sphere (same test the
// selection picker uses) so the flare is occluded when a planet passes in front
// of the sun. Consumed by both renderers' final post pass to drive the
// deep-space lens flare. Column-major viewProj (gl-matrix).
export function computeSunFlare(frame: FrameState): SunFlare {
  const m = frame.viewProj;
  const c = frame.sun.center;
  const x = c[0];
  const y = c[1];
  const z = c[2];
  const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  if (cw <= 1e-4) {
    return { u: 0.5, v: 0.5, strength: 0 };
  }
  const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  const u = ndcX * 0.5 + 0.5;
  const v = -ndcY * 0.5 + 0.5;
  // Distance of the sun from screen centre in NDC; full strength when centred,
  // fading out as it approaches and passes the frame edge.
  const d = Math.hypot(ndcX, ndcY);
  const t = (1.35 - d) / (1.35 - 0.2);
  let strength = Math.max(0, Math.min(1, t));
  if (strength <= 0) {
    return { u, v, strength: 0 };
  }

  // Occlusion: raycast from the camera toward the sun and test each planet
  // sphere. A planet whose silhouette covers the sun direction fades the flare.
  const cam = frame.cameraPos;
  const dx = x - cam[0];
  const dy = y - cam[1];
  const dz = z - cam[2];
  const sunDist = Math.hypot(dx, dy, dz);
  if (sunDist > 1e-6) {
    const inv = 1 / sunDist;
    const rx = dx * inv;
    const ry = dy * inv;
    const rz = dz * inv;
    let visibility = 1;
    for (const p of frame.planets) {
      const pc = p.center;
      const ocx = cam[0] - pc[0];
      const ocy = cam[1] - pc[1];
      const ocz = cam[2] - pc[2];
      const tca = -(ocx * rx + ocy * ry + ocz * rz);
      // Only planets genuinely between the camera and the sun can occlude it.
      if (tca <= 0 || tca >= sunDist) continue;
      const oc2 = ocx * ocx + ocy * ocy + ocz * ocz;
      const dPerp = Math.sqrt(Math.max(oc2 - tca * tca, 0));
      const r = p.radius;
      // Soft silhouette edge: fully blocked inside 0.9r, clear past 1.15r.
      const inside = 1 - smoothstep(r * 0.9, r * 1.15, dPerp);
      const blocked = inside * p.visibility;
      visibility = Math.min(visibility, 1 - blocked);
      if (visibility <= 0) break;
    }
    strength *= visibility;
  }

  return { u, v, strength };
}
