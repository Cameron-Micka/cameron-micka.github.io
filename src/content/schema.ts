import { z } from 'zod';

export const mediaSchema = z.object({
  type: z.enum(['image', 'video']),
  src: z.string(),
  alt: z.string().optional(),
  poster: z.string().optional(),
});

export const poiSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'POI slug must be url-safe (a-z, 0-9, -)'),
  title: z.string(),
  accent: z.string().regex(/^#([0-9a-fA-F]{6})$/),
  // Short markdown body shown in the modal.
  body: z.string(),
  media: z.array(mediaSchema).default([]),
});

export const companySchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'Company slug must be url-safe (a-z, 0-9, -)'),
  name: z.string(),
  role: z.string(),
  // Optional path to the company's logo (rendered left of the name in the
  // bottom ribbon). Stored under /public/logos/ so it resolves from BASE_URL
  // at runtime — pass e.g. "/logos/microsoft.svg".
  logo: z.string().optional(),
  // YYYY or YYYY-MM. `end` null means present.
  start: z.string(),
  end: z.string().nullable(),
  location: z.string().optional(),
  summary: z.string(),
  seed: z.string(),
  // Palette anchors as #rrggbb (low / mid / high terrain bands).
  palette: z.object({
    low: z.string().regex(/^#([0-9a-fA-F]{6})$/),
    mid: z.string().regex(/^#([0-9a-fA-F]{6})$/),
    high: z.string().regex(/^#([0-9a-fA-F]{6})$/),
  }),
  features: z.object({
    rings: z.boolean(),
    ringTilt: z.number().default(0.4),
    // When true, the planet's ring is rendered as a narrow band with only a
    // few visible stripes instead of the broader many-band default.
    thinRing: z.boolean().default(false),
    // When true, low-elevation terrain is rendered as smooth water with
    // depth-graded blue and a tight specular highlight, instead of the
    // textured land used everywhere else on the planet.
    oceans: z.boolean().default(false),
    // When true, an alpha-blended cloud shell sits just above the planet
    // surface (below the atmosphere) and rotates at a different speed
    // from the planet, casting matching fake shadows onto the surface.
    clouds: z.boolean().default(false),
    // When true, the planet's night side shows sparse warm "city light"
    // clusters on land (gated to dark hemisphere + non-ocean). Twinkles
    // subtly. Implemented purely in the planet shader.
    cityLights: z.boolean().default(false),
    // When true, the planet surface is advected along a procedural tangent
    // flow field (Emil Dziewanowski's flow-map technique) so the marbled
    // surface detail streams like a fluid. Implemented in the planet shader.
    flowMap: z.boolean().default(false),
    // When true, an additive emissive shell above the atmosphere paints
    // animated auroral curtains over both poles. The curtains shimmer via
    // IQ domain warping and read green low / red-magenta high, brightest on
    // the night side and at the limb. Implemented in the aurora shader.
    aurora: z.boolean().default(false),
    moons: z.number().int().min(0).max(6),
  }),
  pois: z.array(poiSchema),
});

export type Media = z.infer<typeof mediaSchema>;
export type Poi = z.infer<typeof poiSchema>;
export type Company = z.infer<typeof companySchema>;
// Input shape (before Zod applies defaults). Use when authoring raw company
// data so fields with `.default()` (e.g. thinRing, ringTilt) stay optional.
export type CompanyInput = z.input<typeof companySchema>;

export const companiesSchema = z.array(companySchema);

// Convert #rrggbb to a linear-ish RGB triple in 0..1 for shader palettes.
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  // Approximate sRGB -> linear.
  const toLinear = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return [toLinear(r), toLinear(g), toLinear(b)];
}

// Tenure in years from start/end strings (end null = now).
export function tenureYears(start: string, end: string | null): number {
  const parse = (s: string) => {
    const [y, m] = s.split('-').map(Number);
    return (y ?? 2000) + ((m ?? 1) - 1) / 12;
  };
  const e = end ? parse(end) : new Date().getFullYear() + new Date().getMonth() / 12;
  return Math.max(0.5, e - parse(start));
}
