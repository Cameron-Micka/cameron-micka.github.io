import type { Mat4 } from './math/mat4';
import type { Vec3 } from './math/vec3';
import type { Quat } from './math/quat';

export type RendererBackend = 'webgpu' | 'webgl2';

export type QualityTier = 'high' | 'med' | 'low' | 'webgl2';

export interface QualitySettings {
  tier: QualityTier;
  dprCap: number;
  starCount: number;
  ssao: boolean;
  chromaticAberration: boolean;
  bloomMips: number;
  msaa: number; // MSAA sample count: 1 = off, 2, or 4
  shadows: boolean; // planet-cast shadows on other planets/rings/moons
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
  hasRing: boolean;
  ringTilt: number;
  thinRing: boolean;
  oceans: boolean;
  clouds: boolean;
  moons: { orbitRadius: number; angle: number; size: number }[];
  // Tiny "satellite" point-sprites orbiting the planet. World-locked orbits
  // (don't inherit planet spin) — meant to read as the same pin-prick white
  // pixel as a distant star, but in motion around the planet.
  satellites: { offset: Vec3; size: number }[];
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
  // Inverse of viewProj. Lets fullscreen shaders (e.g. the nebula backdrop)
  // unproject screen-space NDC back into world-space ray directions so they
  // can sample world-locked fields instead of moving with the camera.
  invViewProj: Mat4;
  cameraPos: Vec3;
  keyLightDir: Vec3;
  planets: PlanetInstance[];
  quality: QualitySettings;
  // Sphere occluders used for analytic shadow casting. Empty when shadows are
  // disabled by the active quality tier. Limited to MAX_SHADOW_CASTERS (8).
  shadowCasters: { center: Vec3; radius: number }[];
  // 0 = live scene, 1 = fully blurred frozen snapshot (modal open).
  blur: number;
  reducedMotion: boolean;
  wireframe: boolean;
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
