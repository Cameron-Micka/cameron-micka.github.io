import { tenureLabel, type Company } from '@/content/schema';
import { useEngineSnapshot } from './EngineContext';
import { HINTS } from './strings';

function formatDates(c: Company): string {
  return tenureLabel(c.start, c.end);
}

export function BottomRibbon({ companies }: { companies: Company[] }) {
  const { focusedIndex, openPoi, freeCamera } = useEngineSnapshot();
  if (openPoi) return null;
  const touch =
    typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  // Free-fly mode detaches the camera from the timeline, so the focused
  // company is no longer meaningful — keep only the controls tip.
  if (freeCamera) {
    return (
      <div className="ribbon hint-only" aria-live="polite">
        <div className="hint">
          {touch ? HINTS.freeCameraTouch : HINTS.freeCameraDesktop}
        </div>
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
      {logoSrc && (
        <img
          className="company-logo"
          src={logoSrc}
          alt=""
          aria-hidden="true"
          width={32}
          height={32}
        />
      )}
      <div className="company">
        <span className="company-name">{company.name}</span>
      </div>
      <div className="role">{company.role}</div>
      <div className="dates">
        {formatDates(company)}
        {company.location ? ` · ${company.location}` : ''}
      </div>
      <div className="hint">{touch ? HINTS.scrubTouch : HINTS.scrubDesktop}</div>
    </div>
  );
}
