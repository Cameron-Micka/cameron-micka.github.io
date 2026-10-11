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
        platforms: 'HoloLens',
        engine: 'Unity',
        accent: '#3aa0ff',
        dates: '2016 – 2018',
        body:
          'Built early HoloLens proof-of-concepts with key Microsoft ' +
          'customers, helping them validate mixed reality ideas before ' +
          'committing to larger investments.\n\n' +
          'Projects included Boeing and Insitu\u2019s wildfire response ' +
          'demo, which turned ScanEagle drone feeds into shared holographic ' +
          'tactical maps, and Oyanagi Construction\u2019s ' +
          '[Holostruction](https://news.microsoft.com/apac/2017/05/03/oyanagi-construction-microsoft-japan-partner-holostruction-project-using-microsoft-hololens/), ' +
          'which brought 3D construction plans onto job sites in Japan.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/omGoz66xHU8?is=HH6e4SwEQqgJKaMe',
            alt: 'Boeing: UAVs. Holograms. Wildfire.',
          },
          {
            type: 'video',
            src: 'https://youtu.be/vuRzUjlrALw?is=aBbEGPcBX07y_OnN',
            alt: 'Oyanagi Construction Holostruction with Microsoft HoloLens',
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
        platforms: 'HoloLens 2',
        engine: 'Unity',
        accent: '#7ad6ff',
        dates: '2018 – 2020',
        body:
          'Worked hands-on with HoloLens 2 launch partners, including ' +
          'Bentley, Philips, and PTC, to solve graphics and performance ' +
          'challenges so their production apps were ready for the ' +
          'device\u2019s 2019 debut.\n\n' +
          'Fed those lessons back into MRTK, turning recurring partner ' +
          'needs into reusable features like hand-attached UI and slider ' +
          'controls.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/eqFqtAJMtYE?is=kgVaWKT4L51SYxHh',
            alt: 'Introducing Microsoft HoloLens 2',
          },
          {
            type: 'video',
            src: 'https://youtu.be/FWYcuHUgcng?is=VyvJhUkEM0hljDaN',
            alt: 'Industry partner solutions for HoloLens 2 from Bentley, Philips, and PTC',
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
        slug: 'mrtk-unity',
        title: 'MRTK-Unity',
        platforms: 'Open Source Toolkit',
        engine: 'Unity',
        accent: '#58c4dd',
        dates: '2018 – 2021',
        body:
          'Core graphics contributor to ' +
          '[Mixed Reality Toolkit for Unity (MRTK-Unity)](https://github.com/microsoft/mixedrealitytoolkit-unity), ' +
          'Microsoft\u2019s open-source toolkit for building HoloLens apps, ' +
          'spanning rendering, UX controls, and developer tooling.\n\n' +
          '**HoloLens shell parity.** Brought the HoloLens 2 shell\u2019s ' +
          'look and feel to developers out of the box with compressible ' +
          'buttons, proximity lighting, and the finger-tip cursor.\n\n' +
          '**Components & tools.** Built the Hand Constraint solver for ' +
          'hand-attached UI, MaterialInstance, and the Dependency Window, ' +
          'and improved the in-headset Visual Profiler. Many of these grew ' +
          'directly out of HoloLens 2 partner needs.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/qfONlUCSWdg',
            alt: 'MRTK-Unity 2.6.0 release overview',
          },
        ],
      },
      {
        slug: 'graphics-tools-unreal',
        title: 'Graphics Tools for Unreal',
        platforms: 'Open Source Toolkit',
        engine: 'Unreal Engine',
        accent: '#3aa0ff',
        dates: '2020 – 2021',
        body:
          'Led development of ' +
          '[Mixed Reality Graphics Tools for Unreal](https://github.com/microsoft/MixedReality-GraphicsTools-Unreal), ' +
          'giving Unreal developers production-ready shaders, blueprints, ' +
          'and examples tuned for the tight performance budgets of mobile ' +
          'mixed reality hardware.\n\n' +
          'Shipped mixed reality–optimized lighting, proximity lights, ' +
          'clipping primitives, spatial mesh effects, mesh outlines, and ' +
          'in-headset profiling across HoloLens 2, Windows, and Android.',
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
        slug: 'mrtk-unreal',
        title: 'MRTK-Unreal',
        platforms: 'Open Source Toolkit',
        engine: 'Unreal Engine',
        accent: '#6fa8ff',
        dates: '2020 – 2021',
        body:
          'Sole graphics engineer on ' +
          '[Mixed Reality Toolkit for Unreal (MRTK-Unreal)](https://github.com/microsoft/MixedRealityToolkit-Unreal), ' +
          'bridging design and engineering. In ' +
          '[UX Tools for Unreal](https://github.com/microsoft/MixedReality-UXTools-Unreal), ' +
          'built HoloLens 2–style pressable, toggle, and radio buttons, the ' +
          'finger-tip cursor, bounds control visuals, and near menus.\n\n' +
          'Championed Unreal on HoloLens 2 by helping release ' +
          '[Kippy\u2019s Escape](https://github.com/microsoft/MixedReality-Unreal-KippysEscape), ' +
          'an open-source sample game built with Framestore, and partnering ' +
          'with Epic Games on a webinar about building for HoloLens 2 in ' +
          'Unreal Engine.',
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
        slug: 'graphics-tools-unity',
        title: 'Graphics Tools for Unity',
        platforms: 'Open Source Toolkit',
        engine: 'Unity',
        accent: '#4ec0ff',
        dates: '2021 – 2026',
        body:
          'Lead developer of ' +
          '[Mixed Reality Graphics Tools for Unity](https://github.com/microsoft/MixedReality-GraphicsTools-Unity), ' +
          'the ' +
          '[MRTK3 graphics package](https://learn.microsoft.com/en-us/windows/mixed-reality/mrtk-unity/mrtk3-graphicstools/) ' +
          'of shaders, tools, and samples that raise the visual fidelity of ' +
          'mixed reality apps within tight performance budgets.\n\n' +
          '**Origins in MRTK.** Created the ' +
          '[MRTK Standard shader](https://learn.microsoft.com/en-us/windows/mixed-reality/mrtk-unity/mrtk2/features/rendering/mrtk-standard-shader), ' +
          'a flexible Fluent Design shading system with clipping, proximity ' +
          'and hover lights, and mesh outlines. It became the foundation of ' +
          'Graphics Tools.\n\n' +
          '**Features.** Built the canvas shaders behind MRTK3\u2019s UI, ' +
          'acrylic blur, a magnifier, Shader Graph targets, area lights, ' +
          'and editor tools for combining textures, meshes, and lights. ' +
          'Kept it all current through Unity 6 across HoloLens 2, URP, and ' +
          'WebGL.',
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
        slug: 'visual-profiler',
        title: 'Performance Tooling',
        platforms: 'Open Source Toolkit',
        engine: 'Unity',
        accent: '#5dd39e',
        dates: '2017 – 2026',
        body:
          'Created and maintain the ' +
          '[Visual Profiler](https://github.com/microsoft/VisualProfiler-Unity), ' +
          'a drop-in Unity profiler that shows frame rate, scene ' +
          'complexity, and memory at a glance. It renders in a single draw ' +
          'call with no per-frame allocations and runs on HoloLens, Meta ' +
          'Quest, OpenXR, and WebGL.\n\n' +
          'Built Mesh\u2019s Content Performance Analyzer, which flags ' +
          'costly content and suggests fixes so creators can cut download ' +
          'times, improve comfort, and extend battery life.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/tO9GrqpmiYk?is=yEuv2fMGsqrYQqxl',
            alt: 'Microsoft Mesh performance tools video',
            description: 'Overview of profiling tools in the Mesh Toolkit.',
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
        slug: 'mesh-toolkit',
        title: 'Microsoft Mesh Toolkit',
        engine: 'Unity',
        accent: '#38b2ac',
        body:
          'Managed a five-person team of engineers and designers across the ' +
          'United States and Nigeria that helped build the tutorials and ' +
          'samples in the ' +
          '[Mesh Toolkit](https://github.com/microsoft/mesh-toolkit-unity), ' +
          'including Mesh 101 and 201 and the Pavilion. They give creators ' +
          'starting points for custom onboarding, training, guided tours, ' +
          'and social gatherings in Microsoft Mesh.\n\n' +
          'Also integrated the Content Performance Analyzer and Visual ' +
          'Profiler into the toolkit so creators could find and fix ' +
          'performance issues before publishing (more on these tools ' +
          'below).',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/Owq4kHLIVsw?is=6I-jTo_Pdogfsgbo',
            alt: 'Mesh 101: move objects and trigger animations',
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
      {
        slug: 'mesh',
        title: 'Microsoft Mesh & Teams Immersive Events',
        platforms: 'Windows, Web & Meta Quest',
        engine: 'Unity',
        accent: '#4fd1c5',
        dates: '2021 – 2026',
        body:
          'Worked on ' +
          '[Microsoft Mesh](https://www.microsoft.com/en-us/microsoft-teams/microsoft-mesh) ' +
          'from its 2021 debut through its 2024 launch in Microsoft Teams ' +
          'and its evolution into Teams immersive events, contributing ' +
          'rendering, avatar, scene, and user experience technology.\n\n' +
          'The result is shared 3D spaces where colleagues gather as ' +
          'avatars for all-hands, training, and team building, right inside ' +
          'Teams with no new devices required.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/_0InCXA13L8?is=vflFpiEVH0-lb9qE',
            alt: 'Microsoft Mesh overview',
          },
          {
            type: 'video',
            src: 'https://youtu.be/esBzumV_59Q?is=q3QIkV73tt1w8-zA',
            alt: 'How to explore immersive spaces in Microsoft Teams',
          },
          {
            type: 'video',
            src: 'https://youtu.be/9jG4cPfjYuQ?is=ODIGWLVsZoGJsa_D',
            alt: 'Introducing the new Microsoft Teams events experience',
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
          '**HALP** (Oculus Touch & HTC Vive, UE4) — A VR sandbox puzzle ' +
          'game released on Steam in 2016. Stood up a custom Unreal Engine ' +
          '4 build for prototype Oculus Touch hardware and owned the ' +
          'working relationship with Facebook/Oculus.\n\n' +
          '**Virtually Live: Soccer** (HTC Vive, Unity 5 & UE4) — A ' +
          'platform for virtually attending live matches, shown at GDC ' +
          '2016. Integrated SteamVR, built the camera and input systems ' +
          'designers relied on, and partnered with art and design to hold ' +
          'above 90fps.\n\n' +
          'Also built a procedural crowd tool that filled stadiums with ' +
          'large, varied audiences, handling texture atlasing, mesh ' +
          'combining, and LODs automatically.',
        media: [
          {
            type: 'video',
            src: 'https://www.youtube.com/watch?v=oLzqZyqDMOU',
            alt: 'HALP! Oculus Rift + Touch prototype',
          },
          {
            type: 'video',
            src: 'https://youtu.be/A3XenbMHPY8',
            alt: 'How Virtually Live works',
          },
        ],
      },
      {
        slug: 'fat-princess-adventures',
        title: 'Fat Princess Adventures & DLC',
        platforms: 'PS4',
        engine: 'C4 Engine',
        accent: '#ff9f43',
        dates: '2012 – 2015',
        body:
          'As Technical Director, led up to 12 engineers to ship Fat ' +
          'Princess Adventures, a four-player co-op action RPG published by ' +
          'Sony for PS4 in December 2015, and its DLC expansion. Ran ' +
          'scheduling, risk management, candidate screening, and the push ' +
          'to hit 60fps at 1080p.\n\n' +
          'Stayed hands-on, personally owning layered animation, Havok ' +
          'integration and the kinematic character controller, AI ' +
          'pathfinding and scripted behavior, networked gameplay, the ' +
          'character state machine and customization, the camera system, ' +
          'editor and debugging tools, and visual-scripting improvements.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/FripHuBd9ZY',
            alt: 'Fat Princess Adventures trailer',
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
        title: 'Escape Plan & DLC',
        platforms: 'PS Vita & PS4',
        engine: 'Unity 3 (Custom Port)',
        accent: '#ffe1a8',
        dates: '2011',
        body:
          'Shipped Escape Plan, a PS Vita launch title built around the ' +
          'system\u2019s front touch, rear touch, and motion controls that ' +
          'became the Vita\u2019s #1 selling downloadable game, plus four ' +
          'DLC expansions.\n\n' +
          'Helped port portions of Unity to the Vita, implemented platform ' +
          'services (trophies, save data, store entitlements), and scripted ' +
          'most gameplay systems. Built the UI and localization systems, ' +
          'character state machine, root motion, character controller, and ' +
          'editor tools, and moved slow C# scripts to native code.',
        media: [
          {
            type: 'video',
            src: 'https://www.youtube.com/embed/c10vfQtNzjI',
            alt: 'Escape Plan PS Vita trailer',
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
        platforms: 'PS3 & X360',
        engine: 'Ronin Engine',
        accent: '#e6c35c',
        dates: '2010',
        body:
          'Programmed and scripted gameplay on Star Wars: The Force ' +
          'Unleashed II (PS3 & Xbox 360, October 2010), focusing on boss ' +
          'battles, and helped land the game under a tight shipping ' +
          'deadline.\n\n' +
          'After launch, worked with LucasArts Singapore to fix bugs and ' +
          'ship the Endor mission DLC.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/puvH9OmQ4fc',
            alt: 'Star Wars: The Force Unleashed II announce trailer',
          },
          {
            type: 'video',
            src: 'https://youtu.be/huT1ZyuOeHE?is=SxVcGRU-IQhoIfQ5',
            alt: 'Star Wars: The Force Unleashed II Endor DLC trailer',
          },
        ],
      },
      {
        slug: 'ronin-engine-tools',
        title: 'Tools & Telemetry',
        platforms: 'PS3 & X360',
        engine: 'Ronin Engine',
        accent: '#fff1c1',
        dates: '2009',
        body:
          'As an intern on The Force Unleashed I & II, built a networked ' +
          'gameplay data logging system, a heat-map generator, and a ' +
          'gameplay replay system, and tracked down sources of ' +
          'non-determinism in Ronin, LucasArts\u2019 proprietary game ' +
          'engine.',
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
        title: 'Hairball',
        platforms: 'iOS',
        engine: 'Custom Engine',
        accent: '#b768ff',
        dates: '2008 – 2013',
        body:
          'One of the very first games on the iPhone App Store, submitted ' +
          'in August 2008, just weeks after the store opened. A ' +
          'tilt-controlled endless arcade game where you guide a hairball ' +
          'down a clogged pipe.\n\n' +
          'Handled all programming and development, including a proprietary ' +
          'mobile engine written from scratch on OpenGL ES 1.0 (later 2.0), ' +
          'OpenAL, and Box2D.',
        media: [
          {
            type: 'video',
            src: 'https://youtube.com/shorts/vc2ZDdOg7Zw?is=EmNwoELJn3KuEM-2',
            alt: 'Hairball gameplay video',
            description: 'The first version of Hairball, released in 2008.',
          },
          {
            type: 'video',
            src: 'https://youtube.com/shorts/hUBL8_sYVQI?si=vKI0Gbj-D_CGLf3L',
            alt: 'Hairball for iOS gameplay video',
            description: 'The updated version of Hairball, released in 2014.',
          },
          {
            type: 'image',
            src: '/media/micka-studios/hairball-title-screen.webp',
            alt: 'Hairball title screen with the main play, help, appearance, and character selection buttons',
          },
          {
            type: 'image',
            src: '/media/micka-studios/hairball-character-select.webp',
            alt: 'Hairball character selection screen showing Hairball, Metaball, Oddball, Flappyball, Appleball, and Snowball',
          },
          {
            type: 'image',
            src: '/media/micka-studios/hairball-ipad-gameplay.webp',
            alt: 'Hairball gameplay showing the fuzzy character jumping between wooden platforms',
          },
          {
            type: 'image',
            src: '/media/micka-studios/hairball-game-over.webp',
            alt: 'Hairball game over screen showing a final score of 222 and a high score of 1796',
          },
        ],
      },
      {
        slug: 'hairball-zune-hd',
        title: 'Hairball for Zune HD',
        platforms: 'Zune HD',
        engine: 'XNA',
        accent: '#9d5cff',
        dates: '2010',
        body:
          'After Microsoft reached out to bring Hairball to the Zune HD, ' +
          'ported the game from iOS to XNA, taking it to a second mobile ' +
          'platform.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/AaIiTEN6Hzw',
            alt: 'Hairball gameplay video',
            description:
              'The Zune HD version of Hairball, built using XNA in 2010.',
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
        title: 'Snowball',
        platforms: 'iOS',
        engine: 'Custom Engine',
        accent: '#c98bff',
        body:
          'Ported Snowball from PC to iOS, where Apple featured it on the ' +
          'App Store and it sold over 8,000 copies in a month.\n\n' +
          'Also partnered with Zynga on cross-promotion.',
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
        title: 'iVenture HD',
        platforms: 'iOS',
        engine: 'Custom Engine',
        accent: '#d9b3ff',
        dates: '2010',
        body:
          'One of the first universal games for iPad and iPhone.\n\n' +
          'Wrote every game and engine feature from scratch, including a ' +
          'level editor that shipped in the final game.',
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
        platforms: 'Windows',
        engine: 'Torque Game Builder',
        accent: '#ff7a6a',
        body:
          'Taught “Video Game Creation Extreme” to middle and high school ' +
          'students in classes of about six, covering Torque Game Builder ' +
          'and game scripting.\n\n' +
          'Designed an original curriculum, prepared lesson plans, and ' +
          'guided students through hands-on game-building projects.',
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
        platforms: 'Windows, Wii & Game Boy Advance',
        engine: 'Custom Engine',
        accent: '#4fe08a',
        body:
          'Earned a BS in Computer Science in Real-Time Interactive ' +
          'Simulation with a minor in Mathematics, studying math, physics, ' +
          'and game design while building a new game engine and game from ' +
          'scratch every year.\n\n' +
          'Took real-time graphics courses every year, progressing from ' +
          'custom software rasterizers through OpenGL, DirectX, shaders, ' +
          'and a wide range of graphics algorithms.',
        media: [
          {
            type: 'video',
            src: 'https://youtu.be/c5NJvkL3GLQ',
            alt: 'Gameplay footage from a DigiPen student game project (video 1 of 3)',
            description:
              'My junior capstone project, ' +
              '[Kabloom](https://games.digipen.edu/games/kabloom), a poetic ' +
              'puzzle game about an elephant reviving a dying island, was a ' +
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
