import type { Company } from '@/content/schema';
import { useEngineSnapshot } from './EngineContext';
import { HINTS } from './strings';

function formatDates(c: Company): string {
  const end = c.end ?? 'Present';
  return `${c.start} — ${end}`;
}

export function BottomRibbon({ companies }: { companies: Company[] }) {
  const { focusedIndex, openPoi } = useEngineSnapshot();
  if (openPoi) return null;
  const company = companies[focusedIndex];
  if (!company) return null;
  const touch =
    typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return (
    <div className="ribbon" aria-live="polite">
      <div className="company">{company.name}</div>
      <div className="role">{company.role}</div>
      <div className="dates">
        {formatDates(company)}
        {company.location ? ` · ${company.location}` : ''}
      </div>
      <div className="hint">{touch ? HINTS.scrubTouch : HINTS.scrubDesktop}</div>
    </div>
  );
}
