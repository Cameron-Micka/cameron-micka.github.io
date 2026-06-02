import type { Company } from '@/content/schema';
import { hexToRgb, tenureYears } from '@/content/schema';
import { hashString, fibonacciSpherePoints, mulberry32 } from './math/rng';
import type { PlanetInstance } from './types';
import { vec3, type Vec3 } from './math/vec3';
import type { Quat } from './math/quat';

export const PLANET_SPACING = 9;
const MICROSOFT_RADIUS_SCALE = 0.92;

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
    const baseRadius = Math.min(3.6, 1.15 + 0.23 * Math.sqrt(years) * 1.6);
    const radius =
      company.slug === 'microsoft'
        ? baseRadius * MICROSOFT_RADIUS_SCALE
        : baseRadius;

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
    const moonSpecs = Array.from({ length: company.features.moons }, (_, i) => ({
      orbitRadius: radius * (1.7 + i * 0.5),
      size: radius * (0.14 + rand() * 0.06),
      phase: rand() * Math.PI * 2,
      speed: 0.25 + rand() * 0.4,
    }));

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
export function instanceFromModel(
  model: PlanetModel,
  time: number,
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
    moons: model.moonSpecs.map((m) => ({
      orbitRadius: m.orbitRadius,
      angle: m.phase + time * m.speed,
      size: m.size,
    })),
    pois: model.poiDirs,
    focus,
    visibility,
  };
}
