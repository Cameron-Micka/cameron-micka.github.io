import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight } from 'lucide-react';
import { tenureLabel, type Company } from '@/content/schema';
import { useEngine, useEngineValue } from './EngineContext';
import { UI } from './strings';

function formatDates(c: Company): string {
  return tenureLabel(c.start, c.end);
}

export function BottomRibbon({ companies }: { companies: Company[] }) {
  const engine = useEngine();
  const focusedIndex = useEngineValue((s) => s.focusedIndex);
  const openPoi = useEngineValue((s) => s.openPoi);
  const freeCamera = useEngineValue((s) => s.freeCamera);
  const readoutRef = useRef<HTMLButtonElement>(null);
  const openedFromReadout = useRef(false);
  useEffect(() => {
    if (!openPoi && openedFromReadout.current) {
      openedFromReadout.current = false;
      readoutRef.current?.focus();
    }
  }, [openPoi]);
  if (openPoi || freeCamera) return null;
  const company = companies[focusedIndex];
  if (!company) return null;
  const firstPoi = company.pois[0];
  const logoSrc = company.logo
    ? `${import.meta.env.BASE_URL}${company.logo.replace(/^\/+/, '')}`
    : null;
  return (
    <div className="ribbon" aria-live="polite">
      <div className="ribbon-channel" aria-hidden="true">
        <span className="channel-label">Chapter</span>
        <span className="channel-value">
          {String(companies.length - focusedIndex).padStart(2, '0')}
          <span>/{String(companies.length).padStart(2, '0')}</span>
        </span>
        <span className="channel-meter">
          {companies
            .map((item, index) => (
              <span
                key={item.slug}
                className={index === focusedIndex ? 'active' : ''}
              />
            ))
            .reverse()}
        </span>
      </div>
      <button
        type="button"
        className="ribbon-readout"
        ref={readoutRef}
        aria-label={`Explore ${company.name}: ${UI.projects(company.pois.length)}`}
        aria-haspopup="dialog"
        disabled={!firstPoi}
        onClick={() => {
          if (!firstPoi) return;
          openedFromReadout.current = true;
          engine.openPoiRef(company.slug, firstPoi.slug);
        }}
      >
        <span className="ribbon-identity">
          {logoSrc && (
            <img
              className="company-logo"
              src={logoSrc}
              alt=""
              width={28}
              height={28}
            />
          )}
          <span>
            <span className="company">{company.name}</span>
            <span className="role">{company.role}</span>
          </span>
        </span>
        <span className="dates">
          <span>{formatDates(company)}</span>
          {company.location && (
            <span className="location">{company.location}</span>
          )}
        </span>
        <span className="ribbon-cta">
          Explore {UI.projects(company.pois.length)}
          <ArrowUpRight size={14} aria-hidden="true" />
        </span>
      </button>
      <div className="ribbon-transport">
        <span className="transport-label">Timeline</span>
        <div className="transport-keys">
          <button
            type="button"
            className="icon-btn"
            aria-label={UI.later}
            title={UI.later}
            disabled={focusedIndex === companies.length - 1}
            onClick={() => engine.jumpToPlanet(focusedIndex + 1)}
          >
            <ArrowUp size={19} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={UI.earlier}
            title={UI.earlier}
            disabled={focusedIndex === 0}
            onClick={() => engine.jumpToPlanet(focusedIndex - 1)}
          >
            <ArrowDown size={19} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
