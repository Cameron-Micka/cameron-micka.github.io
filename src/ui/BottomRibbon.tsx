import { ArrowLeft, ArrowRight, RotateCcw, Video } from 'lucide-react';
import { tenureLabel, type Company } from '@/content/schema';
import { useEngine, useEngineSnapshot } from './EngineContext';

function formatDates(c: Company): string {
  return tenureLabel(c.start, c.end);
}

export function BottomRibbon({ companies }: { companies: Company[] }) {
  const engine = useEngine();
  const { focusedIndex, openPoi, freeCamera } = useEngineSnapshot();
  if (openPoi) return null;
  if (freeCamera) {
    return (
      <div className="ribbon flight-console" aria-live="polite">
        <div className="flight-status">
          <Video size={20} aria-hidden="true" />
          <span>Free camera</span>
        </div>
        <button
          type="button"
          className="navlink return-timeline"
          onClick={() => engine.setFreeCamera(false)}
        >
          <RotateCcw size={15} aria-hidden="true" />
          Timeline
        </button>
      </div>
    );
  }
  const company = companies[focusedIndex];
  if (!company) return null;
  const logoSrc = company.logo
    ? `${import.meta.env.BASE_URL}${company.logo.replace(/^\/+/, '')}`
    : null;
  return (
    <div className="ribbon" aria-live="polite">
      <div className="ribbon-channel" aria-hidden="true">
        <span className="channel-label">Position</span>
        <span className="channel-value">
          {String(focusedIndex + 1).padStart(2, '0')}
          <span>/{String(companies.length).padStart(2, '0')}</span>
        </span>
        <span className="channel-meter">
          {companies.map((item, index) => (
            <span
              key={item.slug}
              className={index === focusedIndex ? 'active' : ''}
            />
          ))}
        </span>
      </div>
      <div className="ribbon-readout">
        <div className="ribbon-identity">
          {logoSrc && (
            <img
              className="company-logo"
              src={logoSrc}
              alt=""
              width={28}
              height={28}
            />
          )}
          <div>
            <div className="company">{company.name}</div>
            <div className="role">{company.role}</div>
          </div>
        </div>
        <div className="dates">
          <span>{formatDates(company)}</span>
          {company.location && (
            <span className="location">{company.location}</span>
          )}
        </div>
      </div>
      <div className="ribbon-transport">
        <span className="transport-label">Timeline</span>
        <div className="transport-keys">
          <button
            type="button"
            className="icon-btn"
            aria-label="Previous company"
            title="Previous company"
            disabled={focusedIndex === 0}
            onClick={() => engine.jumpToPlanet(focusedIndex - 1)}
          >
            <ArrowLeft size={19} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Next company"
            title="Next company"
            disabled={focusedIndex === companies.length - 1}
            onClick={() => engine.jumpToPlanet(focusedIndex + 1)}
          >
            <ArrowRight size={19} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
