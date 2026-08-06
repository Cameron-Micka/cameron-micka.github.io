import { NavLink } from 'react-router-dom';
import { NAV, SITE, UI } from './strings';

export function TopNav({
  onToggleSettings,
  solid = false,
}: {
  onToggleSettings?: () => void;
  /** Opaque bar for static content pages, so scrolled text passes behind it. */
  solid?: boolean;
}) {
  return (
    <header className={`topnav${solid ? ' solid' : ''}`}>
      <div className="brand">
        <span className="name">{SITE.name}</span>
      </div>
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
          to="/contact"
          className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}
        >
          {NAV.contact}
        </NavLink>
        <NavLink
          to="/blog"
          className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}
        >
          {NAV.blog}
        </NavLink>
        {onToggleSettings && (
          <button
            type="button"
            className="icon-btn"
            aria-label={UI.settings}
            title={UI.settings}
            onClick={onToggleSettings}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="M19.4 13a7.6 7.6 0 0 0 .05-2l1.7-1.3-1.9-3.3-2 .8a7.5 7.5 0 0 0-1.7-1l-.3-2.1H9.7l-.3 2.1a7.5 7.5 0 0 0-1.7 1l-2-.8L3.8 9.7 5.5 11a7.6 7.6 0 0 0 0 2l-1.7 1.3 1.9 3.3 2-.8c.5.4 1.1.7 1.7 1l.3 2.1h4.6l.3-2.1c.6-.3 1.2-.6 1.7-1l2 .8 1.9-3.3-1.5-1.3Z"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </button>
        )}
      </nav>
    </header>
  );
}
