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
        dates: '2016 – 2018',
        body:
          'Built early HoloLens proof-of-concepts for key Microsoft customers to explore interaction, ' +
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
          {
            type: 'image',
            src: '/media/microsoft/launch-vector-labs.webp',
            alt: 'Launch Vector Labs logo printed on the back of a Microsoft Surface device',
          },
          {
            type: 'image',
            src: '/media/microsoft/hololens-demo-event.webp',
            alt: 'An attendee wearing a HoloLens during a demo at a Microsoft event',
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
          'delivery of production mixed reality applications and platform features.',
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
          {
            type: 'video',
            src: 'https://youtu.be/qG98XIK7NBs',
            alt: 'MRTK 2 pinch slider demo',
          },
          {
            type: 'image',
            src: '/media/microsoft/hololens-2-workbench.webp',
            alt: 'Surface Book next to HoloLens 2 headsets and an anatomical heart model on a lab bench',
          },
        ],
      },
      {
        slug: 'mrtk-unreal',
        title: 'MRTK-Unreal',
        accent: '#6fa8ff',
        dates: '2018 – 2020',
        body:
          'Contributed to ' +
          '[Mixed Reality Toolkit for Unreal (MRTK-Unreal)](https://github.com/microsoft/MixedRealityToolkit-Unreal), ' +
          'spanning developer workflow, rendering, and platform integration ' +
          'so teams could build polished mixed reality experiences faster on ' +
          'HoloLens.\n\n' +
          'Served as the sole graphics engineer and bridged the gap between ' +
          'design and engineering for the organization.\n\n' +
          'Evangelized the platform by helping release Kippy\u2019s Escape, a ' +
          'sample game built with Framestore, and partnered with Epic Games ' +
          'to release a webinar on developing for HoloLens 2 in Unreal Engine.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/0WVmyGXBtRs',
            alt: 'MRTK-Unreal release overview',
          },
          {
            type: 'video',
            src: 'https://youtu.be/EGVWfmFSuWM',
            alt: 'Kippy\u2019s Escape trailer',
          },
          {
            type: 'video',
            src: 'https://youtu.be/tGYGA_L8Pnw',
            alt: 'Getting started with HoloLens 2 and Unreal Engine',
          },
          {
            type: 'video',
            src: 'https://youtu.be/t95Bge-yk5E',
            alt: 'Working with Unreal Engine and HoloLens 2 webinar',
          },
        ],
      },
      {
        slug: 'mrtk-unity',
        title: 'MRTK-Unity',
        accent: '#58c4dd',
        dates: '2018 – 2020',
        body:
          'Contributed to ' +
          '[Mixed Reality Toolkit for Unity (MRTK-Unity)](https://github.com/microsoft/mixedrealitytoolkit-unity), ' +
          'spanning developer workflow, rendering, and platform integration ' +
          'so teams could build polished mixed reality experiences faster on ' +
          'HoloLens.\n\n' +
          'Took learnings from engagements with HoloLens 2 ISVs and turned ' +
          'their needs into real toolkit features.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/qfONlUCSWdg',
            alt: 'MRTK-Unity 2.6.0 release overview',
          },
        ],
      },
      {
        slug: 'visual-profiler',
        title: 'Performance Tooling',
        accent: '#5dd39e',
        dates: '2020 – 2026',
        body:
          "Built Mesh's Content Performance Analyzer and created and maintain " +
          'the [Visual Profiler](https://github.com/microsoft/VisualProfiler-Unity) ' +
          'repo, giving mixed reality developers actionable insight into content ' +
          'bottlenecks, frame cost, rendering hot spots, and performance tradeoffs.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/tO9GrqpmiYk?is=yEuv2fMGsqrYQqxl',
            alt: 'Visual Profiler demonstration video',
          },
          {
            type: 'video',
            src: 'https://youtu.be/pbe3mx_bFTA',
            alt: 'Content Performance Analyzer demonstration video',
          },
          {
            type: 'image',
            src: '/media/microsoft/visual-profiler-guide.webp',
            alt: 'Annotated Visual Profiler guide explaining frame rate, frame history, draw calls, vertex count, and memory usage',
          },
          {
            type: 'image',
            src: '/media/microsoft/content-performance-analyzer.webp',
            alt: 'Content Performance Analyzer window in Unity listing passed, warning, and failed analyzers with suggested fixes',
          },
        ],
      },
      {
        slug: 'graphics-tools-unreal',
        title: 'Graphics Tools for Unreal',
        accent: '#3aa0ff',
        dates: '2020 – 2026',
        body:
          'Led work on Graphics Tools for Unreal, delivering production-ready shaders and ' +
          'rendering utilities tuned for the tight performance budgets of ' +
          'mobile mixed reality hardware through ' +
          '[Mixed Reality Graphics Tools for Unreal](https://github.com/microsoft/MixedReality-GraphicsTools-Unreal).',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/GfeG_ZFzL1g',
            alt: 'Graphics Tools for Unreal demonstration video',
          },
          {
            type: 'image',
            src: '/media/graphics-tools/unreal-lighting.webp',
            alt: 'Unreal material graph using the Graphics Tools default lit function, rendering metallic spheres with varying roughness',
          },
          {
            type: 'image',
            src: '/media/graphics-tools/unreal-effects.webp',
            alt: 'Graphics Tools effects including a proximity light, spatial mesh shading, and wireframe materials',
          },
          {
            type: 'image',
            src: '/media/graphics-tools/unreal-clipping.webp',
            alt: 'Models cut by clipping plane, sphere, box, and cone primitives',
          },
          {
            type: 'image',
            src: '/media/graphics-tools/unreal-profiling.webp',
            alt: 'In-headset profiler showing frame, game, draw, and GPU times against a target frame time',
          },
        ],
      },
      {
        slug: 'graphics-tools-unity',
        title: 'Graphics Tools for Unity',
        accent: '#4ec0ff',
        dates: '2020 – 2026',
        body:
          'Led work on Graphics Tools for Unity, delivering production-ready shaders and ' +
          'rendering utilities tuned for the tight performance budgets of ' +
          'mobile mixed reality hardware through ' +
          '[Mixed Reality Graphics Tools for Unity](https://github.com/microsoft/MixedReality-GraphicsTools-Unity).',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/rXbkJRhaBqE',
            alt: 'Graphics Tools for Unity overview',
          },
          {
            type: 'image',
            src: '/media/graphics-tools/unity-showcase.webp',
            alt: 'Graphics Tools for Unity materials, a glowing translucent cube, and a mixed reality settings panel',
          },
          {
            type: 'image',
            src: '/media/graphics-tools/clipping-primitives.webp',
            alt: 'Models cut by clipping box, clipping plane, and clipping sphere primitives',
          },
        ],
      },
      {
        slug: 'mesh',
        title: 'Microsoft Mesh & Teams Immersive Events',
        accent: '#4fd1c5',
        dates: '2020 – 2026',
        body:
          'Contributed to rendering, avatar, scene, and user experience technology for ' +
          'Microsoft Mesh and Teams Immersive Events, bringing shared 3D presence ' +
          'across devices and into familiar Microsoft collaboration workflows.',
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
          {
            type: 'video',
            src: 'https://youtu.be/9jG4cPfjYuQ?is=ODIGWLVsZoGJsa_D',
            alt: 'Teams Immersive Events project video',
          },
          {
            type: 'image',
            src: '/media/microsoft/mesh-campfire.webp',
            alt: 'Mesh campfire social activity with a fire pit and marshmallow sticks in a pavilion',
          },
          {
            type: 'image',
            src: '/media/microsoft/mesh-icebreaker.webp',
            alt: 'Mesh pavilion with Ice Breaker conversation spheres, a radio, and a screen share station',
          },
          {
            type: 'image',
            src: '/media/microsoft/mesh-beanbag-toss.webp',
            alt: 'Mesh beanbag toss game demonstrating throwable interactables',
          },
          {
            type: 'image',
            src: '/media/microsoft/mesh-physics.webp',
            alt: 'Mesh Physics gravity demo with planets floating in a pavilion',
          },
        ],
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
        slug: 'vr-titles',
        title: 'Virtual Reality Titles',
        accent: '#ffb866',
        dates: '2016',
        body:
          '**HALP** (Oculus Touch & HTC Vive, UE4) — Stood up a custom ' +
          'Unreal Engine 4 build to run against prototype ' +
          'Oculus Touch hardware, and built and maintained the working ' +
          'relationship with Facebook/Oculus throughout the project.\n\n' +
          '**Virtually Live: Soccer** (HTC Vive, Unity 5 & UE4) — Integrated ' +
          'the SteamVR plugin and built the camera and input ' +
          'system used by designers, keeping the experience above 90fps in ' +
          'collaboration with art and design.\n\n' +
          'Authored a procedural crowd ' +
          'tool that let the team drop large, varied stadium audiences in ' +
          'place — with automatic texture atlasing, mesh combining, and LOD ' +
          'handling under the hood.',
        media: [
          {
            type: 'video',
            src: 'https://www.youtube.com/watch?v=oLzqZyqDMOU',
            alt: 'HALP gameplay video',
          },
          {
            type: 'video',
            src: 'https://youtu.be/A3XenbMHPY8',
            alt: 'Virtually Live soccer video',
          },
        ],
      },
      {
        slug: 'fat-princess-adventures',
        title: 'Fat Princess Adventures & DLC (PS4, C4 Engine)',
        accent: '#ff9f43',
        dates: '2012 – 2015',
        body:
          'As Technical Director, led a team of up to 12 engineers to ship ' +
          'Fat Princess Adventures and its DLC expansion — ' +
          'scheduling deliverables, mitigating risk, screening candidates, ' +
          'and running the 60fps@1080p profiling effort.\n\n' +
          'Personally owned ' +
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
          {
            type: 'image',
            src: '/media/fun-bits/fat-princess-adventures-booth.webp',
            alt: 'Players wearing cardboard Fat Princess Adventures helmets at a PlayStation event demo booth',
          },
          {
            type: 'image',
            src: '/media/fun-bits/fat-princess-adventures-cosplay.webp',
            alt: 'A Fat Princess cosplayer holding a cake beside players at the Fat Princess Adventures demo stations',
          },
        ],
      },
      {
        slug: 'escape-plan',
        title: 'Escape Plan & DLC (PS Vita & PS4, Unity 3)',
        accent: '#ffe1a8',
        dates: '2011',
        body:
          'Helped port portions of Unity to PlayStation Vita while shipping ' +
          'Escape Plan — the Vita\u2019s #1 selling downloadable game — ' +
          'along with four DLC expansions.\n\n' +
          'Implemented Vita platform services (trophies, save data, store ' +
          'entitlements), scripted most gameplay systems, and built a ' +
          'custom UI implementation, localization system, character state ' +
          'machine, root-motion system, character controller, and editor ' +
          'tools.\n\n' +
          'Identified slow C# scripts and ported them to native, ' +
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
        dates: '2010',
        body:
          'Programmed and scripted gameplay systems on Star Wars: The Force ' +
          'Unleashed II for PlayStation 3 and Xbox 360, with an emphasis on ' +
          'boss battles, and fixed bugs to prepare the game for shipping ' +
          'under a tight deadline.\n\n' +
          'Collaborated with the LucasArts Singapore team to ' +
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
        dates: '2009',
        body:
          'During an internship on The Force Unleashed I & II, wrote the ' +
          'networked gameplay data logging system, a heat-map generation ' +
          'tool, and a gameplay replay system — and chased down sources of ' +
          'non-determinism inside Ronin, LucasArts\u2019 proprietary in-house ' +
          'game engine.',
        media: [
          {
            type: 'image',
            src: '/media/lucasarts/lucasarts-team.webp',
            alt: 'Four people sitting on a lawn in front of a large white Victorian-style house',
          },
          {
            type: 'image',
            src: '/media/lucasarts/boba-fett-costume.webp',
            alt: 'Posing beside a Boba Fett costume display in front of a Rebel Alliance banner',
          },
        ],
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
        dates: '2008 – 2013',
        body:
          'Handled every aspect of programming and development. Wrote a ' +
          'proprietary mobile game engine from scratch using OpenGL ES 1.0 ' +
          '(later 2.0), OpenAL, and Box2D.\n\n' +
          'Submitted to the iTunes App Store in August 2008 — just weeks ' +
          'after it opened — making Hairball one of the very first games on ' +
          'the platform, at the dawn of the mobile gaming era.\n\n' +
          'Microsoft then reached out to bring Hairball to the Zune HD, ' +
          'leading to a port from iOS to XNA that took the game to a second ' +
          'mobile platform.',
        media: [
          {
            type: 'video',
            src: 'https://youtube.com/shorts/vc2ZDdOg7Zw?is=EmNwoELJn3KuEM-2',
            alt: 'Hairball gameplay video',
            description: 'The first version of Hairball, released in 2008.',
          },
          {
            type: 'video',
            src: 'https://youtu.be/AaIiTEN6Hzw',
            alt: 'Hairball gameplay video',
            description:
              'The Zune HD version of Hairball, built using XNA in 2010.',
          },
          {
            type: 'image',
            src: '/media/micka-studios/hairball-gameplay.webp',
            alt: 'Hairball gameplay on an iPhone showing a fuzzy ball bouncing between wooden platforms',
          },
          {
            type: 'image',
            src: '/media/micka-studios/hairball-menu.webp',
            alt: 'Hairball title screen with Start, How to play, and Quit buttons on an iPhone held in a hand',
          },
          {
            type: 'image',
            src: '/media/micka-studios/hairball-zune-hd.webp',
            alt: 'Hairball title screen with Start, High Scores, How To Play, and Options buttons on a Zune HD held in a hand',
          },
        ],
      },
      {
        slug: 'snowball',
        title: 'Snowball (iOS)',
        accent: '#c98bff',
        body:
          'Ported Snowball from PC to iOS to sell on the iTunes App Store, ' +
          'where it landed on Apple\u2019s "Featured" page — selling over ' +
          '8,000 copies in a month.\n\n' +
          'Collaborated with Zynga on cross-promotion advertisements.',
        media: [
          {
            type: 'image',
            src: '/media/micka-studios/snowball-menu.webp',
            alt: 'Snowball title screen with Play and Quit buttons on an iPod touch held in a hand',
          },
          {
            type: 'image',
            src: '/media/micka-studios/snowball-gameplay.webp',
            alt: 'Snowball gameplay on an iPod touch showing an icy tile maze and score counters',
          },
        ],
      },
      {
        slug: 'iventure-hd',
        title: 'iVenture HD (iOS)',
        accent: '#d9b3ff',
        dates: '2010',
        body:
          'One of the first universal games available for iPad and iPhone.\n\n' +
          'Wrote all game and engine features from scratch, including an ' +
          'in-game level editor that shipped with the final game.',
        media: [
          {
            type: 'image',
            src: '/media/micka-studios/iventure-hd-menu.webp',
            alt: 'iVenture HD main menu with Play, Editor, Options, and Help buttons',
          },
          {
            type: 'image',
            src: '/media/micka-studios/iventure-hd-game-center.webp',
            alt: 'iVenture HD gameplay in a moonlit pagoda world with Game Center high scores',
          },
          {
            type: 'image',
            src: '/media/micka-studios/iventure-hd-editor.webp',
            alt: 'iVenture HD built-in level editor placing blocks on graph paper',
          },
          {
            type: 'image',
            src: '/media/micka-studios/iventure-hd-space.webp',
            alt: 'iVenture HD gameplay in an outer space world among stars',
          },
        ],
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
          'and high school students.\n\n' +
          'Created an original course curriculum, ' +
          'prepared lesson plans, and supervised students through hands-on ' +
          'game-building projects.',
        media: [
          {
            type: 'image',
            src: '/media/id-tech/video-game-creation-extreme-class.webp',
            alt: 'Students giving a thumbs up at their workstations during an iD Tech game creation class',
          },
        ],
      },
    ],
  },
  {
    slug: 'digipen',
    name: 'DigiPen Institute of Technology',
    role: 'BS, Real-Time Interactive Simulation, Minor in Mathematics',
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
          'scratch each year.\n\n' +
          'Took multiple real-time computer graphics courses each year, ' +
          'starting with custom software rasterizers and progressing through ' +
          'OpenGL, DirectX, shaders, and a variety of graphics algorithms.',
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
            type: 'image',
            src: '/media/digipen/kabloom-1.webp',
            alt: 'Kabloom screenshot: an elephant character standing in a field of pink daisies',
          },
          {
            type: 'image',
            src: '/media/digipen/kabloom-2.webp',
            alt: 'Kabloom screenshot: a floating garden island suspended from an airship',
          },
          {
            type: 'image',
            src: '/media/digipen/kabloom-3.webp',
            alt: 'Kabloom screenshot: the elephant exploring a grassy meadow among trees',
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
    ],
  },
];

// Validate at module load so malformed content fails fast in dev and build.
// Reversed so the timeline runs farthest ("Past") -> closest-to-camera ("Now"),
// i.e. Microsoft (the current role) is the last planet in the sequence. The
// engine still opens focused on the current role — see Engine's initial index.
export const companies: Company[] = companiesSchema.parse(raw).reverse();
