import { useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { assetUrl, type Photo } from '@/content/schema';
import { PHOTOGRAPHY, UI } from './strings';

/**
 * Full-screen photo viewer: swipe or use arrows to navigate,
 * Escape / scrim / ✕ to close, focus trapped while open and
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
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
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
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
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
        const focusOutsideControls = !focusable.includes(
          document.activeElement as HTMLElement,
        );
        if (
          e.shiftKey &&
          (document.activeElement === first || focusOutsideControls)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last || focusOutsideControls)
        ) {
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
      className="modal-scrim lightbox-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={PHOTOGRAPHY.lightboxLabel}
        tabIndex={-1}
        ref={cardRef}
      >
        <button
          type="button"
          className="lightbox-control lightbox-close"
          aria-label={UI.close}
          title={UI.close}
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
        <figure
          className="lightbox-figure"
          onTouchStart={(e) => {
            const touch = e.touches[0];
            swipeStart.current =
              e.touches.length === 1 && touch
                ? { x: touch.clientX, y: touch.clientY }
                : null;
          }}
          onTouchMove={(e) => {
            if (e.touches.length !== 1) swipeStart.current = null;
          }}
          onTouchCancel={() => {
            swipeStart.current = null;
          }}
          onTouchEnd={(e) => {
            const start = swipeStart.current;
            swipeStart.current = null;
            const touch = e.changedTouches[0];
            if (!start || !touch || e.touches.length > 0) return;
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
            if (dx < 0) goNext();
            else goPrev();
          }}
        >
          <img
            src={assetUrl(photo.src)}
            alt={photo.alt}
            width={photo.width}
            height={photo.height}
            decoding="async"
            draggable={false}
          />
          {(photo.caption || photo.location) && (
            <figcaption>
              {[photo.caption, photo.location].filter(Boolean).join(' · ')}
            </figcaption>
          )}
        </figure>

        <nav className="lightbox-nav" aria-label={PHOTOGRAPHY.lightboxLabel}>
          {photos.length > 1 && (
            <button
              type="button"
              className="lightbox-control"
              disabled={!canGoPrev}
              aria-label={PHOTOGRAPHY.previous}
              title={PHOTOGRAPHY.previous}
              onClick={goPrev}
            >
              <ArrowLeft size={19} aria-hidden="true" />
            </button>
          )}
          <span
            className="lightbox-counter"
            aria-live="polite"
            aria-atomic="true"
          >
            {PHOTOGRAPHY.counter(index + 1, photos.length)}
          </span>
          {photos.length > 1 && (
            <button
              type="button"
              className="lightbox-control"
              disabled={!canGoNext}
              aria-label={PHOTOGRAPHY.next}
              title={PHOTOGRAPHY.next}
              onClick={goNext}
            >
              <ArrowRight size={19} aria-hidden="true" />
            </button>
          )}
        </nav>
      </div>
    </div>
  );
}
