# Cameron Micka — Portfolio 🌌

My career as a real-time 3D "Time Machine": each **planet** is a place I've
worked, and each glowing **point of interest** opens a story. About, Writing,
and Photography pages are statically rendered and work without a GPU.

**Stack:** TypeScript · React 18 · Vite · custom engine with WebGPU (WGSL) and
WebGL2 (GLSL) backends · `vite-react-ssg` · zod-validated content.

## Quick start

```bash
npm install
npm run dev        # local dev server at http://localhost:5173
```

| Command             | What it does                                |
| ------------------- | ------------------------------------------- |
| `npm run typecheck` | TypeScript check                            |
| `npm run lint`      | ESLint, zero warnings allowed               |
| `npm test`          | Node test suite (assets, rendering, scenes) |
| `npm run build`     | Static site → `dist/`                       |
| `npm run preview`   | Serve the production build                  |

> Typecheck and build do **not** compile shaders. After changing anything in
> `src/engine/`, check both renderers in a browser (Settings → Renderer).

## Project layout

```
src/
  engine/    3D engine: scene, camera, input, quality, WebGPU + WebGL2 renderers
    shaders/ WGSL shaders (most WebGL2 GLSL is inline in WebGL2Renderer.ts)
    gltf/    Static GLB model loader and renderers
  content/   Companies, stories, and photos (TypeScript + zod)
  ui/        React overlay: nav, ribbon, dialogs, settings, HUD
  routes/    Static pages and the lazy-loaded 3D landing page
public/      Static assets: models, photos, og.jpg, robots.txt, sitemap.xml
scripts/     Asset builders and tests
tools/       Standalone GLB model preview
docs/        Detailed documentation (see below)
```

## Common tasks

**Edit career content** — `src/content/companies.ts`. Planet size comes from
tenure and POI placement from the seed, so changing either restyles the scene.
Link stories to each other with `[label](#/company/poi)`.

**Add photos** — drop images into `public/photos/nature/` or
`public/photos/automotive/`, run `npm run photos:build`, then add a description
in `src/content/photos.ts`. See [docs/photography.md](docs/photography.md).

**Add an orbiting model to a planet** — set `features.ringWorld` or
`features.spaceStation` on a company in `companies.ts`.

**Build or preview 3D models**

```bash
npm run models:build                # regenerate the broken ring GLB
npm run models:death-star           # regenerate the space-station GLB
npm run models:preview              # preview the ring in the browser
npm run models:preview:death-star   # preview the station
```

To create a new model with Copilot, use `/create-3d-model` in Copilot Chat
([skill](.github/skills/create-3d-model/SKILL.md)).

**Take a 1080p screenshot** — press **Ctrl+Alt+Shift+S** on desktop, then press
it again (or **Capture**) to save a PNG.

## Deployment

GitHub Actions ([deploy.yml](.github/workflows/deploy.yml)) runs typecheck,
lint, tests, and the build on every pull request and push to `main`. Only
`main` (or a manual run) deploys to GitHub Pages. If the domain changes, update
`SITE.url` (in `src/ui/strings.ts`), `public/robots.txt`, and `public/sitemap.xml`.

## Documentation

| Doc                                     | Covers                                                        |
| --------------------------------------- | ------------------------------------------------------------- |
| [Architecture](docs/architecture.md)    | Source layout, engine/React boundary, design decisions        |
| [Features & controls](docs/features.md) | Navigation, free camera, moons, screenshots, accessibility    |
| [Rendering](docs/rendering.md)          | Backend selection, quality tiers, HDR, atmospheres, perf data |
| [3D models](docs/3d-models.md)          | Orbiting models, Copilot skill, asset budgets and history     |
| [GLB rendering](docs/gltf.md)           | glTF subset, renderer adapter API                             |
| [Photography](docs/photography.md)      | Photo export recipe and batch converter                       |
| [Testing](docs/testing.md)              | CI pipeline and manual browser checklist                      |
| [Original spec](SPEC.md)                | Historical design intent (not maintained)                     |
