import type { Company } from '@/content/schema';
import { hexToRgb, tenureYears } from '@/content/schema';
import { hashString, fibonacciSpherePoints, mulberry32 } from './math/rng';
import type { PlanetInstance } from './types';
import type { Vec3 } from './math/vec3';

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
  poiDirs: { slug: string; dir: Vec3; accent: Vec3 }[];
  moonSpecs: { orbitRadius: number; size: number; phase: number; speed: number }[];
}

export function buildPlanetModels(companies: Company[]): PlanetModel[] {
  return companies.map((company, index) => {
    const seed = hashString(company.seed);
    const years = tenureYears(company.start, company.end);
    const radius = Math.min(3.6, 1.15 + 0.23 * Math.sqrt(years) * 1.6);

    const dirs = fibonacciSpherePoints(company.pois.length, seed);
    const poiDirs = company.pois.map((poi, i) => ({
      slug: poi.slug,
      dir: dirs[i] ?? ([0, 1, 0] as Vec3),
      accent: hexToRgb(poi.accent),
    }));

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

// Produce the renderable instance for a planet at a given time / focus.
export function instanceFromModel(
  model: PlanetModel,
  time: number,
  rotationY: number,
  focus: number,
  visibility: number,
): PlanetInstance {
  const f = model.company.features;
  return {
    slug: model.company.slug,
    center: [0, 0, model.z],
    radius: model.radius,
    rotationY,
    seed: model.seed,
    paletteLow: model.paletteLow,
    paletteMid: model.paletteMid,
    paletteHigh: model.paletteHigh,
    hasClouds: f.clouds,
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
