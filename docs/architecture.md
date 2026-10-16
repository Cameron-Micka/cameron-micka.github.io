# Architecture

How the code is organized and how the engine, React, and renderers fit together.

## Source layout

```
src/
  engine/         Renderer-agnostic 3D engine
    math/         vec3 / mat4 / quat / easing / rng / raycast
    shaders/      WGSL (WebGPU) shaders, imported with ?raw
    WebGPURenderer.ts   WebGPU HDR scene pass + composite (bloom/tonemap/CA)
    WebGL2Renderer.ts   Matching HDR/composite path with an RGBA8 fallback
    Scene.ts      Procedural planet models (radius from tenure, seeded POIs)
    Moons.ts      Orbiting and launched-moon simulation
    Camera.ts     Single-axis dolly camera + fly-in cinematic
    InputController.ts  wheel / pointer / touch / keyboard -> intents
    QualityManager.ts   Quality presets + Auto quality ramp
    Engine.ts     Owns state + RAF loop; exposes a useSyncExternalStore store
  content/        Company + photo data (TS) validated by a zod schema
  ui/             React overlay: nav, ruler, ribbon, dialogs, settings, HUD
  routes/         SSG pages + a lazy-loaded, client-only landing canvas
```

The engine owns the simulation outside React. Overlay components subscribe to
the snapshot values they need via `useSyncExternalStore`, so camera readouts
and debug stats do not re-render project content or navigation. The photography
grid also stays unchanged while paging through the lightbox.

The 3D experience is a separate lazy chunk. It imports only the selected
rendering backend; static pages do not download either renderer. Navigating
away during asynchronous initialization disposes the completed renderer
without attaching input handlers or starting a stray animation loop. Failed
renderer candidates are also disposed before fallback or error recovery.
Intentional teardown must not trigger the hardware-loss reload path.
WebGPU startup observes GPU validation, allocation, and internal errors before
claiming the canvas and validates the first rendered frame before reporting
ready. If startup fails after WebGPU has claimed the canvas, React replaces
it and retries WebGL2 once without changing the saved renderer preference.
Production bootstrapping is deferred until the document is parsed, so the SSG
router never races its inline hydration data or build-manifest identifier.

## Notable implementation decisions

These pragmatic choices favor a reliable, buildable site and are worth knowing
before extending it:

1. **Hand-authored shaders** in WGSL (primary) and GLSL (fallback) rather than
   transpiling one source to both. A GLSL→WGSL transpile pipeline is possible
   future work.
2. **Content as typed TS validated by zod** (`src/content/`) rather than MDX
   frontmatter. The MDX Vite plugin is still wired up for future long-form pages.
3. **GPU shaders require browser validation.** Typecheck/build do not compile
   embedded GLSL or WGSL. Runtime rendering requires a real GPU and has not been
   exercised in CI; test in a browser when iterating on the render graph.
