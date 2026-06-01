import type { Company } from '@/content/schema';
import { useEngine, useEngineSnapshot } from './EngineContext';

export function SideRuler({ companies }: { companies: Company[] }) {
  const engine = useEngine();
  const { focusedIndex } = useEngineSnapshot();
  return (
    <div className="ruler" role="tablist" aria-label="Career timeline">
      {companies.map((c, i) => (
        <button
          key={c.slug}
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
    </div>
  );
}
