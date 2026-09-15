import type { Camera } from './Camera';
import { vec3, type Vec3 } from './math/vec3';

// Project the sphere's tangent circle, rather than a billboard at its center,
// so the outline also fits nearby bodies and bodies near the screen edges.
export function selectionOutline(
  body: { center: Vec3; radius: number },
  camera: Camera,
  width: number,
  height: number,
  barrel: number,
): string | null {
  const delta = vec3.sub(body.center, camera.position);
  const distance = vec3.length(delta);
  if (distance <= body.radius || width <= 0 || height <= 0) return null;
  if (!camera.frustum.intersectsSphere(body.center, body.radius)) return null;

  const axis = vec3.scale(delta, 1 / distance);
  const right = vec3.normalize(
    vec3.cross(axis, Math.abs(axis[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0]),
  );
  const up = vec3.cross(right, axis);
  const ratio = body.radius / distance;
  const center = vec3.add(
    camera.position,
    vec3.scale(delta, 1 - ratio * ratio),
  );
  const radius = body.radius * Math.sqrt(1 - ratio * ratio);
  const m = camera.viewProj;
  const points: [number, number][] = [];
  for (let i = 0; i < 128; i++) {
    const angle = (i / 128) * Math.PI * 2;
    const p = vec3.add(
      center,
      vec3.add(
        vec3.scale(right, radius * Math.cos(angle)),
        vec3.scale(up, radius * Math.sin(angle)),
      ),
    );
    const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!;
    if (w <= 0.1) return null;
    let x = (m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!) / w;
    let y = (m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!) / w;
    // Invert the composite shader's screen-to-scene barrel sampling.
    const sceneRadius = Math.hypot(x, y);
    if (barrel && sceneRadius > 0) {
      let screenRadius = sceneRadius;
      for (let j = 0; j < 6; j++) {
        screenRadius -=
          (screenRadius * (1 + barrel * screenRadius * screenRadius * 0.25) -
            sceneRadius * (1 + barrel * 0.5)) /
          (1 + barrel * screenRadius * screenRadius * 0.75);
      }
      x *= screenRadius / sceneRadius;
      y *= screenRadius / sceneRadius;
    }
    points.push([(x + 1) * width * 0.5, (1 - y) * height * 0.5]);
  }

  // Offset along screen-space normals for a constant six CSS-pixel gap.
  return (
    points
      .map(([x, y], i) => {
        const prev = points[(i + points.length - 1) % points.length]!;
        const next = points[(i + 1) % points.length]!;
        const dx = next[0] - prev[0];
        const dy = next[1] - prev[1];
        const length = Math.hypot(dx, dy);
        return `${i === 0 ? 'M' : 'L'}${x - (dy / length) * 6},${y + (dx / length) * 6}`;
      })
      .join(' ') + ' Z'
  );
}
