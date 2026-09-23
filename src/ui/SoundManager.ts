import type { Engine } from '@/engine/Engine';

// Minimal, asset-free sound using the Web Audio API. Subscribes to engine
// events and plays short synthesized cues when sound is enabled.
export class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = false;
  private unsub: Array<() => void> = [];
  private voices = new Map<OscillatorNode, GainNode>();
  private lastRegenerationPitch = -1;

  constructor(engine: Engine) {
    this.unsub.push(
      engine.events.on('poiOpened', () => this.blip(660, 0.12, 'sine')),
    );
    this.unsub.push(
      engine.events.on('poiClosed', () => this.blip(330, 0.1, 'sine')),
    );
    this.unsub.push(
      engine.events.on('focusChanged', (i: number) => {
        // Walk up the timeline in whole steps (+2 semitones per entry) from
        // a G3 base, so each company has a distinct pitch and the sequence
        // reads as a rising scale when scrubbing forward in time.
        const freq = 196 * Math.pow(2, (i * 2) / 12);
        this.blip(freq, 0.08, 'triangle');
      }),
    );
    this.unsub.push(
      engine.events.on('bodyRegenerated', () => this.regeneration()),
    );
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    // AudioContext is created lazily on the first cue, so we don't construct
    // it before a user gesture (browsers warn / suspend otherwise).
  }

  private getContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive)
      return null;
    if (!this.ctx && typeof AudioContext !== 'undefined') {
      this.ctx = new AudioContext();
    }
    if (!this.ctx || this.ctx.state === 'closed') return null;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch((error: unknown) => {
        console.warn('Could not start portfolio sound:', error);
      });
    }
    return ctx;
  }

  private blip(freq: number, dur: number, type: OscillatorType): void {
    const ctx = this.getContext();
    if (ctx) this.tone(ctx, freq, dur, type);
  }

  private regeneration(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const semitones = [0, 3, 5, 7, 10];
    let pitch = Math.floor(Math.random() * semitones.length);
    // Even a repeated random value must produce a different consecutive pitch.
    if (pitch === this.lastRegenerationPitch) {
      pitch = (pitch + 1) % semitones.length;
    }
    this.lastRegenerationPitch = pitch;
    const freq = 440 * Math.pow(2, semitones[pitch]! / 12);
    this.tone(ctx, freq * 0.5, 0.18, 'triangle', 0, freq * 2);
    this.tone(ctx, freq * 2, 0.28, 'sine', 0.08);
  }

  private tone(
    ctx: AudioContext,
    freq: number,
    dur: number,
    type: OscillatorType,
    delay = 0,
    endFreq?: number,
  ): void {
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(ctx.destination);
    this.voices.set(osc, gain);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      this.voices.delete(osc);
    };
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  destroy(): void {
    this.unsub.forEach((u) => u());
    this.unsub = [];
    this.voices.forEach((gain, osc) => {
      osc.onended = null;
      osc.stop();
      osc.disconnect();
      gain.disconnect();
    });
    this.voices.clear();
    void this.ctx?.close().catch((error: unknown) => {
      console.warn('Could not close portfolio sound:', error);
    });
    this.ctx = null;
  }
}
