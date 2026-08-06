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
// A frame at or above this time (~36 FPS) counts as "bad". Frames between
// GOOD and BAD are neither: they neither earn a step up nor force a step down.
const BAD_FRAME_MS = 28;
// A single frame slower than this is treated as a stall (tab switch, GC, page
// load hitch) and ignored rather than counted against stability.
const STALL_FRAME_MS = 500;
// Performance must stay good for this long before stepping up a tier.
const STABLE_MS = 3000;
// Performance must stay bad for this long before stepping back down. Shorter
// than STABLE_MS so a tier the device can't sustain is abandoned quickly.
const UNSTABLE_MS = 1500;
// Samples taken within this long after a tier change are ignored: applying a
// tier resizes targets and rebuilds pipelines, which costs a few slow frames
// that say nothing about the new tier's steady-state cost.
const SETTLE_MS = 1000;

// Auto quality ramp: begins at Low and steps up one tier at a time whenever
// performance stays good (frame time at or under GOOD_FRAME_MS) and stable for
// STABLE_MS continuously. A janky frame resets the stability window, so the
// ramp only climbs when the device comfortably sustains the current tier.
//
// The ramp also steps back down if frame time stays at or above BAD_FRAME_MS
// for UNSTABLE_MS. The step-up decision can only measure whatever happens to
// be on screen at the time, and the scene's cost varies a lot with the camera
// (a large planet filling the viewport is many times more expensive than a
// distant one), so a tier that looked affordable can turn out not to be. A
// tier that fails this way is ratcheted off permanently for the session, so
// the ramp settles instead of oscillating between two tiers.
export class QualityManager {
  private active = false;
  private currentTier: QualityTier = 'low';
  // Highest tier the ramp is still allowed to reach. Lowered whenever a tier
  // proves unsustainable, so a failed tier is never retried this session.
  private ceilingIndex = RAMP_ORDER.length - 1;
  private stableSince = 0;
  private unstableSince = 0;
  private settleUntil = 0;
  private onTierChange: ((tier: QualityTier) => void) | null = null;

  // Begin ramping from `startTier`. The caller is responsible for having
  // already applied `startTier`; `onTierChange` is invoked with each new tier,
  // whether the ramp stepped up or back down.
  start(
    startTier: QualityTier,
    onTierChange: (tier: QualityTier) => void,
  ): void {
    this.currentTier = startTier;
    this.onTierChange = onTierChange;
    this.stableSince = 0;
    this.unstableSince = 0;
    this.settleUntil = 0;
    this.ceilingIndex = RAMP_ORDER.length - 1;
    this.active = true;
  }

  // Halt the ramp (e.g. the user picked an explicit tier).
  stop(): void {
    this.active = false;
    this.onTierChange = null;
    this.stableSince = 0;
    this.unstableSince = 0;
  }

  get isActive(): boolean {
    return this.active;
  }

  sample(now: number, frameMs: number): void {
    if (!this.active) return;
    // Ignore stalls and invalid deltas so a tab switch doesn't reset progress.
    if (frameMs <= 0 || frameMs >= STALL_FRAME_MS) return;
    // Ignore the resize/pipeline-rebuild hitch right after a tier change.
    if (now < this.settleUntil) return;

    if (frameMs <= GOOD_FRAME_MS) {
      this.unstableSince = 0;
      if (this.stableSince === 0) this.stableSince = now;
      if (now - this.stableSince >= STABLE_MS) this.stepUp(now);
    } else if (frameMs >= BAD_FRAME_MS) {
      this.stableSince = 0;
      if (this.unstableSince === 0) this.unstableSince = now;
      if (now - this.unstableSince >= UNSTABLE_MS) this.stepDown(now);
    } else {
      // Middling frame: neither earns a step up nor forces a step down.
      this.stableSince = 0;
      this.unstableSince = 0;
    }
  }

  private stepUp(now: number): void {
    const next = this.nextTier(this.currentTier);
    if (next === null) {
      this.stableSince = 0;
      this.refreshActive();
      return;
    }
    this.changeTier(next, now);
  }

  private stepDown(now: number): void {
    const prev = this.prevTier(this.currentTier);
    if (prev === null) {
      // Already at the bottom — nothing left to shed, so stop counting.
      this.unstableSince = 0;
      this.refreshActive();
      return;
    }
    // Ratchet: the tier we're leaving is not sustainable on this device, so
    // take it (and everything above it) off the table for the rest of the
    // session. Without this the ramp would climb straight back into it.
    this.ceilingIndex = Math.min(
      this.ceilingIndex,
      RAMP_ORDER.indexOf(this.currentTier) - 1,
    );
    this.changeTier(prev, now);
  }

  private changeTier(tier: QualityTier, now: number): void {
    this.currentTier = tier;
    this.stableSince = 0;
    this.unstableSince = 0;
    this.settleUntil = now + SETTLE_MS;
    this.onTierChange?.(tier);
    this.refreshActive();
  }

  // The ramp only needs to keep running while some move is still possible:
  // a step up toward the ceiling, or a step down away from the bottom.
  private refreshActive(): void {
    const canStepUp = this.nextTier(this.currentTier) !== null;
    const canStepDown = this.prevTier(this.currentTier) !== null;
    if (!canStepUp && !canStepDown) this.stop();
  }

  private nextTier(tier: QualityTier): QualityTier | null {
    const i = RAMP_ORDER.indexOf(tier);
    if (i < 0 || i >= this.ceilingIndex) return null;
    return RAMP_ORDER[i + 1]!;
  }

  private prevTier(tier: QualityTier): QualityTier | null {
    const i = RAMP_ORDER.indexOf(tier);
    if (i <= 0) return null;
    return RAMP_ORDER[i - 1]!;
  }
}
