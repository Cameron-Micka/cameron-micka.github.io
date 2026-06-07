import { companiesSchema, type Company, type CompanyInput } from './schema';

// Career timeline, ordered closest-to-camera ("Now") -> farthest ("Past").
//
// planet radius is derived from tenure and POI positions are seed-derived, so
// changing dates/seeds restyles the scene deterministically.
const raw: CompanyInput[] = [
  {
    slug: 'microsoft',
    name: 'Microsoft',
    role: 'Principal Software Engineering Manager',
    logo: 'logos/microsoft.svg',
    start: '2016',
    end: null,
    location: 'Redmond, WA',
    summary:
      'Graphics & UI work across Teams Immersive, Mesh, MRTK, and HoloLens — shaders, ' +
      'rendering tooling, and developer experience for mixed reality.',
    seed: 'microsoft-mesh-mrtk-hololens',
    palette: { low: '#0a2a4a', mid: '#1f6fb2', high: '#7ad6ff' },
    features: { rings: false, ringTilt: 0.4, oceans: true, clouds: true, cityLights: true, moons: 2 },
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
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/FripHuBd9ZY?si=75bPCq3eO64SPAF4',
            alt: 'Fat Princess Adventures gameplay',
          },
        ],
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
    role: 'Technical Director',
    logo: 'logos/fun-bits.svg',
    start: '2011',
    end: '2016',
    location: 'Seattle, WA',
    summary:
      'Grew from Software Engineer to Technical Director across five years — ' +
      'shipping Escape Plan on PS Vita/PS4 (Unity), Fat Princess Adventures on ' +
      'PS4 (custom C4 Engine), and VR/MR R&D in Unreal Engine 4. Leading up to ' +
      '12 engineers while staying hands-on across engine, tools, and gameplay.',
    seed: 'fun-bits-interactive-games',
    palette: { low: '#5a2a0a', mid: '#d2772b', high: '#ffd27a' },
    features: { rings: true, ringTilt: 0.5, flowMap: true, moons: 1 },
    pois: [
      {
        slug: 'fat-princess-adventures',
        title: 'Fat Princess Adventures & DLC (PS4, C4 Engine)',
        accent: '#ff9f43',
        body:
          'As Technical Director, led a team of up to 12 engineers — ' +
          'scheduling deliverables, mitigating risk, screening candidates, ' +
          'and running the 60fps@1080p profiling effort. Personally owned ' +
          'key systems: layered animation, Havok integration and the ' +
          'kinematic character controller, AI pathfinding and scripted ' +
          'behavior, networked gameplay, character state machine, character ' +
          'customization, camera system, editor and debugging tools, and ' +
          'visual-scripting improvements.',
        media: [],
      },
      {
        slug: 'fat-princess-2-prototype',
        title: 'Fat Princess 2 \u2192 Adventures (Custom Engine)',
        accent: '#ffc587',
        body:
          'As Senior Software Engineer, implemented gameplay and core ' +
          'systems for a custom engine prototype of Fat Princess 2 that ' +
          'later evolved into Fat Princess Adventures on PS4.',
        media: [],
      },
      {
        slug: 'virtually-live',
        title: 'Virtually Live: Soccer (HTC Vive, Unity 5 & UE4)',
        accent: '#ffb866',
        body:
          'Integrated the SteamVR plugin and built the camera and input ' +
          'system used by designers, keeping the experience above 90fps in ' +
          'collaboration with art and design. Authored a procedural crowd ' +
          'tool that let the team drop large, varied stadium audiences in ' +
          'place — with automatic texture atlasing, mesh combining, and LOD ' +
          'handling under the hood.',
        media: [],
      },
      {
        slug: 'halp',
        title: 'HALP (Oculus Touch & HTC Vive, UE4)',
        accent: '#ffd27a',
        body:
          'Stood up a custom Unreal Engine 4 build to run against prototype ' +
          'Oculus Touch hardware, and built and maintained the working ' +
          'relationship with Facebook/Oculus throughout the project.',
        media: [],
      },
      {
        slug: 'escape-plan',
        title: 'Escape Plan & DLC (PS Vita & PS4, Unity 3.x)',
        accent: '#ffe1a8',
        body:
          'Helped port portions of Unity to PlayStation Vita while shipping ' +
          'Escape Plan — the Vita\u2019s #1 selling downloadable game. ' +
          'Implemented Vita platform services (trophies, save data, store ' +
          'entitlements), scripted most gameplay systems, and built a ' +
          'custom UI implementation, localization system, character state ' +
          'machine, root-motion system, character controller, and editor ' +
          'tools. Identified slow C# scripts and ported them to native, ' +
          'exposing additional engine methods to script along the way.',
        media: [],
      }
    ],
  },
  {
    slug: 'lucasarts',
    name: 'LucasArts Entertainment',
    role: 'Software Engineer',
    logo: 'logos/lucasarts.svg',
    start: '2009',
    end: '2010',
    location: 'San Francisco, CA',
    summary:
      'Gameplay and engine programming on Star Wars: The Force Unleashed I & II ' +
      '(PlayStation 3 & Xbox 360) in the Ronin Engine — from an internship ' +
      'building data and tooling pipelines to shipping boss-battle gameplay and DLC.',
    seed: 'lucasarts-entertainment',
    palette: { low: '#3a2e10', mid: '#b89b3e', high: '#ffe9a8' },
    features: { rings: true, ringTilt: 0.8, thinRing: true, clouds: true, cityLights: true, moons: 0 },
    pois: [
      {
        slug: 'force-unleashed-ii',
        title: 'The Force Unleashed II & DLC',
        accent: '#e6c35c',
        body:
          'Programmed and scripted gameplay systems on Star Wars: The Force ' +
          'Unleashed II for PlayStation 3 and Xbox 360, with an emphasis on ' +
          'boss battles. Collaborated with the LucasArts Singapore team to ' +
          'fix bugs and ship a polished DLC release.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/puvH9OmQ4fc',
            alt: 'Star Wars: The Force Unleashed II gameplay',
          },
        ],
      },
      {
        slug: 'ronin-engine-tools',
        title: 'Ronin Engine Tools & Telemetry',
        accent: '#fff1c1',
        body:
          'During an internship on The Force Unleashed I & II, wrote the ' +
          'networked gameplay data logging system, a heat-map generation ' +
          'tool, and a gameplay replay system — and chased down sources of ' +
          'non-determinism inside the Ronin Engine.',
        media: [],
      },
    ],
  },
  {
    slug: 'micka-studios',
    name: 'Micka Studios',
    role: 'Founder',
    logo: 'logos/micka-studios.svg',
    start: '2008',
    end: '2011',
    location: 'Redmond, WA',
    summary:
      'Self-employed indie studio shipping original iOS and Zune HD games on a ' +
      'from-scratch proprietary mobile engine — OpenGL ES 1.0/2.0, OpenAL, and ' +
      'Box2D — wearing every hat from engine to store submission.',
    seed: 'micka-studios-founder',
    palette: { low: '#2a0a3a', mid: '#7c3ed2', high: '#d9b3ff' },
    features: { rings: false, ringTilt: 0.4, oceans: true, aurora: true, moons: 1 },
    pois: [
      {
        slug: 'hairball',
        title: 'Hairball (iOS & Zune HD)',
        accent: '#b768ff',
        body:
          'Handled every aspect of programming and development. Wrote a ' +
          'proprietary mobile game engine from scratch using OpenGL ES 1.0 ' +
          'and 2.0, OpenAL, and Box2D. One of the first games submitted to ' +
          'the iTunes App Store in August 2008, then partnered with ' +
          'Microsoft to port Hairball from iOS to Zune HD using XNA.',
        media: [],
      },
      {
        slug: 'snowball',
        title: 'Snowball (iOS & Zune HD)',
        accent: '#c98bff',
        body:
          'Ported Snowball from PC to iOS to sell on the iTunes App Store, ' +
          'where it landed on Apple\u2019s "Featured" page. Collaborated ' +
          'with Zynga on cross-promotion advertisements.',
        media: [],
      },
      {
        slug: 'iventure-hd',
        title: 'iVenture HD (iOS)',
        accent: '#d9b3ff',
        body:
          'One of the first universal games available for iPad and iPhone. ' +
          'Wrote all game and engine features from scratch, including an ' +
          'in-game level editor that shipped with the final game.',
        media: [],
      },
    ],
  },
  {
    slug: 'id-tech',
    name: 'iD Tech Camps',
    role: 'Game Creation Extreme Instructor',
    logo: 'logos/id-tech.svg',
    start: '2007-07',
    end: '2007-08',
    location: 'Philadelphia, PA',
    summary:
      'Summer contract teaching "Video Game Creation Extreme" — the Torque game ' +
      'builder, game scripting, and an original course curriculum for middle ' +
      'and high school students.',
    seed: 'id-tech-camps-game-creation',
    palette: { low: '#3a0a0a', mid: '#c0392b', high: '#ff8a7a' },
    features: { rings: false, ringTilt: 0.4, oceans: true, clouds: true, aurora: true, moons: 1 },
    pois: [
      {
        slug: 'video-game-creation-extreme',
        title: 'Video Game Creation Extreme',
        accent: '#ff7a6a',
        body:
          'Instructed "Video Game Creation Extreme," teaching the Torque game ' +
          'builder and game scripting to classes averaging six middle school ' +
          'and high school students.',
        media: [],
      },
      {
        slug: 'curriculum-teaching',
        title: 'Curriculum & Teaching',
        accent: '#ff8a7a',
        body:
          'Created an original course curriculum, prepared lesson plans, and ' +
          'supervised students through hands-on game-building projects.',
        media: [],
      },
    ],
  },
  {
    slug: 'digipen',
    name: 'DigiPen Institute of Technology',
    role: 'BS, Real-Time Interactive Simulation',
    logo: 'logos/digipen.svg',
    start: '2006',
    end: '2010',
    location: 'Redmond, WA',
    summary:
      'Where it started — a rigorous, project-driven computer science and ' +
      'real-time graphics education built around shipping games every year.',
    seed: 'digipen-rtis',
    palette: { low: '#0a3a1e', mid: '#2f9e54', high: '#a8ffce' },
    features: { rings: false, ringTilt: 0.4, clouds: true, moons: 3 },
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
