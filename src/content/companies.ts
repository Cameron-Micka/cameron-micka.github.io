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
    features: { rings: false, ringWorld: true, ringTilt: 0.4, oceans: true, clouds: true, cityLights: true, moons: 2 },
    pois: [
      {
        slug: 'hololens-pocs',
        title: 'HoloLens POCs',
        accent: '#3aa0ff',
        body:
          'Built early HoloLens proof-of-concepts to explore interaction, ' +
          'rendering, and product scenarios, helping teams quickly validate ' +
          'mixed reality ideas before they became larger investments.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/omGoz66xHU8?is=HH6e4SwEQqgJKaMe',
            alt: 'HoloLens proof-of-concept video',
          },
          {
            type: 'video',
            src: 'https://youtu.be/vuRzUjlrALw?is=aBbEGPcBX07y_OnN',
            alt: 'HoloLens proof-of-concept video',
          },
        ],
      },
      {
        slug: 'hololens-2-isvs',
        title: 'HoloLens 2 ISVs',
        accent: '#7ad6ff',
        body:
          'Partnered with HoloLens 2 independent software vendors to unblock ' +
          'graphics and platform challenges, improve quality, and accelerate ' +
          'delivery of production mixed reality applications.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/eqFqtAJMtYE?is=kgVaWKT4L51SYxHh',
            alt: 'HoloLens 2 ISV partner video',
          },
          {
            type: 'video',
            src: 'https://youtu.be/FWYcuHUgcng?is=VyvJhUkEM0hljDaN',
            alt: 'HoloLens 2 ISV partner video',
          },
        ],
      },
      {
        slug: 'mrtk2',
        title: 'MRTK2',
        accent: '#58c4dd',
        body:
          'Contributed to MRTK2 efforts spanning developer workflow, ' +
          'rendering, and platform integration so teams could build polished ' +
          'mixed reality experiences faster on HoloLens in both Unity and Unreal Engine 4.',
        media: [
          {
            type: 'video',
           src: 'https://youtu.be/qfONlUCSWdg?is=rh1MdvlA2spZCmpX',
           alt: 'MRTK2 project video',
         },
         {
           type: 'video',
           src: 'https://youtu.be/tGYGA_L8Pnw',
            alt: 'MRTK2 project video',
          },
        ],
      },
      {
        slug: 'graphics-tools',
        title: 'Graphics Tools',
        accent: '#4ec0ff',
        body:
          'Led work on Graphics Tools, delivering production-ready shaders and ' +
          'rendering utilities tuned for the tight performance budgets of ' +
          'mobile mixed reality hardware.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/rXbkJRhaBqE',
            alt: 'Graphics Tools for Unity overview',
          },
          {
            type: 'video',
            src: 'https://youtu.be/GfeG_ZFzL1g',
            alt: 'Graphics Tools demonstration video',
          },
        ],
      },
      {
        slug: 'visual-profiler',
        title: 'Visual Profiler',
        accent: '#5dd39e',
        body:
          'Helped shape Visual Profiler capabilities that made frame cost, ' +
          'rendering hot spots, and performance tradeoffs easier to diagnose ' +
          'for mixed reality developers.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/tO9GrqpmiYk?is=yEuv2fMGsqrYQqxl',
            alt: 'Visual Profiler demonstration video',
          },
        ],
      },
      {
        slug: 'mesh',
        title: 'Microsoft Mesh',
        accent: '#4fd1c5',
        body:
          'Contributed to rendering and avatar/scene technology for Mesh, ' +
          "Microsoft's platform for shared 3D experiences across devices.",
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/_0InCXA13L8?is=vflFpiEVH0-lb9qE',
            alt: 'Microsoft Mesh project video',
          },
          {
            type: 'video',
            src: 'https://youtu.be/esBzumV_59Q?is=q3QIkV73tt1w8-zA',
            alt: 'Microsoft Mesh project video',
          },
          {
            type: 'video',
            src: 'https://youtu.be/Owq4kHLIVsw?is=6I-jTo_Pdogfsgbo',
            alt: 'Microsoft Mesh project video',
          },
        ],
      },
      {
        slug: 'teams-immersive-events',
        title: 'Teams Immersive Events',
        accent: '#6f9cff',
        body:
          'Worked on graphics and user experience foundations for Teams ' +
          'Immersive Events, bringing shared 3D presence into familiar ' +
          'Microsoft collaboration workflows.',
        media: [],
      },
    ].reverse() as CompanyInput['pois'],
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
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/FripHuBd9ZY',
            alt: 'Fat Princess Adventures gameplay',
          },
        ],
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
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/A3XenbMHPY8',
            alt: 'Virtually Live soccer video',
          },
        ],
      },
      {
        slug: 'halp',
        title: 'HALP (Oculus Touch & HTC Vive, UE4)',
        accent: '#ffd27a',
        body:
          'Stood up a custom Unreal Engine 4 build to run against prototype ' +
          'Oculus Touch hardware, and built and maintained the working ' +
          'relationship with Facebook/Oculus throughout the project.',
        media: [
          {
            type: 'video',
            src: 'https://www.youtube.com/watch?v=oLzqZyqDMOU',
            alt: 'HALP gameplay video',
          },
        ],
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
        media: [
          {
            type: 'video',
            src: 'https://www.youtube.com/embed/c10vfQtNzjI',
            alt: 'Escape Plan gameplay',
          },
        ],
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
    features: {
      rings: false,
      spaceStation: true,
      clouds: true,
      cityLights: true,
      moons: 0,
    },
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
          {
            type: 'video',
            src: 'https://youtu.be/huT1ZyuOeHE?is=SxVcGRU-IQhoIfQ5',
            alt: 'Star Wars: The Force Unleashed II DLC gameplay',
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
    features: { rings: false, ringTilt: 0.4, oceans: true, aurora: true, moons: 16, moonOrbitSpacing: 0.1 },
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
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/AaIiTEN6Hzw',
            alt: 'Hairball gameplay video',
          },
        ],
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
    start: '2007',
    end: '2007',
    location: 'Philadelphia, PA',
    summary:
      'Summer contract teaching "Video Game Creation Extreme" — the Torque game ' +
      'builder, game scripting, and an original course curriculum for middle ' +
      'and high school students.',
    seed: 'id-tech-camps-game-creation',
    palette: { low: '#3a0a0a', mid: '#c0392b', high: '#ff8a7a' },
    features: {
      rings: true,
      ringTilt: 0.8,
      thinRing: true,
      secondRing: true,
      secondRingTilt: 0.5,
      oceans: true,
      clouds: true,
      aurora: true,
      moons: 1,
    },
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
          'Earned a Bachelor of Science in Computer Science with a minor in ' +
          'Mathematics. Studied real-time interactive simulation, mathematics, ' +
          'physics, and game design. Shipped a new game engine and game from ' +
          'scratch each year.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/c5NJvkL3GLQ',
            alt: 'Gameplay footage from a DigiPen student game project (video 1 of 3)',
            description:
              'My junior capstone project, ' +
              '[Kabloom](https://games.digipen.edu/games/kabloom), was a ' +
              'finalist at the Independent Games Festival (IGF).',
          },
          {
            type: 'video',
            src: 'https://youtu.be/c9yoW2fkyzo',
            alt: 'Gameplay footage from a DigiPen student game project (video 2 of 3)',
            description:
              'We also took courses in console and handheld development. ' +
              'This is an example of a Nintendo Game Boy Color game written in C.',
          },
          {
            type: 'video',
            src: 'https://youtu.be/9ujHQi1ChKM',
            alt: 'Gameplay footage from a DigiPen student game project (video 3 of 3)',
            description:
              'This game was built for the Nintendo Wii and ran on a ' +
              'development kit. I wrote a custom engine in a single semester ' +
              "that utilized the Wii's Texture Environment Unit (TEV).",
          },
        ],
      },
      {
        slug: 'graphics-foundations',
        title: 'Graphics Foundations',
        accent: '#a8ffce',
        body:
          'Took multiple real-time computer graphics courses each year, ' +
          'starting with custom software rasterizers and progressing through ' +
          'OpenGL, DirectX, shaders, and a variety of graphics algorithms.',
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
