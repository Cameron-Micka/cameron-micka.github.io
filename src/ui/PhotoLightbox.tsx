import { useCallback, useEffect, useRef } from 'react';
import { assetUrl, type Photo } from '@/content/schema';
import { PHOTOGRAPHY, UI } from './strings';

/**
 * Full-screen photo viewer. Mirrors the POI modal's conventions: scrim +
 * `.modal` chrome, Escape / scrim / ✕ to close, focus trapped while open and
 * restored to the opening tile on close.
 *
 * Rendered only when a photo is selected, so nothing here runs during SSG.
 */
export function PhotoLightbox({
  photos,
  index,
  onClose,
  onNavigate,
}: {
  /** Photos of the active section, in grid order. */
  photos: Photo[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<Element | null>(null);
  const photo = photos[index];

  const canGoPrev = index > 0;
  const canGoNext = index < photos.length - 1;
  const goPrev = useCallback(() => {
    if (index > 0) onNavigate(index - 1);
  }, [index, onNavigate]);
  const goNext = useCallback(() => {
    if (index < photos.length - 1) onNavigate(index + 1);
  }, [index, photos.length, onNavigate]);

  // Grab focus on open and hand it back to the tile that opened the viewer.
  // Runs once per mount so paging never yanks focus off the nav buttons.
  useEffect(() => {
    lastFocused.current = document.activeElement;
    cardRef.current?.focus();
    return () => {
      if (lastFocused.current instanceof HTMLElement) {
        lastFocused.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    const card = cardRef.current;

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        goPrev();
      } else if (e.key === 'ArrowRight') {
        goNext();
      } else if (e.key === 'Tab' && card) {
        const focusable = [
          ...card.querySelectorAll<HTMLElement>(
            'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        ];
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
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goPrev, goNext]);

  // Lock body scroll for as long as the viewer is mounted.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Warm the neighbours so paging feels instant.
  useEffect(() => {
    for (const neighbour of [photos[index - 1], photos[index + 1]]) {
      if (!neighbour) continue;
      const img = new Image();
      img.src = assetUrl(neighbour.src);
    }
  }, [photos, index]);

  if (!photo) return null;

  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal lightbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lightbox-title"
        tabIndex={-1}
        ref={cardRef}
      >
        <div className="modal-actions">
          <button
            type="button"
            className="icon-btn close"
            aria-label={UI.close}
            onClick={onClose}
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

        <div className="modal-content">
          <div className="eyebrow">
            {PHOTOGRAPHY.counter(index + 1, photos.length)}
          </div>
          <h2 id="lightbox-title">{photo.caption ?? photo.alt}</h2>
          <figure className="lightbox-figure">
            <img
              src={assetUrl(photo.src)}
              alt={photo.alt}
              width={photo.width}
              height={photo.height}
              decoding="async"
            />
            {photo.location && <figcaption>{photo.location}</figcaption>}
          </figure>
        </div>

        {photos.length > 1 && (
          <nav className="poi-nav" aria-label={PHOTOGRAPHY.lightboxLabel}>
            <button
              type="button"
              disabled={!canGoPrev}
              aria-label={PHOTOGRAPHY.previous}
              onClick={goPrev}
            >
              ← Previous
            </button>
            <button
              type="button"
              disabled={!canGoNext}
              aria-label={PHOTOGRAPHY.next}
              onClick={goNext}
            >
              Next →
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
