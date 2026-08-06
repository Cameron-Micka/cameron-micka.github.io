import type { Mat4 } from './math/mat4';
import type { Vec3 } from './math/vec3';
import type { Quat } from './math/quat';
import type { Frustum } from './math/frustum';

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
  // Resolution of the nebula backdrop target, as a fraction of CSS pixels
  // (i.e. independent of devicePixelRatio). The nebula raymarch is by far the
  // most expensive per-pixel shader and it's entirely low-frequency, so it is
  // rendered small and bilinearly upsampled into the scene.
  backdropScale: number;
  // Resolution of the bloom / god-ray / modal-blur target, again as a fraction
  // of CSS pixels. These are all wide, low-frequency filters with high tap
  // counts, so running them at a fraction of native is nearly free visually.
  postScale: number;
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
  // When true, a second ring is drawn on a different plane from the primary
  // ring, rotated by `secondRingTilt` radians about a perpendicular axis.
  secondRing: boolean;
  secondRingTilt: number;
  oceans: boolean;
  clouds: boolean;
  cityLights: boolean;
  // When true, the planet surface detail is advected along a procedural flow
  // field (see planet shader) so it streams like a fluid.
  flowMap: boolean;
  // When true, an additive emissive shell above the atmosphere paints animated
  // auroral curtains over both poles (see aurora shader).
  aurora: boolean;
  // Per-planet time used by cloud rotation (planet body cloud-shadow sampling
  // + cloud shell). Eases to a halt when the planet's spin is paused (e.g.
  // user just orbited it) so clouds visibly slow with the surface instead of
  // continuing to drift independently.
  cloudTime: number;
  moons: {
    orbitRadius: number;
    angle: number;
    size: number;
    paletteLow: Vec3;
    paletteMid: Vec3;
    paletteHigh: Vec3;
  }[];
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
  // Moon-orbit/spin clock. Independent of `time` so reduced motion can freeze
  // moon orbit and self-rotation in place without affecting other time-driven
  // shader effects (clouds, twinkle, etc., which apply their own slowdowns).
  moonTime: number;
  view: Mat4;
  proj: Mat4;
  viewProj: Mat4;
  // Inverse of viewProj. Lets fullscreen shaders (e.g. the nebula backdrop)
  // unproject screen-space NDC back into world-space ray directions so they
  // can sample world-locked fields instead of moving with the camera.
  invViewProj: Mat4;
  // Six-plane camera frustum (derived from viewProj). Renderers use it to cull
  // off-screen bodies — individual moons and the sun — before drawing. Whole
  // off-screen planets are already dropped from `planets` upstream.
  frustum: Frustum;
  cameraPos: Vec3;
  keyLightDir: Vec3;
  // The star lighting the scene. Positioned along keyLightDir so the visible
  // sun and the directional key light agree. Rendered with its own dedicated
  // shader (bright emissive surface + sunspots + corona), not the planet shader.
  sun: { center: Vec3; radius: number };
  planets: PlanetInstance[];
  quality: QualitySettings;
  // Sphere occluders used for analytic shadow casting. Empty when shadows are
  // disabled by the active quality tier. Limited to MAX_SHADOW_CASTERS (8).
  shadowCasters: { center: Vec3; radius: number }[];
  // 0 = live scene, 1 = fully blurred frozen snapshot (modal open).
  blur: number;
  reducedMotion: boolean;
  wireframe: boolean;
  // CRT lens curvature applied by the final present pass. 0 = flat.
  crtBarrel: number;
  // Flat XYZ samples of the rocket trajectory polyline drawn through every
  // planet. Empty array means no flight path is rendered this frame.
  flightPath: Float32Array;
}

// Stats surfaced to the debug HUD.
export interface RenderStats {
  drawCalls: number;
  triangles: number;
  gpuMemoryMB: number;
}

// Reports renderer startup progress (0..1) with a short human-readable label,
// so the UI can show a loading bar while geometry is built and shaders compile.
export type LoadProgressFn = (frac: number, label: string) => void;

export interface SceneRenderer {
  readonly backend: RendererBackend;
  init(canvas: HTMLCanvasElement, onProgress?: LoadProgressFn): Promise<void>;
  resize(width: number, height: number, dpr: number): void;
  render(frame: FrameState): void;
  getStats(): RenderStats;
  // Called when modal opens: keep rendering a frozen, progressively blurred
  // copy of the last live frame. Implemented as a post-process parameter.
  destroy(): void;
  onDeviceLost(cb: () => void): void;
}
