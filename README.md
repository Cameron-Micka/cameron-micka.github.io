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
    WebGL2Renderer.ts   Matching HDR/composite path with an RGBA8 fallback
    Scene.ts      Procedural planet models (radius from tenure, seeded POIs)
    Camera.ts     Single-axis dolly camera + fly-in cinematic
    InputController.ts  wheel / pointer / touch / keyboard -> intents
    QualityManager.ts   Quality presets + Auto quality ramp
    Engine.ts     Owns state + RAF loop; exposes a useSyncExternalStore store
  content/        Company + photo data (TS) validated by a zod schema
  ui/             React overlay: nav, ruler, ribbon, POI modal, settings, HUD
  routes/         Landing (CSR canvas) + /about /blog /photography (SSG)
```

The engine owns all per-frame state and never re-renders React on every frame.
React subscribes to a small immutable snapshot via `useSyncExternalStore`, so
the UI only updates on meaningful changes (focused planet, open POI, settings,
stats).

### Free camera

Use the compass button to enter free camera. On desktop, WASD flies, Shift
boosts, and Space slows movement. Click and drag a planet or the sun to move
it across the view; drag empty space (or right-drag anywhere) to look around.
Planet moons, satellites, and the flight path follow the moved planet.
Leaving free camera restores the original scene layout for timeline navigation.
On touch screens, drag a planet or the sun to move it. Drag empty space on
the left half to fly or the right half to look; these two camera gestures can
run simultaneously.

### Moon launching

Moons mix dry, cratered rock with ocean worlds featuring turquoise coastlines
and blue-white polar ice caps. Each moon has a stable, individual terrain seed;
water and ice cover crater relief in both rendering backends.

Click or tap a moon to knock it out of orbit, away from the camera along the
tap's direction. Flying moons bounce off planets and other moons, and are
destroyed on contact with the sun. Tap one again to redirect it.
This works in both timeline and free-camera modes. Detached moons no longer
follow their parent planet or its visibility; reload the page to restore them.
Paused motion and open POI dialogs also pause moon flight.

### Backends & quality

WebGPU is used when available (two-step adapter+device probe); otherwise the app
falls back to WebGL2. On WebGPU, Auto quality starts at the `low` tier and ramps
up one tier at a time (`low` → `med` → `high`) whenever frame time stays good and
stable for 3+ seconds. Users can override quality, motion,
sound, and a debug HUD from the settings panel; preferences persist in
`localStorage`.

WebGL2 uses the same linear HDR composition, ACES tone mapping, gamma encoding,
bloom, lens effects, vignette, and modal blur as WebGPU when
`EXT_color_buffer_float` is available. Its fixed preset uses Medium-style
sky/cloud shading, shadows, and chromatic aberration, with the sky at 35% and
post-effects at 50% of CSS resolution. MSAA uses the highest common color/depth
sample count up to 4; devices without float MSAA use a single-sample HDR target.
If float targets are unavailable or incomplete, rendering falls back to RGBA8
with per-material tone mapping, which cannot preserve the same HDR highlights.

Both backends use single-scattering atmospheres with exponential Rayleigh/Mie
density profiles and wavelength-dependent Beer-Lambert attenuation on both
paths. WebGPU Medium/High and WebGL2 use 16 view samples and 8 sunlight samples.
WebGPU Low uses 8 view samples and a cached sunlight optical-depth lookup
instead of tracing a sunlight ray at every sample. The 128x64 RG32F texture
costs 64 KB, is generated once per renderer with 64 integration samples per
texel, and is reused across planets, frames, and quality changes. Its coordinates
concentrate precision near the ground and sunlight horizon.

The planet blocks sunlight
geometrically, and other bodies can eclipse the haze. Density reaches zero at
the shell boundary to avoid a hard outer edge. Coefficients use shell-thickness
units so planets of different sizes share the same optical properties. This
remains an additive in-scattering pass; it does not attenuate the underlying
surface/background or model multiple scattering.

Both surface shaders also skip polar-ice noise outside the mathematically
possible ice region, avoiding work on large equatorial areas without changing
terrain detail or render resolution.

### Accessibility & SEO

- A semantic, crawlable résumé (`ui/ResumeContent.tsx`) mirrors all scene
  content. It's visually hidden on screen but exposed to search engines, screen
  readers, and **printing** (print styles hide the canvas and show the résumé).
- `prefers-reduced-motion` (and the Paused motion setting) freezes the scene
  clock, so the cinematic is skipped and all idle animation stands still.
- The POI modal traps focus, restores it on close, and closes on
  Esc / click-outside / ✕. The photo lightbox follows the same pattern and
  adds ← / → paging within the active gallery section.
- POIs are deep-linkable via `#/{company}/{poi}`.

## Photography assets

The `/photography` gallery reads `src/content/photos.ts`, a zod-validated
manifest. Image files are committed to this repo and served straight from
GitHub Pages out of `public/`:

```
public/photos/<category>/<id>.webp          full size, ~2000px long edge
public/photos/<category>/thumbs/<id>.webp   grid thumbnail, ~600px long edge
```

`<category>` is `nature` or `automotive`; `<id>` is a url-safe slug
(`a-z`, `0-9`, `-`) and doubles as the manifest `id`.

**Export recipe** — commit web derivatives only, never RAWs or camera-original
JPEGs; git keeps every version of a binary forever.

1. Resize so the long edge is 2000px (full) and 600px (thumb). Keep the
   aspect ratio; the grid crops to 3:2 for layout only.
2. Encode as WebP at quality ~80 (full) and ~75 (thumb). Add a JPEG next to it
   only if you need a fallback for a specific target.
3. Strip metadata, including EXIF GPS.

With ImageMagick:

```bash
magick input.jpg -auto-orient -resize 2000x2000\> -strip -quality 80 \
  public/photos/nature/<id>.webp
magick input.jpg -auto-orient -resize 600x600\> -strip -quality 75 \
  public/photos/nature/thumbs/<id>.webp
```

Then add an entry to `src/content/photos.ts` with the id, category, both
paths (relative to `public/`, no leading slash), the **full-size** intrinsic
`width`/`height` in pixels, and descriptive `alt` text. The dimensions let the
grid reserve space so nothing shifts as images load, so they must be accurate.

Keep the site comfortably under GitHub Pages' ~1 GB soft limit. If the gallery
ever outgrows that, move the files to an external object store/CDN and change
the manifest paths to absolute URLs — nothing else needs to change. Do not use
Git LFS: Pages does not resolve LFS pointers, so the images would 404.

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
