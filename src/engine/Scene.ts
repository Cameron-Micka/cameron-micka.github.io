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
