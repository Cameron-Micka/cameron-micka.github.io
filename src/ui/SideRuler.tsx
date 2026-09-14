import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Company } from '@/content/schema';
import { useEngine, useEngineSnapshot } from './EngineContext';

function yearOf(s: string): string {
  return s.slice(0, 4);
}

function rangeLabel(start: string, end: string | null): string {
  const sy = yearOf(start);
  if (!end) return `${sy} – Now`;
  const ey = yearOf(end);
  return sy === ey ? sy : `${sy} – ${ey}`;
}

export function SideRuler({ companies }: { companies: Company[] }) {
  const engine = useEngine();
  const { focusedIndex, freeCamera } = useEngineSnapshot();
  const canGoUp = focusedIndex > 0;
  const canGoDown = focusedIndex < companies.length - 1;
  // The scrubber drives the timeline camera, which free-fly mode overrides.
  if (freeCamera) return null;
  return (
    <nav className="ruler" aria-label="Career timeline">
      <button
        type="button"
        className="ruler-nav"
        aria-label="Previous timeline item"
        title="Previous timeline item"
        onClick={() => engine.jumpToPlanet(focusedIndex - 1)}
        disabled={!canGoUp}
      >
        <ChevronUp size={17} aria-hidden="true" />
      </button>
      {companies.map((c, i) => (
        <button
          key={c.slug}
          type="button"
          aria-current={i === focusedIndex ? 'step' : undefined}
          className={i === focusedIndex ? 'active' : ''}
          onClick={() => engine.jumpToPlanet(i)}
        >
          <span className="label">
            {c.name} · {rangeLabel(c.start, c.end)}
          </span>
          <span className="tick" aria-hidden="true" />
        </button>
      ))}
      <button
        type="button"
        className="ruler-nav"
        aria-label="Next timeline item"
        title="Next timeline item"
        onClick={() => engine.jumpToPlanet(focusedIndex + 1)}
        disabled={!canGoDown}
      >
        <ChevronDown size={17} aria-hidden="true" />
      </button>
    </nav>
  );
}
