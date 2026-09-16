import { quat } from './math/quat';
import { raySphere, type Ray } from './math/raycast';
import { vec3, type Vec3 } from './math/vec3';
import type { MoonInstance, PlanetInstance } from './types';

type Body = { center: Vec3; radius: number };
type FlyingMoon = { moon: MoonInstance; velocity: Vec3 };
const LAUNCH_SPEED = 6;
const SEPARATION = 0.0001;

export class Moons {
  instances: MoonInstance[] = [];
  private flying = new Map<string, FlyingMoon>();
  private destroyed = new Set<string>();

  update(planets: PlanetInstance[], time: number, dt: number, sun: Body): void {
    this.instances = [];
    const spin = quat.fromAxisAngle([0, 1, 0], time * 0.3);
    for (const p of planets) {
      p.moons.forEach((m, i) => {
        const id = `${p.slug}:${i}`;
        if (
          this.flying.has(id) ||
          this.destroyed.has(id) ||
          p.visibility <= 0.02
        )
          return;
        const orbit = m.orbitRadius * p.visibility;
        const offset = quat.rotateVec3(p.orientation, [
          Math.cos(m.angle) * orbit,
          Math.sin(m.angle * 0.5) * orbit * 0.2,
          Math.sin(m.angle) * orbit,
        ]);
        this.instances.push({
          id,
          center: vec3.add(p.center, offset),
          radius: m.size * p.visibility,
          orientation: quat.multiply(p.orientation, spin),
          seed: m.seed,
          oceans: m.oceans,
          atmosphere: m.atmosphere,
          visibility: p.visibility,
          focus: p.focus,
          paletteLow: m.paletteLow,
          paletteMid: m.paletteMid,
          paletteHigh: m.paletteHigh,
        });
      });
    }
    this.instances.push(...Array.from(this.flying.values(), (f) => f.moon));
    if (dt <= 0) return;
    const bodies = planets
      .filter((p) => p.visibility > 0.02)
      .map((p) => ({ center: p.center, radius: p.radius * p.visibility }));
    this.advance(dt, [...bodies, sun], sun);
    this.instances = this.instances.filter((m) => !this.destroyed.has(m.id));
    for (const f of this.flying.values()) {
      f.moon.orientation = quat.multiply(
        f.moon.orientation,
        quat.fromAxisAngle([0, 1, 0], dt * 0.3),
      );
    }
  }

  pick(ray: Ray, maxDistance = Infinity, radiusScale = 1): MoonInstance | null {
    let hit: MoonInstance | null = null;
    for (const moon of this.instances) {
      const t = raySphere(ray, moon.center, moon.radius * radiusScale);
      if (t >= 0 && t < maxDistance) {
        hit = moon;
        maxDistance = t;
      }
    }
    return hit;
  }

  launch(moon: MoonInstance, direction: Vec3): void {
    if (this.destroyed.has(moon.id) || vec3.length(direction) < 1e-6) return;
    this.flying.set(moon.id, {
      moon,
      velocity: vec3.scale(vec3.normalize(direction), LAUNCH_SPEED),
    });
  }

  private advance(dt: number, bodies: Body[], sun: Body): void {
    let remaining = dt;
    // Sweep spheres over the entire step (relative motion for two flying
    // moons), resolving the earliest contact first so fast moons cannot tunnel.
    // Stop at the contact budget rather than moving through a crowded pile-up.
    for (let contact = 0; contact < 32 && remaining > 1e-7; contact++) {
      let first: { a: FlyingMoon; body: Body; b?: FlyingMoon } | null = null;
      let hitTime = remaining;
      for (const a of this.flying.values()) {
        const candidates: Body[] = [
          sun,
          ...bodies.filter((b) => b !== sun),
          ...this.instances.filter(
            (m) => m !== a.moon && !this.destroyed.has(m.id),
          ),
        ];
        for (const body of candidates) {
          const b =
            'id' in body ? this.flying.get(body.id as string) : undefined;
          const relative = b ? vec3.sub(a.velocity, b.velocity) : a.velocity;
          const offset = vec3.sub(a.moon.center, body.center);
          const radius = a.moon.radius + body.radius;
          const distance = vec3.length(offset);
          const approach = vec3.dot(offset, relative);
          let t = -1;
          if (distance < radius - SEPARATION * 0.5) {
            t = 0;
          } else if (approach < 0) {
            const speed = vec3.length(relative);
            if (speed > 1e-6) {
              const hit = raySphere(
                { origin: a.moon.center, dir: vec3.scale(relative, 1 / speed) },
                body.center,
                radius,
              );
              if (hit >= 0) t = hit / speed;
            }
          }
          if (t >= 0 && t <= hitTime) {
            hitTime = t;
            first = { a, body, b };
          }
        }
      }
      for (const f of this.flying.values()) {
        f.moon.center = vec3.add(
          f.moon.center,
          vec3.scale(f.velocity, hitTime),
        );
      }
      remaining -= hitTime;
      if (!first) break;
      const { a, body, b } = first;
      if (body === sun) {
        this.flying.delete(a.moon.id);
        this.destroyed.add(a.moon.id);
        continue;
      }
      const offset = vec3.sub(a.moon.center, body.center);
      const distance = vec3.length(offset);
      const relative = b ? vec3.sub(a.velocity, b.velocity) : a.velocity;
      const normal =
        distance > 1e-6
          ? vec3.scale(offset, 1 / distance)
          : vec3.length(relative) > 1e-6
            ? vec3.scale(vec3.normalize(relative), -1)
            : ([1, 0, 0] as Vec3);
      const correction =
        Math.max(0, a.moon.radius + body.radius - distance) + SEPARATION;
      a.moon.center = vec3.add(
        a.moon.center,
        vec3.scale(normal, correction / (b ? 2 : 1)),
      );
      if (b)
        b.moon.center = vec3.sub(
          b.moon.center,
          vec3.scale(normal, correction / 2),
        );
      const speed = vec3.dot(relative, normal);
      if (speed >= 0) continue;
      if (b) {
        // Elastic impact with mass proportional to volume.
        const massA = a.moon.radius ** 3;
        const massB = b.moon.radius ** 3;
        const impulse = (2 * speed) / (massA + massB);
        a.velocity = vec3.sub(a.velocity, vec3.scale(normal, impulse * massB));
        b.velocity = vec3.add(b.velocity, vec3.scale(normal, impulse * massA));
      } else {
        a.velocity = vec3.sub(a.velocity, vec3.scale(normal, 2 * speed));
      }
    }
  }
}
