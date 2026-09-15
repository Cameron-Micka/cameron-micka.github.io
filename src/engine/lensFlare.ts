import type { FrameState } from './types';

export interface SunFlare {
  u: number;
  v: number;
  strength: number;
}

// Circle overlap in angular space: covering the centre of a large sun is only
// a partial eclipse. Full occlusion requires covering its entire apparent disc.
function discOcclusion(
  sunRadius: number,
  planetRadius: number,
  distance: number,
): number {
  if (distance >= sunRadius + planetRadius) return 0;
  if (distance <= Math.abs(planetRadius - sunRadius)) {
    return planetRadius >= sunRadius ? 1 : (planetRadius / sunRadius) ** 2;
  }
  const s2 = sunRadius * sunRadius;
  const p2 = planetRadius * planetRadius;
  const d2 = distance * distance;
  const sunArc = Math.acos(
    Math.max(-1, Math.min(1, (d2 + s2 - p2) / (2 * distance * sunRadius))),
  );
  const planetArc = Math.acos(
    Math.max(-1, Math.min(1, (d2 + p2 - s2) / (2 * distance * planetRadius))),
  );
  const triangle = Math.sqrt(
    Math.max(
      0,
      (-distance + sunRadius + planetRadius) *
        (distance + sunRadius - planetRadius) *
        (distance - sunRadius + planetRadius) *
        (distance + sunRadius + planetRadius),
    ),
  );
  const area = s2 * sunArc + p2 * planetArc - triangle * 0.5;
  return Math.max(0, Math.min(1, area / (Math.PI * s2)));
}

// Projects the sun's world position into screen-space UV and derives a flare
// strength that ramps up as the sun nears the centre of view (i.e. as the
// camera looks toward it) and fades to zero once it falls behind the camera or
// drifts well past the frame edge. The strength is additionally gated by
// comparing the apparent sun and planet discs so partial occlusion leaves
// light available for the flare and god rays. Consumed by both renderers'
// post pass to drive the deep-space lens flare. Column-major viewProj (gl-matrix).
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

  // Use the rendered sphere radii and their angular sizes at the camera,
  // not a point-source test along the camera-to-sun centre ray.
  const cam = frame.cameraPos;
  const dx = x - cam[0];
  const dy = y - cam[1];
  const dz = z - cam[2];
  const sunDist = Math.hypot(dx, dy, dz);
  if (sunDist > 1e-6 && frame.sun.radius > 0) {
    const sunAngle = Math.asin(Math.min(1, frame.sun.radius / sunDist));
    const inv = 1 / sunDist;
    const rx = dx * inv;
    const ry = dy * inv;
    const rz = dz * inv;
    let visibility = 1;
    for (const p of frame.planets) {
      if (p.visibility <= 0.02 || p.radius <= 0) continue;
      const pc = p.center;
      const ocx = cam[0] - pc[0];
      const ocy = cam[1] - pc[1];
      const ocz = cam[2] - pc[2];
      const tca = -(ocx * rx + ocy * ry + ocz * rz);
      // Only planets genuinely between the camera and the sun can occlude it.
      if (tca <= 0 || tca >= sunDist) continue;
      const planetDist = Math.hypot(ocx, ocy, ocz);
      const planetAngle = Math.asin(
        Math.min(1, (p.radius * p.visibility) / planetDist),
      );
      const separation = Math.acos(Math.max(-1, Math.min(1, tca / planetDist)));
      const blocked = discOcclusion(sunAngle, planetAngle, separation);
      visibility = Math.min(visibility, 1 - blocked);
      if (visibility <= 0) break;
    }
    strength *= visibility;
  }

  return { u, v, strength };
}
