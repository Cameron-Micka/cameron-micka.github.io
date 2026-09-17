import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
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
  const carouselRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<Element | null>(null);
  const scrollIndex = useRef<number | null>(null);
  const photo = photos[index];

  const scrollToPhoto = useCallback((nextIndex: number) => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    carousel.scrollTo({
      left: nextIndex * carousel.clientWidth,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }, []);
  const canGoPrev = index > 0;
  const canGoNext = index < photos.length - 1;
  const goPrev = useCallback(() => {
    if (index > 0) scrollToPhoto(index - 1);
  }, [index, scrollToPhoto]);
  const goNext = useCallback(() => {
    if (index < photos.length - 1) scrollToPhoto(index + 1);
  }, [index, photos.length, scrollToPhoto]);

  // Position the opening photo before paint, without interrupting native swipes
  // when a scroll event reports a new index back to the parent.
  useLayoutEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel || scrollIndex.current === index) return;
    scrollIndex.current = index;
    carousel.scrollTo({
      left: index * carousel.clientWidth,
      behavior: 'instant',
    });
  }, [index]);

  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    let width = carousel.clientWidth;
    const observer = new ResizeObserver(() => {
      if (carousel.clientWidth === width) return;
      width = carousel.clientWidth;
      carousel.scrollTo({
        left: (scrollIndex.current ?? 0) * width,
        behavior: 'instant',
      });
    });
    observer.observe(carousel);
    return () => observer.disconnect();
  }, []);

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
        <div
          className="lightbox-carousel"
          ref={carouselRef}
          tabIndex={-1}
          onScroll={(e) => {
            const carousel = e.currentTarget;
            if (!carousel.clientWidth) return;
            const nextIndex = Math.max(
              0,
              Math.min(
                photos.length - 1,
                Math.round(carousel.scrollLeft / carousel.clientWidth),
              ),
            );
            if (nextIndex === scrollIndex.current) return;
            scrollIndex.current = nextIndex;
            onNavigate(nextIndex);
          }}
        >
          {photos.map((slide, slideIndex) => (
            <figure
              className="lightbox-figure"
              key={slide.id}
              aria-hidden={slideIndex !== index}
            >
              {Math.abs(slideIndex - index) <= 1 && (
                <>
                  <div className="lightbox-image">
                    <img
                      src={assetUrl(slide.src)}
                      alt={slide.alt}
                      width={slide.width}
                      height={slide.height}
                      decoding="async"
                      draggable={false}
                    />
                  </div>
                  {(slide.caption || slide.location) && (
                    <figcaption>
                      {[slide.caption, slide.location]
                        .filter(Boolean)
                        .join(' · ')}
                    </figcaption>
                  )}
                </>
              )}
            </figure>
          ))}
        </div>

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
