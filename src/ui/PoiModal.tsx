import { useEffect, useRef, useState } from 'react';
import type { Company, Media } from '@/content/schema';
import { useEngine, useEngineSnapshot } from './EngineContext';
import { Markdown } from './Markdown';
import { UI } from './strings';

// Extract a YouTube video id from common URL shapes (youtu.be/ID,
// youtube.com/watch?v=ID, youtube.com/embed/ID, youtube.com/shorts/ID).
// Returns null for anything that isn't recognizable as YouTube.
function youtubeId(src: string): string | null {
  try {
    const u = new URL(src);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1);
      return /^[\w-]{6,}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(embed|shorts|v)\/([\w-]{6,})/);
      if (m) return m[2] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function MediaItem({ m }: { m: Media }) {
  if (m.type === 'video') {
    const yt = youtubeId(m.src);
    if (yt) {
      return (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${yt}`}
          title={m.alt ?? 'YouTube video'}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      );
    }
    return (
      <video controls poster={m.poster} preload="metadata">
        <source src={m.src} />
      </video>
    );
  }
  return <img src={m.src} alt={m.alt ?? ''} loading="lazy" />;
}

export function PoiModal({ companies }: { companies: Company[] }) {
  const engine = useEngine();
  const { openPoi } = useEngineSnapshot();
  const cardRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<Element | null>(null);
  const [expanded, setExpanded] = useState(false);

  const company = openPoi
    ? companies.find((c) => c.slug === openPoi.company)
    : undefined;
  const poiIndex = company
    ? company.pois.findIndex((p) => p.slug === openPoi?.poi)
    : -1;
  const poi = poiIndex >= 0 ? company!.pois[poiIndex] : undefined;

  useEffect(() => {
    if (!openPoi) setExpanded(false);
  }, [openPoi]);

  useEffect(() => {
    if (!openPoi) return;
    lastFocused.current = document.activeElement;
    const card = cardRef.current;
    card?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        engine.closePoi();
      } else if (e.key === 'Tab' && card) {
        const focusable = card.querySelectorAll<HTMLElement>(
          'a[href], button, video, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (lastFocused.current instanceof HTMLElement) {
        lastFocused.current.focus();
      }
    };
  }, [openPoi, engine]);

  if (!openPoi || !company || !poi) return null;

  const goto = (next: number) => {
    const target = company.pois[next];
    if (target) engine.openPoiRef(company.slug, target.slug);
  };

  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) engine.closePoi();
      }}
    >
      <div
        className={expanded ? 'modal expanded' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="poi-title"
        tabIndex={-1}
        ref={cardRef}
      >
        <span
          className="accent-bar"
          style={{ background: poi.accent }}
          aria-hidden="true"
        />
        <div className="modal-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={expanded ? UI.collapse : UI.expand}
            aria-pressed={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="icon-btn close"
            aria-label={UI.close}
            onClick={() => engine.closePoi()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6l12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="eyebrow">{company.name}</div>
        <h2 id="poi-title">{poi.title}</h2>
        <div className="body">
          <Markdown text={poi.body} />
        </div>
        {poi.media.length > 0 && (
          <div className="media">
            {poi.media.map((m, i) => (
              <MediaItem key={i} m={m} />
            ))}
          </div>
        )}

        {company.pois.length > 1 && (
          <nav className="poi-nav" aria-label="Points of interest">
            <button
              type="button"
              disabled={poiIndex <= 0}
              onClick={() => goto(poiIndex - 1)}
            >
              ← Previous
            </button>
            <button
              type="button"
              disabled={poiIndex >= company.pois.length - 1}
              onClick={() => goto(poiIndex + 1)}
            >
              Next →
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
