import { useSyncExternalStore } from 'react';
import { Moon, Sun, SunMoon } from 'lucide-react';
import {
  getThemePref,
  saveThemePref,
  subscribeTheme,
  type ThemePref,
} from '@/settings';
import { UI } from './strings';

const THEMES: Record<
  ThemePref,
  { label: string; next: ThemePref; Icon: typeof Sun }
> = {
  auto: { label: 'Auto', next: 'light', Icon: SunMoon },
  light: { label: 'Light', next: 'dark', Icon: Sun },
  dark: { label: 'Dark', next: 'auto', Icon: Moon },
};

// Compact theme control for pages without the timeline's Settings panel;
// each press cycles Auto → Light → Dark.
export function ThemeToggle() {
  const pref = useSyncExternalStore(
    subscribeTheme,
    getThemePref,
    (): ThemePref => 'auto',
  );
  const { label, next, Icon } = THEMES[pref];
  return (
    <button
      id="theme-toggle"
      type="button"
      className="icon-btn"
      aria-label={`${UI.theme}: ${label}`}
      title={`${UI.theme}: ${label} (switch to ${THEMES[next].label})`}
      onClick={() => saveThemePref(next)}
    >
      <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
    </button>
  );
}
