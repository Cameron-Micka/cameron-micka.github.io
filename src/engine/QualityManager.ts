import type { QualitySettings, QualityTier } from './types';

export const QUALITY_PRESETS: Record<QualityTier, QualitySettings> = {
  ultra: {
    tier: 'ultra',
    dprCap: 2,
    starCount: 10000,
    ssao: true,
    clouds: true,
    chromaticAberration: true,
    bloomMips: 3,
  },
  high: {
    tier: 'high',
    dprCap: 1.5,
    starCount: 5000,
    ssao: true,
    clouds: true,
    chromaticAberration: true,
    bloomMips: 3,
  },
  med: {
    tier: 'med',
    dprCap: 1.25,
    starCount: 2000,
    ssao: false,
    clouds: true,
    chromaticAberration: true,
    bloomMips: 2,
  },
  low: {
    tier: 'low',
    dprCap: 1,
    starCount: 0,
    ssao: false,
    clouds: false,
    chromaticAberration: false,
    bloomMips: 1,
  },
  webgl2: {
    tier: 'webgl2',
    dprCap: 1,
    starCount: 2000,
    ssao: false,
    clouds: true,
    chromaticAberration: false,
    bloomMips: 1,
  },
};

export type QualityPreference = 'auto' | QualityTier;

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
    const median = this.median();
    let tier: QualityTier = 'low';
    if (median <= 12) tier = 'ultra';
    else if (median <= 17) tier = 'high';
    else if (median <= 25) tier = 'med';
    this.onResolved?.(tier);
    this.onResolved = null;
  }

  private median(): number {
    if (this.samples.length === 0) return 16.7;
    const s = [...this.samples].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  }
}
