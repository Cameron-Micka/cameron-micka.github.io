# Cameron Micka — Portfolio

A personal portfolio built as a real-time 3D experience: the landing page is a
WebGPU-rendered "Time Machine" of my career, where each **planet** is a place
I've worked and each glowing **point of interest** opens a story. The UI is
React; the rendering is a hand-written engine with a **WebGL2 fallback**.

**Stack:** TypeScript · React 18 · Vite · WebGPU (WGSL) + WebGL2 (GLSL ES 3.0)
· `vite-react-ssg` for static pages · zod-validated content.

## Develop

```bash
npm install
npm run dev        # local dev server
npm run typecheck  # tsc --noEmit
npm run lint       # eslint, zero warnings
npm run build      # static site -> dist/ (SSG)
npm run preview    # preview the production build
```

Deploys to GitHub Pages via `.github/workflows/deploy.yml` on push to `main`.

## Architecture

```
src/
  engine/         Renderer-agnostic 3D engine
    math/         vec3 / mat4 / quat / easing / rng / raycast
    shaders/      WGSL (WebGPU) shaders, imported with ?raw
    WebGPURenderer.ts   Primary: HDR scene pass + composite (bloom/tonemap/CA)
    WebGL2Renderer.ts   Lower-fidelity fallback, inline GLSL
    Scene.ts      Procedural planet models (radius from tenure, seeded POIs)
    Camera.ts     Single-axis dolly camera + fly-in cinematic
    InputController.ts  wheel / pointer / touch / keyboard -> intents
    QualityManager.ts   Quality presets + runtime perf probe
    Engine.ts     Owns state + RAF loop; exposes a useSyncExternalStore store
  content/        Company data (TS) validated by a zod schema
  ui/             React overlay: nav, ruler, ribbon, POI modal, settings, HUD
  routes/         Landing (CSR canvas) + /about /contact /blog (SSG)
```

The engine owns all per-frame state and never re-renders React on every frame.
React subscribes to a small immutable snapshot via `useSyncExternalStore`, so
the UI only updates on meaningful changes (focused planet, open POI, settings,
stats).

### Backends & quality

WebGPU is used when available (two-step adapter+device probe); otherwise the app
falls back to WebGL2. On WebGPU, an initial ~4s frame-time probe selects a
quality tier (`ultra`/`high`/`med`/`low`). Users can override quality, motion,
sound, and a debug HUD from the settings panel; preferences persist in
`localStorage`.

### Accessibility & SEO

- A semantic, crawlable résumé (`ui/ResumeContent.tsx`) mirrors all scene
  content. It's visually hidden on screen but exposed to search engines, screen
  readers, and **printing** (print styles hide the canvas and show the résumé).
- `prefers-reduced-motion` disables the cinematic and ambient spin.
- The POI modal traps focus, restores it on close, and closes on
  Esc / click-outside / ✕.
- POIs are deep-linkable via `#/{company}/{poi}`.

## Notable implementation decisions

These pragmatic choices favor a reliable, buildable site and are worth knowing
before extending it:

1. **Hand-authored shaders** in WGSL (primary) and GLSL (fallback) rather than
   transpiling one source to both. A GLSL→WGSL transpile pipeline is possible
   future work.
2. **Content as typed TS validated by zod** (`src/content/`) rather than MDX
   frontmatter. The MDX Vite plugin is still wired up for future long-form pages.
3. **GPU code is verified at build/type time only.** Runtime rendering requires
   a real GPU and has not been exercised in CI; test in a browser when iterating
   on shaders or the render graph.

## ⚠️ Placeholder content

Company **dates, roles, summaries, and POI copy** in
`src/content/companies.ts` are best-effort placeholders pending confirmation.
Planet size derives from tenure and POI placement is seed-derived, so editing
dates/seeds deterministically restyles the scene. The contact email in
`src/ui/strings.ts` is also a placeholder.
