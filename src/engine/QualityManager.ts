import type { QualitySettings, QualityTier } from './types';

export const QUALITY_PRESETS: Record<QualityTier, QualitySettings> = {
  high: {
    tier: 'high',
    dprCap: 2,
    starCount: 10000,
    ssao: true,
    chromaticAberration: true,
    bloomMips: 3,
    msaa: 4,
    shadows: true,
    backdropScale: 0.4,
    postScale: 0.5,
  },
  med: {
    tier: 'med',
    dprCap: 1.25,
    starCount: 2000,
    ssao: false,
    chromaticAberration: true,
    bloomMips: 2,
    msaa: 4,
    shadows: true,
    backdropScale: 0.35,
    postScale: 0.5,
  },
  low: {
    tier: 'low',
    dprCap: 1,
    starCount: 800,
    ssao: false,
    chromaticAberration: false,
    bloomMips: 0,
    msaa: 1,
    shadows: false,
    backdropScale: 0.3,
    postScale: 0.5,
  },
  webgl2: {
    tier: 'webgl2',
    dprCap: 1,
    starCount: 2000,
    ssao: false,
    chromaticAberration: false,
    bloomMips: 1,
    msaa: 1,
    shadows: false,
    backdropScale: 1,
    postScale: 1,
  },
};

export type QualityPreference = 'auto' | QualityTier;

// Ascending Auto-ramp order: start at the cheapest tier and step up.
const RAMP_ORDER: QualityTier[] = ['low', 'med', 'high'];

// A frame at or below this time (~55 FPS) counts as "good".
const GOOD_FRAME_MS = 18;
// A single frame slower than this is treated as a stall (tab switch, GC, page
// load hitch) and ignored rather than counted against stability.
const STALL_FRAME_MS = 500;
// Performance must stay good for this long before stepping up a tier.
const STABLE_MS = 3000;

// Auto quality ramp: begins at Low and steps up one tier at a time whenever
// performance stays good (frame time at or under GOOD_FRAME_MS) and stable for
// STABLE_MS continuously. A janky frame resets the stability window, so the
// ramp only climbs when the device comfortably sustains the current tier.
export class QualityManager {
  private active = false;
  private currentTier: QualityTier = 'low';
  private stableSince = 0;
  private onStepUp: ((tier: QualityTier) => void) | null = null;

  // Begin ramping up from `startTier`. The caller is responsible for having
  // already applied `startTier`; `onStepUp` is invoked with each higher tier.
  start(startTier: QualityTier, onStepUp: (tier: QualityTier) => void): void {
    this.currentTier = startTier;
    this.onStepUp = onStepUp;
    this.stableSince = 0;
    // Nothing to ramp toward if we're already at the top of the order.
    this.active = this.nextTier(startTier) !== null;
  }

  // Halt the ramp (e.g. the user picked an explicit tier).
  stop(): void {
    this.active = false;
    this.onStepUp = null;
    this.stableSince = 0;
  }

  get isActive(): boolean {
    return this.active;
  }

  sample(now: number, frameMs: number): void {
    if (!this.active) return;
    // Ignore stalls and invalid deltas so a tab switch doesn't reset progress.
    if (frameMs <= 0 || frameMs >= STALL_FRAME_MS) return;

    if (frameMs <= GOOD_FRAME_MS) {
      if (this.stableSince === 0) this.stableSince = now;
      if (now - this.stableSince >= STABLE_MS) this.stepUp();
    } else {
      // A janky frame breaks stability; restart the window.
      this.stableSince = 0;
    }
  }

  private stepUp(): void {
    const next = this.nextTier(this.currentTier);
    if (next === null) {
      this.stop();
      return;
    }
    this.currentTier = next;
    this.stableSince = 0;
    this.onStepUp?.(next);
    // Once we reach the top tier there is nowhere left to climb.
    if (this.nextTier(next) === null) {
      this.active = false;
      this.onStepUp = null;
    }
  }

  private nextTier(tier: QualityTier): QualityTier | null {
    const i = RAMP_ORDER.indexOf(tier);
    if (i < 0 || i >= RAMP_ORDER.length - 1) return null;
    return RAMP_ORDER[i + 1]!;
  }
}
