import { QUALITY_PRESETS, type QualityPreference } from './engine/QualityManager';

export type ReducedMotionPref = 'auto' | 'on' | 'off';

export interface PersistedSettings {
  quality: QualityPreference;
  sound: boolean;
  reducedMotion: ReducedMotionPref;
  debugHud: boolean;
  wireframe: boolean;
  forceBackend: 'auto' | 'webgpu' | 'webgl2';
}

const KEY = 'cm-portfolio-settings';

const DEFAULTS: PersistedSettings = {
  quality: 'auto',
  sound: false,
  reducedMotion: 'auto',
  debugHud: false,
  wireframe: false,
  forceBackend: 'auto',
};

function isValidQuality(q: unknown): q is QualityPreference {
  return q === 'auto' || (typeof q === 'string' && q in QUALITY_PRESETS);
}

export function loadSettings(): PersistedSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const merged = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PersistedSettings>) };
    // Drop quality preferences from removed tiers (e.g. a stale 'ultra').
    if (!isValidQuality(merged.quality)) merged.quality = DEFAULTS.quality;
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: PersistedSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export function resolveReducedMotion(pref: ReducedMotionPref): boolean {
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  if (typeof matchMedia === 'undefined') return false;
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
