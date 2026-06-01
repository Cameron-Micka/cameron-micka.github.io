import type { Mat4 } from './math/mat4';
import type { Vec3 } from './math/vec3';
import type { Quat } from './math/quat';

export type RendererBackend = 'webgpu' | 'webgl2';

export type QualityTier = 'ultra' | 'high' | 'med' | 'low' | 'webgl2';

export interface QualitySettings {
  tier: QualityTier;
  dprCap: number;
  starCount: number;
  ssao: boolean;
  clouds: boolean;
  chromaticAberration: boolean;
  bloomMips: number;
}

// Per-planet data the renderer needs to draw one planet (+ optional ring/moons).
export interface PlanetInstance {
  slug: string;
  center: Vec3;
  radius: number;
  orientation: Quat; // full planet orientation (drag to rotate any direction)
  seed: number;
  // Three palette anchor colors (low / mid / high terrain), linear RGB 0..1.
  paletteLow: Vec3;
  paletteMid: Vec3;
  paletteHigh: Vec3;
  hasClouds: boolean;
  hasRing: boolean;
  ringTilt: number;
  moons: { orbitRadius: number; angle: number; size: number }[];
  // POIs in local sphere space (unit directions) + accent color + facing flag.
  pois: {
    slug: string;
    dir: Vec3;
    // Where the connector line touches the surface: the POI direction nudged a
    // few degrees off the closest point so connectors don't all meet dead-on.
    surfaceDir: Vec3;
    accent: Vec3;
  }[];
  focus: number; // 0..1 how focused/foregrounded this planet is
  visibility: number; // 0..1 fade; planets more recent than focus fade out
}

export interface FrameState {
  time: number; // seconds
  view: Mat4;
  proj: Mat4;
  viewProj: Mat4;
  cameraPos: Vec3;
  keyLightDir: Vec3;
  planets: PlanetInstance[];
  quality: QualitySettings;
  // 0 = live scene, 1 = fully blurred frozen snapshot (modal open).
  blur: number;
  reducedMotion: boolean;
}

// Stats surfaced to the debug HUD.
export interface RenderStats {
  drawCalls: number;
  triangles: number;
  gpuMemoryMB: number;
}

export interface SceneRenderer {
  readonly backend: RendererBackend;
  init(canvas: HTMLCanvasElement): Promise<void>;
  resize(width: number, height: number, dpr: number): void;
  render(frame: FrameState): void;
  getStats(): RenderStats;
  // Called when modal opens: keep rendering a frozen, progressively blurred
  // copy of the last live frame. Implemented as a post-process parameter.
  destroy(): void;
  onDeviceLost(cb: () => void): void;
}
