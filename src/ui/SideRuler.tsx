import type { Company } from '@/content/schema';
import { useEngine, useEngineSnapshot } from './EngineContext';

export function SideRuler({ companies }: { companies: Company[] }) {
  const engine = useEngine();
  const { focusedIndex } = useEngineSnapshot();
  const canGoUp = focusedIndex > 0;
  const canGoDown = focusedIndex < companies.length - 1;
  return (
    <div className="ruler" role="tablist" aria-label="Career timeline">
      <button
        type="button"
        className="ruler-nav"
        aria-label="Previous timeline item"
        onClick={() => engine.jumpToPlanet(focusedIndex - 1)}
        disabled={!canGoUp}
      >
        ˄
      </button>
      {companies.map((c, i) => (
        <button
          key={c.slug}
          type="button"
          role="tab"
          aria-selected={i === focusedIndex}
          className={i === focusedIndex ? 'active' : ''}
          onClick={() => engine.jumpToPlanet(i)}
        >
          <span className="label">
            {c.name} · {c.start}
          </span>
          <span className="tick" />
        </button>
      ))}
      <button
        type="button"
        className="ruler-nav"
        aria-label="Next timeline item"
        onClick={() => engine.jumpToPlanet(focusedIndex + 1)}
        disabled={!canGoDown}
      >
        ˅
      </button>
    </div>
  );
}
