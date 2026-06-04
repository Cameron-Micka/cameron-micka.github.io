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
    fxaa: true,
    shadows: true,
  },
  med: {
    tier: 'med',
    dprCap: 1.25,
    starCount: 2000,
    ssao: false,
    chromaticAberration: true,
    bloomMips: 2,
    msaa: 4,
    fxaa: false,
    shadows: true,
  },
  low: {
    tier: 'low',
    dprCap: 1,
    starCount: 800,
    ssao: false,
    chromaticAberration: false,
    bloomMips: 0,
    msaa: 4,
    fxaa: false,
    shadows: false,
  },
  webgl2: {
    tier: 'webgl2',
    dprCap: 1,
    starCount: 2000,
    ssao: false,
    chromaticAberration: false,
    bloomMips: 1,
    msaa: 1,
    fxaa: false,
    shadows: false,
  },
};

export type QualityPreference = 'auto' | QualityTier;

function isCoarsePointer(): boolean {
  return (
    typeof matchMedia !== 'undefined' &&
    matchMedia('(pointer: coarse)').matches
  );
}

// Runs a short probe by sampling median frame time, then maps to a tier.
export class QualityManager {
  private samples: number[] = [];
  private probing = false;
  private probeUntil = 0;
  private onResolved: ((tier: QualityTier) => void) | null = null;

  startProbe(now: number, durationMs: number, cb: (tier: QualityTier) => void): void {
    this.samples = [];
    this.probing = true;
    this.probeUntil = now + durationMs;
    this.onResolved = cb;
  }

  get isProbing(): boolean {
    return this.probing;
  }

  sample(now: number, frameMs: number): void {
    if (!this.probing) return;
    // Ignore the first few warm-up frames.
    if (frameMs > 0 && frameMs < 500) this.samples.push(frameMs);
    if (now >= this.probeUntil) this.resolve();
  }

  private resolve(): void {
    this.probing = false;
    let tier: QualityTier = 'low';
    // On mobile (coarse pointer) devices, Low is the default Auto tier.
    if (!isCoarsePointer()) {
      const median = this.median();
      if (median <= 17) tier = 'high';
      else if (median <= 25) tier = 'med';
    }
    this.onResolved?.(tier);
    this.onResolved = null;
  }

  private median(): number {
    if (this.samples.length === 0) return 16.7;
    const s = [...this.samples].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  }
}
