import { companiesSchema, type Company, type CompanyInput } from './schema';

// Career timeline, ordered closest-to-camera ("Now") -> farthest ("Past").
//
// NOTE: Dates marked below are best-effort placeholders pending Cameron's
// confirmation. Edit start/end (YYYY or YYYY-MM) and the body copy freely —
// planet radius is derived from tenure and POI positions are seed-derived, so
// changing dates/seeds restyles the scene deterministically.
const raw: CompanyInput[] = [
  {
    slug: 'microsoft',
    name: 'Microsoft',
    role: 'Principal Software Engineer',
    start: '2016',
    end: null,
    location: 'Redmond, WA',
    summary:
      'Graphics & engine work across Mesh, MRTK, and HoloLens — shaders, ' +
      'rendering tooling, and developer experience for mixed reality.',
    seed: 'microsoft-mesh-mrtk-hololens',
    palette: { low: '#0a2a4a', mid: '#1f6fb2', high: '#7ad6ff' },
    features: { rings: false, ringTilt: 0.4, moons: 2 },
    pois: [
      {
        slug: 'mrtk-graphics-tools',
        title: 'MRTK Graphics Tools',
        accent: '#3aa0ff',
        body:
          'Led graphics tooling for the Mixed Reality Toolkit — a library of ' +
          'production-grade shaders and rendering utilities for Unity and ' +
          'Unreal, tuned for the tight GPU budgets of HoloLens. Focused on ' +
          'mobile-tier performance without sacrificing visual fidelity.',
        media: [],
      },
      {
        slug: 'shader-foundations',
        title: 'Shader Foundations (MR Speaker Series)',
        accent: '#7ad6ff',
        body:
          'Authored and presented deep-dive talks on shader fundamentals for ' +
          'mixed reality developers, covering lighting models, performance ' +
          'profiling, and the realities of rendering on untethered devices.',
        media: [],
      },
      {
        slug: 'mesh',
        title: 'Microsoft Mesh',
        accent: '#4fd1c5',
        body:
          'Contributed to rendering and avatar/scene technology for Mesh, ' +
          "Microsoft's platform for shared 3D experiences across devices.",
        media: [],
      },
    ],
  },
  {
    slug: 'fun-bits',
    name: 'Fun Bits Interactive',
    role: 'Engine / Graphics Programmer',
    start: '2013',
    end: '2016',
    location: 'Seattle, WA',
    summary:
      'Console game development — gameplay, engine, and graphics programming ' +
      'on a small, high-craft team.',
    seed: 'fun-bits-interactive-games',
    palette: { low: '#5a2a0a', mid: '#d2772b', high: '#ffd27a' },
    features: { rings: true, ringTilt: 0.5, moons: 1 },
    pois: [
      {
        slug: 'console-titles',
        title: 'Console Titles',
        accent: '#ff9f43',
        body:
          'Shipped console games as part of a small studio, wearing many ' +
          'hats across engine systems, tools, and graphics.',
        media: [],
      },
      {
        slug: 'engine-systems',
        title: 'Engine & Tools',
        accent: '#ffd27a',
        body:
          'Built and maintained core engine systems and content pipelines ' +
          'that let a lean team punch well above its weight.',
        media: [],
      },
    ],
  },
  {
    slug: 'lucasarts',
    name: 'LucasArts Entertainment',
    role: 'Software Engineer',
    start: '2011',
    end: '2013',
    location: 'San Francisco, CA',
    summary:
      'Engine and graphics programming at a storied game studio, working on ' +
      'cutting-edge rendering for AAA titles.',
    seed: 'lucasarts-entertainment',
    palette: { low: '#3a2e10', mid: '#b89b3e', high: '#ffe9a8' },
    features: { rings: true, ringTilt: 0.8, thinRing: true, moons: 0 },
    pois: [
      {
        slug: 'aaa-rendering',
        title: 'AAA Rendering',
        accent: '#e6c35c',
        body:
          'Worked on real-time rendering technology for high-end console ' +
          'titles, pushing the visual ceiling of the hardware generation.',
        media: [],
      },
      {
        slug: 'graphics-rd',
        title: 'Graphics R&D',
        accent: '#fff1c1',
        body:
          'Prototyped and profiled rendering techniques, balancing artistic ' +
          'goals against strict frame-time budgets.',
        media: [],
      },
    ],
  },
  {
    slug: 'micka-studios',
    name: 'Micka Studios',
    role: 'Founder',
    start: '2009',
    end: '2011',
    location: 'Redmond, WA',
    summary:
      'Independent studio founded during school — a sandbox for shipping ' +
      'small games and rendering experiments while wearing every hat.',
    seed: 'micka-studios-founder',
    palette: { low: '#2a0a3a', mid: '#7c3ed2', high: '#d9b3ff' },
    features: { rings: false, ringTilt: 0.4, moons: 1 },
    pois: [
      {
        slug: 'indie-projects',
        title: 'Indie Game Projects',
        accent: '#b768ff',
        body:
          'Designed, programmed, and self-published small original games — ' +
          'end-to-end ownership of every system from gameplay to release.',
        media: [],
      },
      {
        slug: 'rendering-experiments',
        title: 'Rendering Experiments',
        accent: '#d9b3ff',
        body:
          'Used the studio as a personal R&D lab — shader prototypes and ' +
          'rendering techniques that seeded the graphics work to come.',
        media: [],
      },
    ],
  },
  {
    slug: 'digipen',
    name: 'DigiPen Institute of Technology',
    role: 'BS, Real-Time Interactive Simulation',
    start: '2007',
    end: '2011',
    location: 'Redmond, WA',
    summary:
      'Where it started — a rigorous, project-driven computer science and ' +
      'real-time graphics education built around shipping games every year.',
    seed: 'digipen-rtis',
    palette: { low: '#0a3a1e', mid: '#2f9e54', high: '#a8ffce' },
    features: { rings: false, ringTilt: 0.4, moons: 3 },
    pois: [
      {
        slug: 'student-games',
        title: 'Student Game Projects',
        accent: '#4fe08a',
        body:
          'Shipped a new game each year with a team, learning engines, ' +
          'graphics, and the discipline of finishing under deadline.',
        media: [],
      },
      {
        slug: 'graphics-foundations',
        title: 'Graphics Foundations',
        accent: '#a8ffce',
        body:
          'Built the low-level rendering and math foundations — rasterizers, ' +
          'linear algebra, and shading — that the rest of the career stands on.',
        media: [],
      },
    ],
  },
];

// Validate at module load so malformed content fails fast in dev and build.
// Reversed so the timeline runs farthest ("Past") -> closest-to-camera ("Now"),
// i.e. Microsoft (the current role) is the last planet in the sequence. The
// engine still opens focused on the current role — see Engine's initial index.
export const companies: Company[] = companiesSchema.parse(raw).reverse();

export function findCompany(slug: string): Company | undefined {
  return companies.find((c) => c.slug === slug);
}

export function findPoi(companySlug: string, poiSlug: string) {
  const company = findCompany(companySlug);
  return company?.pois.find((p) => p.slug === poiSlug);
}
