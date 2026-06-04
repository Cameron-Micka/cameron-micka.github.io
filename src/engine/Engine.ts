import type {
  FrameState,
  LoadProgressFn,
  RendererBackend,
  RenderStats,
  SceneRenderer,
  QualitySettings,
  QualityTier,
} from './types';
import { WebGPURenderer } from './WebGPURenderer';
import { WebGL2Renderer } from './WebGL2Renderer';
import { Camera } from './Camera';
import {
  buildPlanetModels,
  buildFlightPath,
  instanceFromModel,
  poiMarkerDistance,
  PLANET_SPACING,
  type PlanetModel,
} from './Scene';
import { QualityManager, QUALITY_PRESETS, type QualityPreference } from './QualityManager';
import { InputController } from './InputController';
import { TinyEventEmitter } from './TinyEventEmitter';
import { clamp, damp, easing, lerp } from './math/easing';
import { rayFromNDC, raySphere } from './math/raycast';
import { quat, type Quat } from './math/quat';
import { vec3, type Vec3 } from './math/vec3';
import type { Company } from '@/content/schema';
import {
  loadSettings,
  saveSettings,
  resolveReducedMotion,
  type PersistedSettings,
  type ReducedMotionPref,
  type BackendPref,
} from '@/settings';

export interface OpenPoiRef {
  company: string;
  poi: string;
}

export interface EngineSnapshot {
  backend: RendererBackend | null;
  ready: boolean;
  failed: string | null;
  focusedIndex: number;
  openPoi: OpenPoiRef | null;
  quality: QualityPreference;
  activeTier: QualityTier;
  reducedMotion: ReducedMotionPref;
  forceBackend: BackendPref;
  debugHud: boolean;
  wireframe: boolean;
  freeCamera: boolean;
  flightPath: boolean;
  // Populated only while free camera is active. Yaw/pitch are in degrees;
  // yaw is normalized to (-180, 180].
  freeCameraState: {
    position: Vec3;
    yawDeg: number;
    pitchDeg: number;
  } | null;
  stats: RenderStats & { fps: number };
}

export type EngineEvents = {
  focusChanged: number;
  poiOpened: OpenPoiRef;
  poiClosed: null;
  qualityChanged: QualityTier;
  ready: null;
  flyInDone: null;
  loadProgress: LoadState;
};

// Startup progress surfaced to the loading bar. `frac` is monotonic 0..1 and
// `ready` flips true once the first frame has rendered (the bar can dismiss).
export type LoadState = {
  frac: number;
  label: string;
  ready: boolean;
};

const FLY_IN_SECONDS = 2.2;
const FLY_IN_DISTANCE = 42;
const KEY_LIGHT: Vec3 = vec3.normalize([0.4, 0.85, -0.45]);

// The visible sun sits far along the key-light direction from the middle of the
// planet line, so the body the viewer sees lines up with the direction every
// planet is lit from. Distance keeps the whole disc + corona inside the camera
// far plane (200); radius makes it read as a grand, distant star.
const SUN_DISTANCE = 72;
const SUN_RADIUS = 20;

// Free-fly camera tuning. FLY_SPEED is in world units/sec; PLANET_SPACING=9
// puts a single hop between planets at roughly one second of held W.
const FLY_SPEED = 8;
const FLY_VELOCITY_DAMP = 5; // half-life ~0.14s → noticeable but snappy momentum
const LOOK_SENSITIVITY = 0.0025; // rad / px
const PITCH_LIMIT = Math.PI / 2 - 0.01;

// Normalize a yaw in degrees to (-180, 180]. Used for HUD readout.
function normalizeYawDeg(deg: number): number {
  let d = ((deg + 180) % 360) - 180;
  if (d <= -180) d += 360;
  return d;
}

export class Engine {
  readonly events = new TinyEventEmitter<EngineEvents>();

