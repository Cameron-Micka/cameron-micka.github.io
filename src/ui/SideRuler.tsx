import { ChevronDown, ChevronUp } from 'lucide-react';
import { tenureLabel, type Company } from '@/content/schema';
import { useEngine, useEngineValue } from './EngineContext';
import { UI } from './strings';

export function SideRuler({ companies }: { companies: Company[] }) {
  const engine = useEngine();
  const focusedIndex = useEngineValue((s) => s.focusedIndex);
  const freeCamera = useEngineValue((s) => s.freeCamera);
  const canGoUp = focusedIndex < companies.length - 1;
  const canGoDown = focusedIndex > 0;
  // The scrubber drives the timeline camera, which free-fly mode overrides.
  if (freeCamera) return null;
  return (
    <nav className="ruler" aria-label="Career timeline">
      <button
        type="button"
        className="ruler-nav"
        aria-label={UI.later}
        title={UI.later}
        onClick={() => engine.jumpToPlanet(focusedIndex + 1)}
        disabled={!canGoUp}
      >
        <ChevronUp size={17} aria-hidden="true" />
      </button>
      {companies
        .map((c, i) => (
          <button
            key={c.slug}
            type="button"
            aria-current={i === focusedIndex ? 'step' : undefined}
            className={i === focusedIndex ? 'active' : ''}
            onClick={() => engine.jumpToPlanet(i)}
          >
            <span className="label">
              {c.name} · {tenureLabel(c.start, c.end)}
            </span>
            <span className="tick" aria-hidden="true" />
          </button>
        ))
        .reverse()}
      <button
        type="button"
        className="ruler-nav"
        aria-label={UI.earlier}
        title={UI.earlier}
        onClick={() => engine.jumpToPlanet(focusedIndex - 1)}
        disabled={!canGoDown}
      >
        <ChevronDown size={17} aria-hidden="true" />
      </button>
    </nav>
  );
}
