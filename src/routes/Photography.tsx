import { memo, useCallback, useState } from 'react';
import { TopNav } from '@/ui/TopNav';
import { PhotoLightbox } from '@/ui/PhotoLightbox';
import { PHOTOGRAPHY } from '@/ui/strings';
import { photosByCategory } from '@/content/photos';
import { assetUrl, type Photo, type PhotoCategory } from '@/content/schema';

const SECTIONS: { id: PhotoCategory; title: string }[] = [
  { id: 'nature', title: PHOTOGRAPHY.sections.nature },
  { id: 'automotive', title: PHOTOGRAPHY.sections.automotive },
];

// Which photo is open, scoped to the section it was opened from so the
// lightbox's prev/next stay within that section.
type Selection = { category: PhotoCategory; index: number };

const PhotoGrid = memo(function PhotoGrid({
  photos,
  category,
  onOpen,
}: {
  photos: Photo[];
  category: PhotoCategory;
  onOpen: (category: PhotoCategory, index: number) => void;
}) {
  if (photos.length === 0) {
    return <p className="photo-empty">{PHOTOGRAPHY.empty}</p>;
  }
  return (
    <ul className="photo-grid" aria-label={PHOTOGRAPHY.gridLabel}>
      {photos.map((photo, i) => (
        <li key={photo.id}>
          <a
            href={assetUrl(photo.src)}
            className="photo-tile"
            onClick={(event) => {
              if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              onOpen(category, i);
            }}
            aria-label={`${PHOTOGRAPHY.open}: ${photo.alt} (${PHOTOGRAPHY.counter(i + 1, photos.length)})`}
          >
            <img
              src={assetUrl(photo.thumb)}
              alt=""
              // The thumbnail is a smaller crop-free derivative, so the
              // full-size dimensions still give the right aspect ratio and
              // reserve the correct space before the image loads.
              width={photo.width}
              height={photo.height}
              loading={category === 'nature' && i < 2 ? 'eager' : 'lazy'}
              decoding="async"
            />
          </a>
        </li>
      ))}
    </ul>
  );
});

export default function Photography() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const openPhotos = selection ? photosByCategory(selection.category) : [];
  const openPhoto = useCallback((category: PhotoCategory, index: number) => {
    setSelection({ category, index });
  }, []);

  return (
    <>
      <TopNav solid />
      <main id="main-content" className="page photography" tabIndex={-1}>
        <h1>{PHOTOGRAPHY.title}</h1>
        <p className="lede">{PHOTOGRAPHY.lede}</p>
        <nav className="photo-jump" aria-label={PHOTOGRAPHY.jumpLabel}>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.title}
            </a>
          ))}
        </nav>
        {SECTIONS.map((section) => (
          <section key={section.id} id={section.id}>
            <h2 className="gallery-heading">
              {section.title}
              <span>{photosByCategory(section.id).length} frames</span>
            </h2>
            <PhotoGrid
              photos={photosByCategory(section.id)}
              category={section.id}
              onOpen={openPhoto}
            />
          </section>
        ))}
        <img
          className="golden-record"
          src="/golden-record-photography.svg"
          alt=""
          width={660}
          height={220}
          loading="lazy"
          decoding="async"
        />
      </main>
      {selection && (
        <PhotoLightbox
          photos={openPhotos}
          index={selection.index}
          onClose={() => setSelection(null)}
          onNavigate={(index) => setSelection((s) => (s ? { ...s, index } : s))}
        />
      )}
    </>
  );
}
