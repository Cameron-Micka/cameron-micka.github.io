import {
  photosSchema,
  type Photo,
  type PhotoCategory,
  type PhotoInput,
} from './schema';

// Photography gallery manifest.
//
// Files live in /public/photos/<category>/ (full-size, ~2000px long edge) with
// a matching /public/photos/<category>/thumbs/ entry (~600px long edge). Paths
// below are /public-relative and resolved against BASE_URL at render time, so
// they must NOT start with a slash.
//
// `width`/`height` are the intrinsic pixel dimensions of `src`; they let the
// grid reserve space (no layout shift) and size the lightbox before load.
// See the "Photography assets" section of README.md for the export recipe.
const raw: PhotoInput[] = [];

// Validate at module load so malformed content fails fast in dev and build.
export const photos: Photo[] = photosSchema.parse(raw);

const duplicateId = photos
  .map((p) => p.id)
  .find((id, i, ids) => ids.indexOf(id) !== i);
if (duplicateId) {
  throw new Error(`Duplicate photo id: ${duplicateId}`);
}

// Grouped once at module load; the manifest is static, so callers can use the
// returned arrays as stable references across renders.
const byCategory: Record<PhotoCategory, Photo[]> = {
  nature: photos.filter((p) => p.category === 'nature'),
  automotive: photos.filter((p) => p.category === 'automotive'),
};

export function photosByCategory(category: PhotoCategory): Photo[] {
  return byCategory[category];
}
