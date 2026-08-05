import { QUALITY_PRESETS, type QualityPreference } from './engine/QualityManager';

export type ReducedMotionPref = 'auto' | 'on' | 'off';

export type BackendPref = 'auto' | 'webgpu' | 'webgl2';

export interface PersistedSettings {
  quality: QualityPreference;
  reducedMotion: ReducedMotionPref;
  debugHud: boolean;
  wireframe: boolean;
  forceBackend: BackendPref;
  freeCamera: boolean;
  flightPath: boolean;
  crt: boolean;
}

const KEY = 'cm-portfolio-settings';

const DEFAULTS: PersistedSettings = {
  quality: 'auto',
  reducedMotion: 'auto',
  debugHud: false,
  wireframe: false,
  forceBackend: 'auto',
  freeCamera: false,
  flightPath: true,
  crt: true,
};

function isValidQuality(q: unknown): q is QualityPreference {
  return q === 'auto' || (typeof q === 'string' && q in QUALITY_PRESETS);
}

// Settings that are intentionally session-only: they reset to their defaults on
// every load and are never written to localStorage.
const EPHEMERAL_KEYS = ['wireframe', 'freeCamera', 'flightPath'] as const;

export function loadSettings(): PersistedSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const merged = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PersistedSettings>) };
    // Drop quality preferences from removed tiers (e.g. a stale 'ultra').
    if (!isValidQuality(merged.quality)) merged.quality = DEFAULTS.quality;
    // Ephemeral settings always start from their defaults, ignoring any value
    // that may have been persisted by an older build.
    for (const k of EPHEMERAL_KEYS) merged[k] = DEFAULTS[k];
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: PersistedSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    // Strip ephemeral settings so they aren't remembered across reloads.
    const persisted = { ...s };
    for (const k of EPHEMERAL_KEYS) delete (persisted as Partial<PersistedSettings>)[k];
    localStorage.setItem(KEY, JSON.stringify(persisted));
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

// The CRT scanline/grain overlay lives on <body> pseudo-elements, so it is
// toggled with a class on <html> rather than through React.
export function applyCrt(on: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('crt-off', !on);
}
