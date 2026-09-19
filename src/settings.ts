import {
  QUALITY_PRESETS,
  type QualityPreference,
} from './engine/QualityManager';

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
  sound: boolean;
}

const KEY = 'cm-portfolio-settings';

const DEFAULTS: PersistedSettings = {
  quality: 'auto',
  reducedMotion: 'auto',
  debugHud: false,
  wireframe: false,
  forceBackend: 'auto',
  freeCamera: false,
  flightPath: false,
  crt: false,
  sound: false,
};

function isValidQuality(q: unknown): q is QualityPreference {
  return (
    q === 'auto' || (typeof q === 'string' && Object.hasOwn(QUALITY_PRESETS, q))
  );
}

// Settings that are intentionally session-only: they reset to their defaults on
// every load and are never written to localStorage.
const EPHEMERAL_KEYS = ['wireframe', 'freeCamera', 'flightPath'] as const;

export function loadSettings(): PersistedSettings {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Saved preferences must be an object.');
    }
    const merged = { ...DEFAULTS };
    const invalid: string[] = [];
    if ('quality' in parsed) {
      if (isValidQuality(parsed.quality)) merged.quality = parsed.quality;
      else invalid.push('quality');
    }
    if ('reducedMotion' in parsed) {
      const motion = parsed.reducedMotion;
      if (motion === 'auto' || motion === 'on' || motion === 'off') {
        merged.reducedMotion = motion;
      } else invalid.push('reducedMotion');
    }
    if ('forceBackend' in parsed) {
      const backend = parsed.forceBackend;
      if (backend === 'auto' || backend === 'webgpu' || backend === 'webgl2') {
        merged.forceBackend = backend;
      } else invalid.push('forceBackend');
    }
    for (const key of ['debugHud', 'crt', 'sound'] as const) {
      if (key in parsed) {
        const value: unknown = Reflect.get(parsed, key);
        if (typeof value === 'boolean') merged[key] = value;
        else invalid.push(key);
      }
    }
    if (invalid.length > 0) {
      console.warn(
        'Ignoring invalid portfolio preferences:',
        invalid.join(', '),
      );
    }
    return merged;
  } catch (error) {
    console.warn('Could not read portfolio preferences:', error);
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: PersistedSettings): void {
  if (typeof window === 'undefined') return;
  try {
    // Strip ephemeral settings so they aren't remembered across reloads.
    const persisted = { ...s };
    for (const k of EPHEMERAL_KEYS)
      delete (persisted as Partial<PersistedSettings>)[k];
    window.localStorage.setItem(KEY, JSON.stringify(persisted));
  } catch (error) {
    console.warn('Could not save portfolio preferences:', error);
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