  private canvas: HTMLCanvasElement;
  private renderer: SceneRenderer | null = null;
  private camera = new Camera();
  private models: PlanetModel[];
  private readonly sun: { center: Vec3; radius: number };
  private quality = new QualityManager();
  private input: InputController;
  private settings: PersistedSettings;

  private activeQuality: QualitySettings;
  private activeTier: QualityTier = 'high';

  private orientations: Quat[];
  // Per-planet cloud-time accumulator. Advances at a rate eased between 0
  // and 1 by `cloudPace[i]`, so when a planet's surface spin is paused
  // (recently orbited / reduced motion), the cloud drift smoothly halts
  // along with it. Decoupled from `time` because cloud rotation otherwise
  // shares the global clock and would keep drifting through a "stopped" planet.
  private cloudTimes: number[];
  private cloudPace: number[];
  // Static spacecraft trajectory polyline. Planet centers never move, so this
  // is built once at startup and re-used every frame.
  private flightPath: Float32Array;
  private scrubCurrent = 0;
  private scrubTarget = 0;
  private zoomTarget = 1;
  private zoomCurrent = 1;
  private blurCurrent = 0;
  private time = 0;
  // Separate clock used to drive moon orbits so we can halt them under
  // reduced motion without affecting the global time used by shaders
  // (cloud rotation, etc. already apply their own reduced-motion multipliers).
  private moonTime = 0;
  private focusedIndex = 0;
  private openPoi: OpenPoiRef | null = null;
  private lastOrbitIndex = -1;
  private lastInteract = -10;

  private cinematicActive = true;
  private cinematicT = 0;

  // Free-fly camera state. Authoritative when settings.freeCamera is true.
  private freePos: Vec3 = [0, 0, 0];
  private freeVelocity: Vec3 = [0, 0, 0];
  private freeYaw = 0;
  private freePitch = 0;

  private running = false;
  private rafId = 0;
  private lastTs = 0;
  private ready = false;
  private loadState: LoadState = {
    frac: 0,
    label: 'Initializing…',
    ready: false,
  };
  private failed: string | null = null;
  private coarsePointer = false;

  private fps = 0;
  private fpsFrames = 0;
  private fpsAccum = 0;
  private lastStatsTs = 0;

  private resizeObserver: ResizeObserver | null = null;
  private listeners = new Set<() => void>();
  private snapshot: EngineSnapshot;

  constructor(canvas: HTMLCanvasElement, companies: Company[]) {
    this.canvas = canvas;
    this.models = buildPlanetModels(companies);
    this.orientations = this.models.map((_, i) =>
      quat.fromAxisAngle([0, 1, 0], i * 0.7),
    );
    this.cloudTimes = this.models.map(() => 0);
    this.cloudPace = this.models.map(() => 1);
    this.flightPath = buildFlightPath(this.models);
    // Static sun: far along the key light from the middle of the planet line.
    const lineCenterZ =
      this.models.length > 0 ? ((this.models.length - 1) * PLANET_SPACING) / 2 : 0;
    this.sun = {
      center: [
        KEY_LIGHT[0] * SUN_DISTANCE,
        KEY_LIGHT[1] * SUN_DISTANCE,
        lineCenterZ + KEY_LIGHT[2] * SUN_DISTANCE,
      ],
      radius: SUN_RADIUS,
    };
    // Open focused on the current role (the one still ongoing) rather than the
    // first planet in the sequence, so e.g. a reversed timeline still starts on
    // "Now". Falls back to the first planet if none is marked current.
    const startIndex = Math.max(
      0,
      this.models.findIndex((m) => m.company.end === null),
    );
    this.scrubCurrent = startIndex;
    this.scrubTarget = startIndex;
    this.focusedIndex = startIndex;
    this.settings = loadSettings();
    this.activeQuality = QUALITY_PRESETS.high;
    this.coarsePointer =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(pointer: coarse)').matches;

    this.input = new InputController({
      onScrub: (d) => this.onScrub(d),
      onScrubEnd: () => this.onScrubEnd(),
      onOrbit: (dx, dy) => this.onOrbit(dx, dy),
      onZoom: (f) => this.onZoom(f),
      onPick: (x, y) => this.handlePick(x, y),
      onKeyStep: (dir) => this.jumpToPlanet(this.focusedIndex + dir),
      onKeyJump: (t) =>
        this.jumpToPlanet(t === 'start' ? 0 : this.models.length - 1),
      onUserInteract: () => this.onUserInteract(),
      onLook: (dx, dy) => this.onLook(dx, dy),
    });

    this.snapshot = this.buildSnapshot();
  }

