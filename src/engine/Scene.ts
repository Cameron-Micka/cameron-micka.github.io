import type { Company } from '@/content/schema';
import { hexToRgb, tenureYears } from '@/content/schema';
import { hashString, fibonacciSpherePoints, mulberry32 } from './math/rng';
import type { PlanetInstance } from './types';
import { vec3, type Vec3 } from './math/vec3';
import type { Quat } from './math/quat';

export const PLANET_SPACING = 9;

export interface PlanetModel {
  company: Company;
  index: number;
  z: number;
  radius: number;
  seed: number;
  paletteLow: Vec3;
  paletteMid: Vec3;
  paletteHigh: Vec3;
  poiDirs: { slug: string; dir: Vec3; surfaceDir: Vec3; accent: Vec3 }[];
  moonSpecs: { orbitRadius: number; size: number; phase: number; speed: number }[];
  // Each satellite has a deterministic tilted circular orbit. Stored as an
  // orthonormal basis (u, v) spanning the orbital plane plus radius/phase/speed,
  // so per-frame the world offset is just (cos a)*u*r + (sin a)*v*r.
  satelliteSpecs: {
    orbitRadius: number;
    phase: number;
    speed: number;
    u: Vec3;
    v: Vec3;
  }[];
}

// Nudge a unit direction by up to `maxDeg` degrees in a random azimuth, using
// the supplied RNG so the offset is stable for a given planet/POI.
function jitterDir(dir: Vec3, rand: () => number, maxDeg: number): Vec3 {
  const theta = Math.sqrt(rand()) * (maxDeg * Math.PI) / 180;
  const phi = rand() * Math.PI * 2;
  const up: Vec3 = Math.abs(dir[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const t = vec3.normalize(vec3.cross(up, dir));
  const b = vec3.cross(dir, t);
  const tangent = vec3.add(vec3.scale(t, Math.cos(phi)), vec3.scale(b, Math.sin(phi)));
  return vec3.normalize(
    vec3.add(vec3.scale(dir, Math.cos(theta)), vec3.scale(tangent, Math.sin(theta))),
  );
}

export function buildPlanetModels(companies: Company[]): PlanetModel[] {
  return companies.map((company, index) => {
    const seed = hashString(company.seed);
    const years = tenureYears(company.start, company.end);
    // Linear in tenure years so short stints (LucasArts, ~1y) read as small
    // and long stints (Microsoft, ~10y+) read as clearly the largest body.
    // Clamped to a visible floor and a sane on-screen ceiling.
    const radius = Math.min(3, Math.max(0.7, 0.44 + 0.26 * years));

    const dirs = fibonacciSpherePoints(company.pois.length, seed);
    const surfRand = mulberry32(seed ^ 0x6b43a9f1);
    const poiDirs = company.pois.map((poi, i) => {
      const dir = dirs[i] ?? ([0, 1, 0] as Vec3);
      return {
        slug: poi.slug,
        dir,
        surfaceDir: jitterDir(dir, surfRand, 6),
        accent: hexToRgb(poi.accent),
      };
    });

    const rand = mulberry32(seed ^ 0x9e3779b9);
    const moonSpecs = Array.from({ length: company.features.moons }, (_, i) => {
      // Cubed distribution biases small but lets an occasional moon grow up to
      // ~36% of the planet's radius, giving the family obvious size variance.
      const t = rand() * rand() * rand();
      return {
        orbitRadius: radius * (1.7 + i * 0.5),
        size: radius * (0.04 + t * 0.55),
        phase: rand() * Math.PI * 2,
        speed: 0.25 + rand() * 0.4,
      };
    });

    // Every planet gets a small flock of satellites — pin-prick white sprites
    // that read like distant stars but orbit in tilted, world-locked planes
    // so the eye picks them up as motion against the static starfield.
    const satCount = 4 + Math.floor(rand() * 4); // 4..7
    const satelliteSpecs = Array.from({ length: satCount }, () => {
      // Random orbital plane: pick a unit normal, build an orthonormal basis
      // spanning the plane perpendicular to it. The (u, v) pair is then the
      // basis the orbit traces a unit circle in.
      const nx = rand() * 2 - 1;
      const ny = rand() * 2 - 1;
      const nz = rand() * 2 - 1;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const n: Vec3 = [nx / nl, ny / nl, nz / nl];
      const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = vec3.normalize(vec3.cross(n, helper));
      const v = vec3.cross(n, u);
      return {
        orbitRadius: radius * (1.35 + rand() * 1.65),
        phase: rand() * Math.PI * 2,
        speed: 0.06 + rand() * 0.18,
        u,
        v,
      };
    });

    return {
      company,
      index,
      z: index * PLANET_SPACING,
      radius,
      seed,
      paletteLow: hexToRgb(company.palette.low),
      paletteMid: hexToRgb(company.palette.mid),
      paletteHigh: hexToRgb(company.palette.high),
      poiDirs,
      moonSpecs,
      satelliteSpecs,
    };
  });
}

// Distance from a planet's center at which its POI markers float. Keeps the
// marker clear of the surface so it never intersects the planet, leaving room
// for a connector line back down to the surface.
export function poiMarkerDistance(effectiveRadius: number): number {
  return effectiveRadius * 1.18 + 0.3;
}

// Spacecraft trajectory polyline that hops through every planet on the
// timeline, looping around each one and connecting consecutive loops with a
// cubic-Hermite arc. The polyline is sampled densely enough that a thin
// ribbon line will read smoothly; planet centers never move, so the array
// is computed once and uploaded as a static vertex buffer. Returns a flat
// Float32Array of XYZ triples (length = N * 3 for N points).
//
// Route is reverse-chronological: starts at the most recent role's planet
// (highest `index`) and ends at the earliest (index 0). The two endpoint
// planets each do a single half loop (one free end apiece) so the path reads
// as cleanly "departing" / "arriving" instead of circling them fully.
export function buildFlightPath(models: PlanetModel[]): Float32Array {
  if (models.length < 2) return new Float32Array(0);
  const route = [...models].sort((a, b) => b.index - a.index);

  // Build a per-planet tilted orbital basis. Starting from the XY plane
  // (perpendicular to the timeline Z axis so loops face the camera) and
  // rotated by small random tilts around X and Y, so each planet's loop
  // sits in a slightly different plane.
  type Orbit = {
    center: Vec3;
    radius: number;
    u: Vec3;
    v: Vec3;
    w: Vec3;
  };
  const orbits: Orbit[] = route.map((m) => {
    const rnd = mulberry32(m.seed ^ 0xcafebabe);
    const tiltX = (rnd() - 0.5) * 0.8;
    const tiltY = (rnd() - 0.5) * 0.8;
    let u: Vec3 = [1, 0, 0];
    let v: Vec3 = [0, 1, 0];
    const cy = Math.cos(tiltY);
    const sy = Math.sin(tiltY);
    u = [u[0] * cy + u[2] * sy, u[1], -u[0] * sy + u[2] * cy];
    v = [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
    const cx = Math.cos(tiltX);
    const sx = Math.sin(tiltX);
    u = [u[0], u[1] * cx - u[2] * sx, u[1] * sx + u[2] * cx];
    v = [v[0], v[1] * cx - v[2] * sx, v[1] * sx + v[2] * cx];
    // Perpendicular to the orbit plane; the corkscrew wiggle is applied
    // along this axis so the loop "drifts" out of its plane as it sweeps.
    const w = vec3.normalize(vec3.cross(u, v));
    return { center: [0, 0, m.z] as Vec3, radius: m.radius * 1.18, u, v, w };
  });

  // Position / orbit-tangent at angle `a` on orbit `i`. The tangent is the
  // derivative of position with respect to angle, NOT normalized — its
  // magnitude (orbit radius) feeds the Hermite tangent scaling naturally.
  function pointAt(i: number, a: number): Vec3 {
    const o = orbits[i]!;
    const c = Math.cos(a) * o.radius;
    const s = Math.sin(a) * o.radius;
    return [
      o.center[0] + o.u[0] * c + o.v[0] * s,
      o.center[1] + o.u[1] * c + o.v[1] * s,
      o.center[2] + o.u[2] * c + o.v[2] * s,
    ];
  }
  function tangentAt(i: number, a: number): Vec3 {
    const o = orbits[i]!;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [
      (-o.u[0] * s + o.v[0] * c) * o.radius,
      (-o.u[1] * s + o.v[1] * c) * o.radius,
      (-o.u[2] * s + o.v[2] * c) * o.radius,
    ];
  }
  // Angle on orbit i whose orbital position is closest to the given world
  // direction. Used to pick entry/exit angles facing the neighboring planet.
  function angleFacing(i: number, dir: Vec3): number {
    const o = orbits[i]!;
    return Math.atan2(vec3.dot(o.v, dir), vec3.dot(o.u, dir));
  }

  const pts: number[] = [];
  const push = (p: Vec3) => pts.push(p[0], p[1], p[2]);

  for (let i = 0; i < route.length; i++) {
    const isStart = i === 0;
    const isEnd = i === route.length - 1;
    const o = orbits[i]!;

    // Each planet sweeps at least a half orbital revolution before the path
    // moves on. Interior planets enter facing the previous planet and exit
    // facing the next, so their arc can run longer than half a loop depending
    // on geometry. The two endpoint planets each have one free end (no neighbor
    // on that side), so they do exactly a half loop: the start enters so its
    // half loop finishes pointing at the next planet, and the end enters facing
    // the previous planet and stops after half a turn — reads as a clean
    // departure / arrival instead of a full extra circle.
    const turns = 0.5;
    const halfLoop = Math.PI * 2 * turns;

    let entryAngle: number;
    let exitAngle: number;
    if (isStart) {
      const targetExit = angleFacing(
        i,
        vec3.normalize(vec3.sub(orbits[i + 1]!.center, o.center)),
      );
      entryAngle = targetExit - halfLoop;
      exitAngle = targetExit;
    } else if (isEnd) {
      entryAngle = angleFacing(
        i,
        vec3.normalize(vec3.sub(orbits[i - 1]!.center, o.center)),
      );
      exitAngle = entryAngle + halfLoop;
    } else {
      entryAngle = angleFacing(
        i,
        vec3.normalize(vec3.sub(orbits[i - 1]!.center, o.center)),
      );
      const targetExit = angleFacing(
        i,
        vec3.normalize(vec3.sub(orbits[i + 1]!.center, o.center)),
      );
      let d = targetExit - entryAngle;
      while (d <= 0) d += Math.PI * 2;
      while (d < halfLoop) d += Math.PI * 2;
      exitAngle = entryAngle + d;
    }
    const delta = exitAngle - entryAngle;

    // Corkscrew wiggle along the orbit's perpendicular axis. Envelope is
    // sin²(π·t) so the displacement AND its derivative are zero at both
    // endpoints — the Hermite transit between orbits doesn't need to know
    // about the wiggle, and the in-plane orbital tangent remains correct.
    // Frequency scales with the number of turns so each loop gets a
    // consistent number of wiggles regardless of how many revolutions it
    // takes to reach the exit angle.
    const helixCycles = Math.max(2, Math.round(turns * 2.5));
    const helixAmp = o.radius * 0.15;

    // Smooth sampling: ~24 samples per radian for the arc, and at least
    // ~16 samples per helix cycle so the corkscrew oscillations don't
    // look polygonal.
    const segs = Math.max(
      48,
      Math.ceil(delta * 24),
      Math.ceil(helixCycles * 16),
    );
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const a = entryAngle + t * delta;
      const env = Math.sin(Math.PI * t);
      const wiggle = helixAmp * env * env * Math.sin(2 * Math.PI * helixCycles * t);
      const base = pointAt(i, a);
      push([
        base[0] + o.w[0] * wiggle,
        base[1] + o.w[1] * wiggle,
        base[2] + o.w[2] * wiggle,
      ]);
    }

    // Cubic-Hermite transit from this orbit's exit to the next orbit's entry,
    // with tangents = orbit derivative at the boundary. Tangent magnitude is
    // scaled by half the chord length so the transit reads as a smooth arc
    // (not a tight S-curve or a barely-curved line).
    if (!isEnd) {
      const j = i + 1;
      const nextEntryAngle = angleFacing(
        j,
        vec3.normalize(vec3.sub(o.center, orbits[j]!.center)),
      );
      const p0 = pointAt(i, exitAngle);
      const p1 = pointAt(j, nextEntryAngle);
      const t0 = tangentAt(i, exitAngle);
      const t1 = tangentAt(j, nextEntryAngle);
      const chord = vec3.length(vec3.sub(p1, p0));
      const tScale = chord * 0.5;
      const t0u = vec3.scale(vec3.normalize(t0), tScale);
      const t1u = vec3.scale(vec3.normalize(t1), tScale);
      const tsegs = 64;
      // Skip s=0 (already at exit point) and s=tsegs (the next loop's first
      // sample lands exactly there).
      for (let s = 1; s < tsegs; s++) {
        const t = s / tsegs;
        const h00 = 2 * t * t * t - 3 * t * t + 1;
        const h10 = t * t * t - 2 * t * t + t;
        const h01 = -2 * t * t * t + 3 * t * t;
        const h11 = t * t * t - t * t;
        push([
          h00 * p0[0] + h10 * t0u[0] + h01 * p1[0] + h11 * t1u[0],
          h00 * p0[1] + h10 * t0u[1] + h01 * p1[1] + h11 * t1u[1],
          h00 * p0[2] + h10 * t0u[2] + h01 * p1[2] + h11 * t1u[2],
        ]);
      }
    }
  }

  return new Float32Array(pts);
}

// POIs are only shown for the focused ("current") planet. This smoothly fades
// them in as a planet approaches full focus and out as it loses focus, so they
// pop neither on nor off while scrubbing the timeline.
export function poiFocusFade(focus: number): number {
  const t = (focus - 0.6) / 0.25;
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

// Produce the renderable instance for a planet at a given time / focus.
// `moonTime` advances the moon orbit angles; it is independent of the global
// shader clock so reduced motion can slow the orbits without affecting other
// time-driven shader effects (e.g. cloud rotation, which applies its own
// reduced-motion multiplier in-shader).
export function instanceFromModel(
  model: PlanetModel,
  moonTime: number,
  cloudTime: number,
  orientation: Quat,
  focus: number,
  visibility: number,
): PlanetInstance {
  const f = model.company.features;
  return {
    slug: model.company.slug,
    center: [0, 0, model.z],
    radius: model.radius,
    orientation,
    seed: model.seed,
    paletteLow: model.paletteLow,
    paletteMid: model.paletteMid,
    paletteHigh: model.paletteHigh,
    hasRing: f.rings,
    ringTilt: f.ringTilt,
    thinRing: f.thinRing,
    oceans: f.oceans,
    clouds: f.clouds,
    cityLights: f.cityLights,
    cloudTime,
    moons: model.moonSpecs.map((m) => ({
      orbitRadius: m.orbitRadius,
      angle: m.phase + moonTime * m.speed,
      size: m.size,
    })),
    satellites: model.satelliteSpecs.map((s) => {
      const a = s.phase + moonTime * s.speed;
      const c = Math.cos(a) * s.orbitRadius;
      const si = Math.sin(a) * s.orbitRadius;
      const offset: Vec3 = [
        s.u[0] * c + s.v[0] * si,
        s.u[1] * c + s.v[1] * si,
        s.u[2] * c + s.v[2] * si,
      ];
      return { offset, size: 0.0028 };
    }),
    pois: model.poiDirs,
    focus,
    visibility,
  };
}
