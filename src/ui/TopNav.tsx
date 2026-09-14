import { SlidersHorizontal } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { NAV, SITE, UI } from './strings';

export function TopNav({
  onToggleSettings,
  settingsOpen = false,
  solid = false,
}: {
  onToggleSettings?: () => void;
  settingsOpen?: boolean;
  /** Opaque bar for static content pages, so scrolled text passes behind it. */
  solid?: boolean;
}) {
  return (
    <header className={`topnav${solid ? ' solid' : ''}`}>
      <Link className="brand" to="/" aria-label={`${SITE.name}, home`}>
        <span className="brand-text">
          <span className="name">{SITE.name}</span>
          <span className="role">{SITE.role}</span>
        </span>
      </Link>
      <nav aria-label="Primary">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}
        >
          <span className="nav-number" aria-hidden="true">
            01
          </span>
          {NAV.home}
        </NavLink>
        <NavLink
          to="/about"
          className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}
        >
          <span className="nav-number" aria-hidden="true">
            02
          </span>
          {NAV.about}
        </NavLink>
        <NavLink
          to="/contact"
          className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}
        >
          <span className="nav-number" aria-hidden="true">
            03
          </span>
          {NAV.contact}
        </NavLink>
        <NavLink
          to="/blog"
          className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}
        >
          <span className="nav-number" aria-hidden="true">
            04
          </span>
          {NAV.blog}
        </NavLink>
        <NavLink
          to="/photography"
          className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}
        >
          <span className="nav-number" aria-hidden="true">
            05
          </span>
          {NAV.photography}
        </NavLink>
        {onToggleSettings && (
          <button
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