  // ---- lifecycle ----

  async start(): Promise<void> {
    try {
      this.renderer = await this.createRenderer((frac, label) => {
        // Monotonic: a WebGPU→WebGL2 fallback restarts at a low frac, so never
        // let the visible bar regress.
        const next = Math.max(this.loadState.frac, frac);
        this.loadState = { frac: next, label, ready: false };
        this.events.emit('loadProgress', this.loadState);
      });
    } catch (err) {
      this.failed = err instanceof Error ? err.message : 'Renderer init failed';
      this.commit();
      throw err;
    }

    this.renderer.onDeviceLost(() => {
      // Per spec: a lost device is unrecoverable here — hard reload.
      if (typeof location !== 'undefined') location.reload();
    });

    if (this.settings.reducedMotion === 'on' || resolveReducedMotion('auto')) {
      // honored per-frame; cinematic disabled below if reduced motion
    }
    if (this.reducedMotion()) {
      this.cinematicActive = false;
      this.camera.setExtraDistance(0);
    }

    this.applyBackendQuality();
    this.resize();
    this.input.attach(this.canvas);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas);
    }

    if (this.settings.quality === 'auto' && this.backend === 'webgpu') {
      this.quality.startProbe(performance.now(), 4000, (tier) => {
        this.applyTier(QUALITY_PRESETS[tier]);
      });
    }

    // Honor a persisted free-camera preference: seed the fly-cam state and
    // switch input routing before the RAF loop begins.
    if (this.settings.freeCamera) {
      this.enterFreeCamera();
    }

    this.running = true;
    this.lastTs = performance.now();
    this.lastStatsTs = this.lastTs;
    this.rafId = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.input.detach();
    this.resizeObserver?.disconnect();
    this.renderer?.destroy();
    this.renderer = null;
  }

  private async createRenderer(onProgress?: LoadProgressFn): Promise<SceneRenderer> {
    const force = this.settings.forceBackend;
    if (force !== 'webgl2' && typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        const r = new WebGPURenderer();
        await r.init(this.canvas, onProgress);
        return r;
      } catch (err) {
        console.warn('WebGPU unavailable, falling back to WebGL2:', err);
      }
    }
    const r2 = new WebGL2Renderer();
    await r2.init(this.canvas, onProgress);
    return r2;
  }

  private applyBackendQuality(): void {
    if (this.backend === 'webgl2') {
      this.applyTier(QUALITY_PRESETS.webgl2);
    } else if (this.settings.quality !== 'auto') {
      this.applyTier(QUALITY_PRESETS[this.settings.quality]);
    }
  }

  // ---- main loop ----

  private loop = (ts: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);
    if (typeof document !== 'undefined' && document.hidden) {
      this.lastTs = ts;
      return;
    }

    const dt = clamp((ts - this.lastTs) / 1000, 0, 0.05);
    this.lastTs = ts;
    const frameMs = dt * 1000;

    this.quality.sample(ts, frameMs);
    this.trackFps(ts, frameMs);

    const modalOpen = this.openPoi !== null;
    this.blurCurrent = damp(this.blurCurrent, modalOpen ? 1 : 0, 9, dt);

    if (this.settings.freeCamera) {
      this.updateFreeCamera(dt, ts, modalOpen);
    } else {
      if (this.cinematicActive) {
        this.cinematicT += dt / FLY_IN_SECONDS;
        const e = easing.cubicOut(Math.min(1, this.cinematicT));
        this.camera.setExtraDistance(lerp(FLY_IN_DISTANCE, 0, e));
        if (this.cinematicT >= 1) {
          this.cinematicActive = false;
          this.camera.setExtraDistance(0);
          this.events.emit('flyInDone', null);
        }
      }

      if (!modalOpen) {
        this.time += dt;
        this.moonTime += dt * (this.reducedMotion() ? 0.0 : 1.0);
        this.scrubCurrent = damp(this.scrubCurrent, this.scrubTarget, 8, dt);
        this.zoomCurrent = damp(this.zoomCurrent, this.zoomTarget, 9, dt);
        this.updateRotations(dt, ts);
        this.updateFocus();
      }

      this.camera.setZoom(this.zoomCurrent);
      this.camera.update(this.scrubCurrent);
    }
    this.renderFrame();

    if (!this.ready) {
      this.ready = true;
      this.loadState = { frac: 1, label: this.loadState.label, ready: true };
      this.events.emit('loadProgress', this.loadState);
      this.events.emit('ready', null);
      this.commit();
    }
  };

  // Free-fly camera: integrate input axes into velocity (damped → momentum),
  // integrate position, then push the resulting eye+orientation to the camera.
  // Always drives the camera while free mode is on — even with a modal open,
  // so the rendered viewpoint stays put instead of snapping behind the modal.
  private updateFreeCamera(dt: number, ts: number, modalOpen: boolean): void {
    if (!modalOpen) {
      this.time += dt;
      this.moonTime += dt * (this.reducedMotion() ? 0.0 : 1.0);
      this.updateRotations(dt, ts);
    }

    let fAx = 0;
    let rAx = 0;
    let speedMul = 1;
    if (!modalOpen) {
      const a = this.input.getMovementAxes();
      fAx = a.forward;
      rAx = a.right;
      speedMul = this.input.getSpeedModifier();
    }

    const cp = Math.cos(this.freePitch);
    const sp = Math.sin(this.freePitch);
    const cy = Math.cos(this.freeYaw);
    const sy = Math.sin(this.freeYaw);
    // Forward includes pitch (so pitching up/down lifts/dives the camera);
    // right is screen-horizontal. No dedicated up axis — Shift/Space modify
    // speed, not direction.
    const fwdX = sy * cp;
    const fwdY = sp;
    const fwdZ = -cy * cp;
    const rightX = cy;
    const rightZ = sy;

    // Normalize axes so diagonal presses don't move faster than a cardinal.
    // Only normalize when over-saturated (>1): keyboard cardinals (mag 1) and
    // the analog mobile thumbstick (mag <1) keep their magnitude so partial
    // stick deflection gives proportional speed; diagonals/combined inputs that
    // exceed 1 are clamped to unit speed.
    const axesMag = Math.hypot(fAx, rAx);
    let nf = 0;
    let nr = 0;
    if (axesMag > 1) {
      nf = fAx / axesMag;
      nr = rAx / axesMag;
    } else {
      nf = fAx;
      nr = rAx;
    }
    const speed = FLY_SPEED * speedMul;
    const targetVx = (fwdX * nf + rightX * nr) * speed;
    const targetVy = fwdY * nf * speed;
    const targetVz = (fwdZ * nf + rightZ * nr) * speed;

    this.freeVelocity[0] = damp(this.freeVelocity[0], targetVx, FLY_VELOCITY_DAMP, dt);
    this.freeVelocity[1] = damp(this.freeVelocity[1], targetVy, FLY_VELOCITY_DAMP, dt);
    this.freeVelocity[2] = damp(this.freeVelocity[2], targetVz, FLY_VELOCITY_DAMP, dt);

    this.freePos[0] += this.freeVelocity[0] * dt;
    this.freePos[1] += this.freeVelocity[1] * dt;
    this.freePos[2] += this.freeVelocity[2] * dt;

    this.camera.updateFree(this.freePos, this.freeYaw, this.freePitch);
  }

  // Seed free-fly state from the current dolly camera so toggling on doesn't
  // teleport. Also cancels the intro cinematic; bypasses scrub plumbing.
  private enterFreeCamera(): void {
    const eye: Vec3 = [
      this.camera.position[0],
      this.camera.position[1],
      this.camera.position[2],
    ];
    const focusZ = this.scrubCurrent * PLANET_SPACING;
    const center: Vec3 = [0, 0, focusZ - 1.5];
    const fwd = vec3.normalize(vec3.sub(center, eye));
    this.freePos = eye;
    this.freeYaw = Math.atan2(fwd[0], -fwd[2]);
    this.freePitch = Math.asin(clamp(fwd[1], -1, 1));
    this.freeVelocity = [0, 0, 0];
    this.cinematicActive = false;
    this.camera.setExtraDistance(0);
    this.input.setFreeMode(true);
  }

  private updateRotations(dt: number, ts: number): void {
    const reduced = this.reducedMotion();
    const recentlyOrbited = ts / 1000 - this.lastInteract < 2.5;

    // Per-planet cloud pacing: ease the drift toward a slow crawl when the
    // planet's spin is paused so clouds visibly decelerate with the surface
    // but never fully stop (a frozen cloud layer reads as a broken render).
    // Under reduced motion the cloud shader already applies its own slowdown
    // multiplier, so keep pace at 1 there and let the shader handle it.
    const PAUSED_CLOUD_PACE = 0.3;
    const k = 1 - Math.exp(-dt * 3);
    for (let i = 0; i < this.cloudPace.length; i++) {
      const paused = !reduced && recentlyOrbited && i === this.lastOrbitIndex;
      const target = paused ? PAUSED_CLOUD_PACE : 1;
      this.cloudPace[i] = this.cloudPace[i]! + (target - this.cloudPace[i]!) * k;
      this.cloudTimes[i] = this.cloudTimes[i]! + dt * this.cloudPace[i]!;
    }

    if (reduced) return;
    for (let i = 0; i < this.orientations.length; i++) {
      if (recentlyOrbited && i === this.lastOrbitIndex) continue;
      const focusDist = Math.abs(i - this.scrubCurrent);
      const speed = 0.06 + 0.04 / (1 + focusDist);
      const spin = quat.fromAxisAngle([0, 1, 0], dt * speed);
      this.orientations[i] = quat.normalize(
        quat.multiply(this.orientations[i]!, spin),
      );
    }
  }

  private updateFocus(): void {
    const fi = clamp(Math.round(this.scrubCurrent), 0, this.models.length - 1);
    if (fi !== this.focusedIndex) {
      this.focusedIndex = fi;
      this.events.emit('focusChanged', fi);
      this.commit();
    }
  }

  private renderFrame(): void {
    const r = this.renderer;
    if (!r) return;
    const planets = this.models.map((m, i) => {
      const focus = clamp(1 - Math.abs(i - this.scrubCurrent) * 0.6, 0, 1);
      return instanceFromModel(
        m,
        this.moonTime,
        this.cloudTimes[i] ?? 0,
        this.orientations[i] ?? quat.identity(),
        focus,
        this.planetVisibility(i),
      );
    });
    const frame: FrameState = {
      time: this.time,
      moonTime: this.moonTime,
      view: this.camera.view,
      proj: this.camera.proj,
      viewProj: this.camera.viewProj,
      invViewProj: this.camera.invViewProj,
      cameraPos: this.camera.position,
      keyLightDir: KEY_LIGHT,
      sun: this.sun,
      planets,
      quality: this.activeQuality,
      shadowCasters: this.activeQuality.shadows
        ? planets
            .filter((p) => p.visibility > 0.5)
            // Sort by visible projected radius so the largest occluders win
            // the 8-slot budget; a small fading body shouldn't crowd out a
            // large nearby planet.
            .map((p) => ({ center: p.center, radius: p.radius * p.visibility }))
            .sort((a, b) => b.radius - a.radius)
            .slice(0, 8)
        : [],
      blur: this.blurCurrent,
      reducedMotion: this.reducedMotion(),
      wireframe: this.settings.wireframe,
      flightPath: this.settings.flightPath ? this.flightPath : new Float32Array(0),
    };
    r.render(frame);
  }

  private trackFps(ts: number, frameMs: number): void {
    this.fpsFrames++;
    this.fpsAccum += frameMs;
    if (ts - this.lastStatsTs >= 250) {
      this.fps = this.fpsFrames / ((ts - this.lastStatsTs) / 1000);
      this.fpsFrames = 0;
      this.fpsAccum = 0;
      this.lastStatsTs = ts;
      if (this.settings.debugHud) this.commit();
    }
  }

  // ---- input intents ----

  private onUserInteract(): void {
    this.lastInteract = performance.now() / 1000;
    if (this.cinematicActive) {
      this.cinematicActive = false;
      this.camera.setExtraDistance(0);
      this.events.emit('flyInDone', null);
    }
  }

  private onScrub(delta: number): void {
    if (this.openPoi) return;
    this.scrubTarget = clamp(this.scrubTarget + delta, 0, this.models.length - 1);
  }

  private onScrubEnd(): void {
    if (this.openPoi) return;
    this.scrubTarget = clamp(
      Math.round(this.scrubCurrent),
      0,
      this.models.length - 1,
    );
  }

  private onOrbit(dx: number, dy: number): void {
    if (this.openPoi) return;
    const idx = clamp(Math.round(this.scrubCurrent), 0, this.models.length - 1);
    this.lastOrbitIndex = idx;
    this.lastInteract = performance.now() / 1000;
    // Trackball: premultiply by screen-relative axes so dragging rotates the
    // planet about the camera's right (horizontal) and up (vertical) axes,
    // letting the user spin it in any direction.
    const qy = quat.fromAxisAngle([0, 1, 0], dx * 0.01);
    const qx = quat.fromAxisAngle([1, 0, 0], dy * 0.01);
    const delta = quat.multiply(qy, qx);
    this.orientations[idx] = quat.normalize(
      quat.multiply(delta, this.orientations[idx] ?? quat.identity()),
    );
  }

  private onZoom(factor: number): void {
    if (this.openPoi) return;
    this.zoomTarget = clamp(this.zoomTarget * factor, 0.6, 1.6);
  }

  // Pointer drag in free-fly mode. Drag right → yaw++, drag down → pitch--.
  private onLook(dx: number, dy: number): void {
    if (!this.settings.freeCamera || this.openPoi) return;
    this.freeYaw += dx * LOOK_SENSITIVITY;
    this.freePitch -= dy * LOOK_SENSITIVITY;
    if (this.freePitch > PITCH_LIMIT) this.freePitch = PITCH_LIMIT;
    else if (this.freePitch < -PITCH_LIMIT) this.freePitch = -PITCH_LIMIT;
  }

  private handlePick(ndcX: number, ndcY: number): void {
    if (this.openPoi) return;
    const ray = rayFromNDC(ndcX, ndcY, this.camera.invViewProj);

    let hitIndex = -1;
    let hitT = Infinity;
    for (let i = 0; i < this.models.length; i++) {
      if (this.planetVisibility(i) <= 0.2) continue; // hidden planets aren't pickable
      const m = this.models[i]!;
      const t = raySphere(ray, [0, 0, m.z], m.radius);
      if (t >= 0 && t < hitT) {
        hitT = t;
        hitIndex = i;
      }
    }

    // POIs are only active on the focused ("current") planet, matching what's
    // rendered. They float beside the planet, so test them independently of the
    // planet hit — otherwise a marker off to the side (not overlapping the
    // planet disk) would never be clickable.
    let bestPoi = -1;
    let bestT = Infinity;
    const focused = this.focusedIndex;
    if (focused >= 0 && this.planetVisibility(focused) > 0.2) {
      const model = this.models[focused]!;
      const center: Vec3 = [0, 0, model.z];
      const rot = this.orientations[focused] ?? quat.identity();
      const markerDist = poiMarkerDistance(model.radius);
      // POI markers are rendered as fixed-screen-size billboards, so their
      // pick collider must also be screen-size: a world-space radius equal to
      // what the marker's on-screen circle subtends at the marker's distance
      // from the camera. markerNdc is the marker circle's NDC half-extent at
      // full focus (size factor 0.027 + 0.021 * focus, rim at uv 0.85); the
      // world radius at camera distance d is markerNdc * d / projY.
      const markerNdc = (0.027 + 0.021) * 0.85;
      const projY = this.camera.proj[5]!;
      const camPos = this.camera.position;
      const pickScale = (this.coarsePointer ? 1.8 : 1) / projY;
      // Distance to the planet body along this ray, used to reject only POIs
      // that are genuinely hidden behind the planet (true backside). Markers on
      // the horizon are pulled outside the silhouette and stay clickable.
      const planetT = raySphere(ray, center, model.radius);
      for (let i = 0; i < model.poiDirs.length; i++) {
        const poi = model.poiDirs[i]!;
        const dir = quat.rotateVec3(rot, poi.dir);
        const world = vec3.add(center, vec3.scale(dir, markerDist));
        const camDist = vec3.length(vec3.sub(world, camPos));
        const pickR = markerNdc * camDist * pickScale;
        const t = raySphere(ray, world, pickR);
        if (t < 0) continue;
        if (planetT >= 0 && planetT < t) continue; // occluded by the planet body
        if (t < bestT) {
          bestT = t;
          bestPoi = i;
        }
      }
    }

    // A clicked POI marker (in front of the planet) wins over the planet body.
    if (bestPoi >= 0) {
      const model = this.models[focused]!;
      const poi = model.poiDirs[bestPoi]!;
      this.scrubTarget = focused;
      this.openPoiRef(model.company.slug, poi.slug);
      return;
    }

    if (hitIndex >= 0) this.jumpToPlanet(hitIndex);
  }

  // ---- public API for React / routing ----

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): EngineSnapshot => this.snapshot;

  // Latest startup progress for the loading bar. Read on mount so a late
  // subscriber still reflects (or dismisses past) progress already emitted.
  getLoadState = (): LoadState => this.loadState;

  get backend(): RendererBackend | null {
    return this.renderer?.backend ?? null;
  }

  jumpToPlanet(index: number): void {
    this.onUserInteract();
    this.scrubTarget = clamp(index, 0, this.models.length - 1);
  }

  openPoiRef(company: string, poi: string): void {
    const idx = this.models.findIndex((m) => m.company.slug === company);
    if (idx >= 0) this.scrubTarget = idx;
    this.openPoi = { company, poi };
    this.events.emit('poiOpened', this.openPoi);
    this.commit();
  }

  closePoi(): void {
    if (!this.openPoi) return;
    this.openPoi = null;
    this.events.emit('poiClosed', null);
    this.commit();
  }

  setQualityPreference(pref: QualityPreference): void {
    this.settings.quality = pref;
    saveSettings(this.settings);
    if (this.backend === 'webgl2') {
      this.applyTier(QUALITY_PRESETS.webgl2);
    } else if (pref === 'auto') {
      this.quality.startProbe(performance.now(), 3000, (tier) =>
        this.applyTier(QUALITY_PRESETS[tier]),
      );
    } else {
      this.applyTier(QUALITY_PRESETS[pref]);
    }
    this.commit();
  }

  setReducedMotion(pref: ReducedMotionPref): void {
    this.settings.reducedMotion = pref;
    saveSettings(this.settings);
    if (this.reducedMotion()) {
      this.cinematicActive = false;
      this.camera.setExtraDistance(0);
    }
    this.commit();
  }

  setForceBackend(pref: BackendPref): void {
    if (this.settings.forceBackend === pref) return;
    this.settings.forceBackend = pref;
    saveSettings(this.settings);
    this.commit();
    // A canvas keeps the same context type (webgpu/webgl2) for its lifetime, so
    // swapping the active renderer requires a fresh page load. The preference is
    // persisted above and honored by createRenderer() on the next startup.
    if (typeof location !== 'undefined') location.reload();
  }

  setDebugHud(on: boolean): void {
    this.settings.debugHud = on;
    saveSettings(this.settings);
    this.commit();
  }

  setWireframe(on: boolean): void {
    this.settings.wireframe = on;
    saveSettings(this.settings);
    this.commit();
  }

  setFreeCamera(on: boolean): void {
    if (this.settings.freeCamera === on) return;
    this.settings.freeCamera = on;
    saveSettings(this.settings);
    if (on) {
      this.enterFreeCamera();
    } else {
      this.input.setFreeMode(false);
      this.freeVelocity = [0, 0, 0];
    }
    this.commit();
  }

  setFlightPath(on: boolean): void {
    if (this.settings.flightPath === on) return;
    this.settings.flightPath = on;
    saveSettings(this.settings);
    this.commit();
  }

  // ---- helpers ----

  private reducedMotion(): boolean {
    return resolveReducedMotion(this.settings.reducedMotion);
  }

  // Planets more recent than the focused one (higher index after the timeline
  // was reversed) fade out so only the selected planet and older ones receding
  // behind it remain. In free-fly mode all planets stay fully visible so the
  // user can fly toward any of them without timeline fade-out hiding them.
  private planetVisibility(i: number): number {
    if (this.settings.freeCamera) return 1;
    const rel = i - this.scrubCurrent; // > 0 => planet i is more recent
    if (rel <= 0.2) return 1;
    return clamp(1 - (rel - 0.2) / 0.7, 0, 1);
  }

  private applyTier(q: QualitySettings): void {
    this.activeQuality = q;
    this.activeTier = q.tier;
    this.resize();
    this.events.emit('qualityChanged', q.tier);
    this.commit();
  }

  private resize(): void {
    const r = this.renderer;
    if (!r) return;
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.activeQuality.dprCap);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    this.camera.setAspect(w / h);
    r.resize(w, h, dpr);
  }

  private buildSnapshot(): EngineSnapshot {
    const stats: RenderStats = this.renderer?.getStats() ?? {
      drawCalls: 0,
      triangles: 0,
      gpuMemoryMB: 0,
    };
    const freeCameraState = this.settings.freeCamera
      ? {
          position: [
            this.freePos[0],
            this.freePos[1],
            this.freePos[2],
          ] as Vec3,
          yawDeg: normalizeYawDeg((this.freeYaw * 180) / Math.PI),
          pitchDeg: (this.freePitch * 180) / Math.PI,
        }
      : null;
    return {
      backend: this.backend,
      ready: this.ready,
      failed: this.failed,
      focusedIndex: this.focusedIndex,
      openPoi: this.openPoi,
      quality: this.settings.quality,
      activeTier: this.activeTier,
      reducedMotion: this.settings.reducedMotion,
      forceBackend: this.settings.forceBackend,
      debugHud: this.settings.debugHud,
      wireframe: this.settings.wireframe,
      freeCamera: this.settings.freeCamera,
      freeCameraState,
      flightPath: this.settings.flightPath,
      stats: { ...stats, fps: Math.round(this.fps) },
    };
  }

  private commit(): void {
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach((l) => l());
  }
}
