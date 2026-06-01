import type { Engine } from '@/engine/Engine';

// Minimal, asset-free sound using the Web Audio API. Subscribes to engine
// events and plays short synthesized cues when sound is enabled.
export class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = false;
  private unsub: Array<() => void> = [];

  constructor(engine: Engine) {
    this.unsub.push(
      engine.events.on('poiOpened', () => this.blip(660, 0.12, 'sine')),
    );
    this.unsub.push(
      engine.events.on('poiClosed', () => this.blip(330, 0.1, 'sine')),
    );
    this.unsub.push(
      engine.events.on('focusChanged', () => this.blip(220, 0.06, 'triangle')),
    );
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on && !this.ctx && typeof AudioContext !== 'undefined') {
      this.ctx = new AudioContext();
    }
  }

  private blip(freq: number, dur: number, type: OscillatorType): void {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  destroy(): void {
    this.unsub.forEach((u) => u());
    this.unsub = [];
    void this.ctx?.close();
    this.ctx = null;
  }
}
