import { SlidersHorizontal } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { NAV, SITE, UI } from './strings';

export function TopNav({
  onToggleSettings,
  settingsOpen = false,
}: {
  onToggleSettings?: () => void;
  settingsOpen?: boolean;
}) {
  return (
    <header className="topnav">
      <Link className="brand" to="/" aria-label={`${SITE.name}, home`}>
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="brand-text">
          <span className="name">{SITE.name}</span>
        </span>
      </Link>
      <nav aria-label="Primary">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}
        >
          {NAV.home}
        </NavLink>
        <NavLink
          to="/about"
          className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}
        >
          {NAV.about}
        </NavLink>
        <NavLink
          to="/blog"
          className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}
        >
          {NAV.blog}
        </NavLink>
        <NavLink
          to="/photography"
          className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}
        >
          {NAV.photography}
        </NavLink>
        {onToggleSettings && (
          <button
            id="settings-toggle"
            type="button"
            className={`icon-btn${settingsOpen ? ' active' : ''}`}
            aria-label={UI.settings}
            aria-expanded={settingsOpen}
            aria-controls={settingsOpen ? 'system-settings' : undefined}
            title={UI.settings}
            onClick={onToggleSettings}
          >
            <SlidersHorizontal size={18} strokeWidth={1.7} aria-hidden="true" />
          </button>
        )}
      </nav>
    </header>
  );
}
