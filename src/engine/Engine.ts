import type {
  FrameState,
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
  instanceFromModel,
  poiMarkerDistance,
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
  sound: boolean;
  reducedMotion: ReducedMotionPref;
  debugHud: boolean;
  wireframe: boolean;
  stats: RenderStats & { fps: number };
}

export type EngineEvents = {
  focusChanged: number;
  poiOpened: OpenPoiRef;
  poiClosed: null;
  qualityChanged: QualityTier;
  ready: null;
  flyInDone: null;
};

const FLY_IN_SECONDS = 2.2;
const FLY_IN_DISTANCE = 42;
const KEY_LIGHT: Vec3 = vec3.normalize([0.4, 0.85, -0.45]);

export class Engine {
  readonly events = new TinyEventEmitter<EngineEvents>();

  private canvas: HTMLCanvasElement;
  private renderer: SceneRenderer | null = null;
  private camera = new Camera();
  private models: PlanetModel[];
  private quality = new QualityManager();
  private input: InputController;
  private settings: PersistedSettings;

  private activeQuality: QualitySettings;
  private activeTier: QualityTier = 'high';

  private orientations: Quat[];
  private scrubCurrent = 0;
  private scrubTarget = 0;
  private zoomTarget = 1;
  private zoomCurrent = 1;
  private blurCurrent = 0;
  private time = 0;
  private focusedIndex = 0;
  private openPoi: OpenPoiRef | null = null;
  private lastOrbitIndex = -1;
  private lastInteract = -10;

  private cinematicActive = true;
  private cinematicT = 0;

  private running = false;
  private rafId = 0;
  private lastTs = 0;
  private ready = false;
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
    });

    this.snapshot = this.buildSnapshot();
  }

  // ---- lifecycle ----

  async start(): Promise<void> {
    try {
      this.renderer = await this.createRenderer();
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

  private async createRenderer(): Promise<SceneRenderer> {
    const force = this.settings.forceBackend;
    if (force !== 'webgl2' && typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        const r = new WebGPURenderer();
        await r.init(this.canvas);
        return r;
      } catch (err) {
        console.warn('WebGPU unavailable, falling back to WebGL2:', err);
      }
    }
    const r2 = new WebGL2Renderer();
    await r2.init(this.canvas);
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
      this.scrubCurrent = damp(this.scrubCurrent, this.scrubTarget, 8, dt);
      this.zoomCurrent = damp(this.zoomCurrent, this.zoomTarget, 9, dt);
      this.updateRotations(dt, ts);
      this.updateFocus();
    }

    this.camera.setZoom(this.zoomCurrent);
    this.camera.update(this.scrubCurrent);
    this.renderFrame();

    if (!this.ready) {
      this.ready = true;
      this.events.emit('ready', null);
      this.commit();
    }
  };

  private updateRotations(dt: number, ts: number): void {
    if (this.reducedMotion()) return;
    const recentlyOrbited = ts / 1000 - this.lastInteract < 2.5;
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
        this.time,
        this.orientations[i] ?? quat.identity(),
        focus,
        this.planetVisibility(i),
      );
    });
    const frame: FrameState = {
      time: this.time,
      view: this.camera.view,
      proj: this.camera.proj,
      viewProj: this.camera.viewProj,
      cameraPos: this.camera.position,
      keyLightDir: KEY_LIGHT,
      planets,
      quality: this.activeQuality,
      blur: this.blurCurrent,
      reducedMotion: this.reducedMotion(),
      wireframe: this.settings.wireframe,
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
      const pickR = model.radius * 0.16 * (this.coarsePointer ? 1.8 : 1);
      const markerDist = poiMarkerDistance(model.radius);
      // Distance to the planet body along this ray, used to reject only POIs
      // that are genuinely hidden behind the planet (true backside). Markers on
      // the horizon are pulled outside the silhouette and stay clickable.
      const planetT = raySphere(ray, center, model.radius);
      for (let i = 0; i < model.poiDirs.length; i++) {
        const poi = model.poiDirs[i]!;
        const dir = quat.rotateVec3(rot, poi.dir);
        const world = vec3.add(center, vec3.scale(dir, markerDist));
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

  setSound(on: boolean): void {
    this.settings.sound = on;
    saveSettings(this.settings);
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

  skipIntro(): void {
    this.onUserInteract();
  }

  // ---- helpers ----

  private reducedMotion(): boolean {
    return resolveReducedMotion(this.settings.reducedMotion);
  }

  // Planets more recent than the focused one (higher index after the timeline
  // was reversed) fade out so only the selected planet and older ones receding
  // behind it remain.
  private planetVisibility(i: number): number {
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
    return {
      backend: this.backend,
      ready: this.ready,
      failed: this.failed,
      focusedIndex: this.focusedIndex,
      openPoi: this.openPoi,
      quality: this.settings.quality,
      activeTier: this.activeTier,
      sound: this.settings.sound,
      reducedMotion: this.settings.reducedMotion,
      debugHud: this.settings.debugHud,
      wireframe: this.settings.wireframe,
      stats: { ...stats, fps: Math.round(this.fps) },
    };
  }

  private commit(): void {
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach((l) => l());
  }
}
