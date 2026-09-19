import {
  photosSchema,
  type Photo,
  type PhotoCategory,
  type PhotoInput,
} from './schema';
import { generatedPhotos } from './photos.generated';

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
const fallbackAlt: Record<PhotoCategory, string> = {
  nature: 'Nature photograph by Cameron Micka',
  automotive: 'Automotive photograph by Cameron Micka',
};

type PhotoDetails = Pick<PhotoInput, 'alt'> &
  Partial<Pick<PhotoInput, 'caption' | 'location'>>;

const photoDetails: Partial<Record<string, PhotoDetails>> = {
  dsc02870: {
    alt: 'Black off-road vehicle in a rocky clearing framed by green forest.',
  },
  'img-0475': {
    alt: 'Green wedge-shaped concept car on a museum display, viewed in profile.',
  },
  'img-0627': {
    alt: 'Yellow concept sports car on a wooden museum floor, viewed from a low angle.',
  },
  'img-0654': {
    alt: 'Red sports car seen from above on curved gray pavement.',
  },
  'img-0739': {
    alt: 'Rear view of a red Ferrari with a large rear wing on a white museum display.',
  },
  'img-298-no-wires': {
    alt: 'Silver and blue sports car parked beside a sunlit building with red shutters.',
  },
  'img-3386': {
    alt: "Black-and-white view of a sports car's steering wheel, center console, and manual gearshift.",
  },
  'img-3674': {
    alt: 'Dark SUV beside a mountain road, with evergreens and a snow-covered peak behind it.',
  },
  'img-5371': {
    alt: 'Front view of a yellow sports car with two gray racing stripes at a car gathering.',
  },
  'img-5409': {
    alt: 'Bright green sports car facing the camera at an outdoor car gathering.',
  },
  'img-5427': {
    alt: 'Blue sports car parked between white bollards outside a brick-and-glass building.',
  },
  'img-5500': {
    alt: 'Rear quarter of a silver coupe catching warm sunlight beside a grassy field.',
  },
  'img-5573': {
    alt: 'Raindrops around a Ferrari badge on red bodywork with green, white, and red stripes.',
  },
  'img-5581': {
    alt: 'Raindrops on an orange fuel cap embossed with the Bugatti emblem.',
  },
  'img-7131': {
    alt: 'Silver coupe driving along a mountain road, with the forest blurred by motion.',
  },
  'img-7872': {
    alt: 'Rear view of an orange sports car in a line of colorful cars at a street gathering.',
  },
  'img-8785': {
    alt: 'Red sports car with gold wheels at an outdoor car gathering.',
  },
  'img-9496': {
    alt: 'White off-road vehicle on a sandy desert track under a cloud-filled sky.',
  },
  dsc01491: {
    alt: 'Green and magenta aurora radiating across a dark night sky.',
  },
  dsc02117: {
    alt: 'Person sitting among exposed roots at the base of a large forest tree.',
  },
  dsc02918: {
    alt: 'Owl perched on a mossy branch in a green forest.',
  },
  dsc03459: {
    alt: 'Person standing on a picnic table and looking toward sunlit rock spires.',
  },
  dsc06633: {
    alt: 'Freestanding sandstone arch above an open desert basin under a clear blue sky.',
  },
  dsc06673: {
    alt: 'Layered desert canyons seen through a shaded opening in red rock.',
  },
  dsc08696: {
    alt: 'Child walking along a sandy trail toward jagged mountains and desert shrubs.',
  },
  dsc09463: {
    alt: 'Cratered moon against a clear blue daytime sky.',
  },
  dsc09635: {
    alt: 'Evergreens and bright green plants framing a rocky mountain slope.',
  },
  'img-0053': {
    alt: 'Sunbeams filtering through tall trees onto a forest path covered in exposed roots.',
  },
  'img-0111': {
    alt: 'Small hiker crossing golden hills beneath a blue sky and white clouds.',
  },
  'img-0170': {
    alt: 'Bushy-tailed, gray-furred animal stepping across a snowy field.',
  },
  'img-1333': {
    alt: 'White geodesic dome on a green hillside beneath a clear blue sky.',
  },
  'img-1439': {
    alt: 'Steep green coastal cliffs rising above turquoise water, with mist along the shore.',
  },
  'img-2310': {
    alt: 'Person standing at the base of a towering tree, showing the scale of its trunk.',
  },
  'img-2661': {
    alt: 'Winding paved road beneath red sandstone cliffs and sunlit trees.',
  },
  'img-2878': {
    alt: 'Sunlight flaring over a narrow orange rock spire in a canyon of sandstone pillars.',
  },
  'img-3027': {
    alt: 'Hiker on a red dirt trail approaching a broad sandstone arch.',
  },
  'img-3029': {
    alt: 'Warm light on tall sandstone towers above green desert scrub.',
  },
  'img-3306': {
    alt: 'Coyote among dry shrubs, spiky desert trees, and granite boulders.',
  },
  'img-3909': {
    alt: 'Mist and sunlight drifting through evergreens beside a rocky mountain trail.',
  },
  'img-4099': {
    alt: 'Purple wildflowers and scattered rocks beneath a textured, cloud-filled sky.',
  },
  'img-4119': {
    alt: 'Blue-and-yellow macaw perched on a branch among dense green leaves.',
  },
  'img-4443': {
    alt: 'Sunlit curves and layered orange walls inside a narrow sandstone canyon.',
  },
  'img-4801': {
    alt: 'Colorful hillside buildings above a rocky harbor and deep blue coastal water.',
  },
  'img-5021': {
    alt: 'Long rows of pink tulips stretching toward distant mountains under an evening sky.',
  },
  'img-5496': {
    alt: 'Sheep grazing in a green meadow backlit by warm, low sunlight.',
  },
  'img-6613': {
    alt: 'Close-up of a marmot resting among green leaves and purple wildflowers.',
  },
  'img-6670': {
    alt: 'Bison facing the camera in a grassy meadow, with misty woodland behind it.',
  },
  'img-6939': {
    alt: 'Weathered metal sign frame in open desert beneath dramatic white clouds.',
  },
  'img-6979': {
    alt: 'Red rock formations and a small balanced boulder overlooking a broad desert plain.',
  },
  'img-7217': {
    alt: 'Wide white salt flat meeting distant mountains under a blue sky.',
  },
  'img-7834': {
    alt: 'White horses grazing among green shrubs and low trees.',
  },
  'img-7975': {
    alt: 'Pink flamingo wading through shallow water, with other flamingos behind it.',
  },
  'img-8080': {
    alt: 'Two waterfalls dropping down a dark cliff into turquoise water, with a small boat below.',
  },
  'img-8438': {
    alt: 'Deer in an alpine wildflower meadow with layered mountain peaks in the distance.',
  },
  'img-8446': {
    alt: 'Narrow trail through a green alpine meadow toward a snowy mountain under pink clouds.',
  },
  'img-9441': {
    alt: 'Waterfall plunging into a rocky canyon as bright sunlight creates lens flare.',
  },
  'img-9528': {
    alt: 'Folded desert hills striped with gold, brown, and gray beneath distant blue mountains.',
  },
  'img-9613': {
    alt: 'Person walking across rough white salt formations toward distant mountains.',
  },
  'img-9704': {
    alt: 'Tall, jagged rock pinnacle rising from a wide, dry grassland under a pale blue sky.',
  },
};

const raw: PhotoInput[] = generatedPhotos.map((photo) => ({
  ...photo,
  alt: fallbackAlt[photo.category],
  ...photoDetails[photo.id],
}));

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
