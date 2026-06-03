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

function NavArrow({ direction }: { direction: 'up' | 'down' }) {
  // Solid arrowhead. viewBox is symmetric so flipping vertically swaps up/down.
  const points = direction === 'up' ? '5,11 10,4 15,11' : '5,5 10,12 15,5';
  return (
    <svg
      width="20"
      height="16"
      viewBox="0 0 20 16"
      aria-hidden="true"
      focusable="false"
    >
      <polygon points={points} fill="currentColor" />
    </svg>
  );
}

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
        <NavArrow direction="up" />
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
            {c.name} · {rangeLabel(c.start, c.end)}
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
        <NavArrow direction="down" />
      </button>
    </div>
  );
}
