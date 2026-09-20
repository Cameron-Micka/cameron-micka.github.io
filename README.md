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
npm test           # node --test: photo pipeline and renderer resize checks
npm run build      # static site -> dist/ (SSG)
npm run preview    # preview the production build
```

`.github/workflows/deploy.yml` runs typecheck, lint, tests, and the production
build on every pull request and on pushes to `main`. Only `main` (and a manual
dispatch) deploys to GitHub Pages: pull-request runs never receive the
`pages`/`id-token` scopes and cannot publish.
Deployment jobs are serialized separately from pull-request builds.

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

### Finding the work

The landing introduction explains the experience and provides an explicit
**Explore the work** action. The lower readout also shows the current chapter's
story count. A native project picker in the story dialog exposes every project
without requiring a precise click on a 3D marker.

The timeline reads newest to oldest: scroll down or press **Down** for earlier
work; scroll up or press **Up** to return toward the present. **Home / Page Up**
go to the current role, and **End / Page Down** go to the earliest chapter.
These shortcuts do not intercept links, form controls, editable content, or
dialogs. On touch screens, use the ribbon arrows or a two-finger drag to travel.

The scroll/drag/tap hint disappears after the first scene interaction, chapter
button activation, or story opening. It stays dismissed across client-side
navigation until the page is reloaded.

The About page provides a conventional, newest-first career summary and direct
links to every story. Sound effects are opt-in in Settings and never start
before a user gesture.

### Free camera

Use the camera button to enter free camera. On desktop, WASD flies, Shift
boosts, and Space slows movement. Click and drag a planet or the sun to move
it across the view; drag empty space (or right-drag anywhere) to look around.
Entering free camera preserves the current viewing direction and position,
including portrait layouts and zoomed views.
Planet moons, satellites, and the flight path follow the moved planet.
Leaving free camera restores the original scene layout for timeline navigation.
On touch screens, drag a planet or the sun to move it. Drag empty space on
the left half to fly or the right half to look; these two camera gestures can
run simultaneously.

Planet drags mark the flight path dirty; its geometry is rebuilt at most once
per rendered frame, and only when the flight-path setting is enabled.

Body-selection outlines reuse 128 cached circle samples and scalar projection,
avoiding 512 temporary vectors and 256 trigonometric calls per computed outline
without changing its shape or six-pixel clearance.

### Moon launching

Moons have rocky surfaces with optional blue-white polar ice caps and no liquid
water. Each moon has a stable, individual terrain seed; ice covers crater relief
in both rendering backends.
A seeded subset also has thin, palette-tinted scattering atmospheres and no
meteor craters in either backend. These shells fade with orbiting moons and stay
attached during flight.

Click or tap a moon to knock it out of orbit, away from the camera along the
tap's direction. Flying moons bounce off planets and other moons, and are
destroyed on contact with the sun. Tap one again to redirect it.
This works in both timeline and free-camera modes. Detached moons no longer
follow their parent planet or its visibility; reload the page to restore them.
Paused motion and open POI dialogs also pause moon flight.

### Backends & quality

Auto renderer uses WebGL2 on iOS/iPadOS and macOS. On other platforms, WebGPU is
used when available (two-step adapter+device probe); otherwise the app falls
back to WebGL2. Users can explicitly select WebGPU or WebGL in settings on any
platform. WebGL runs without a compatibility notice.
On both backends, Auto quality starts at `low` and ramps up one tier at a time
(`low` -> `med` -> `high`) after 3+ seconds of stable frames at or below 18 ms.
It steps down when average frame time reaches 20 ms over a 1.5-second window,
and does not retry an unsustainable tier until Auto restarts. Desktop and
mobile/coarse-pointer devices use the same performance-based ramp. Explicit
quality choices are never overridden; preferences persist in `localStorage`.
The initial output size uses the chosen tier immediately, rather than allocating
a High-DPR canvas and resizing it down at startup.
Render targets are allocated once the first frame's dimensions and quality are
known. At 1440x900 Low, WebGL2 startup uses 3 textures, 1 renderbuffer, and 3
framebuffers (previously 5, 5, and 7); WebGPU uses 6 textures (previously 16).
These counts include the atmosphere lookup texture. Identical resize
notifications neither reset the canvas nor reallocate targets.
Resize notifications queue the new output dimensions. The backing buffer is
resized only inside the next drawing frame, so live window resizing cannot
clear the last image between drawing and presentation. Both backends preserve
the previous frame until its replacement is drawn.

Paused motion renders on demand: once the camera settles, an unchanged scene
does not rebuild instances or submit GPU work. Dragging, travel, resizing,
quality changes, and other visual settings still invalidate the frame. The
Auto ramp samples animated frames only, so idle time cannot promote quality.
Motion is controlled with the pause/resume button beside the camera control,
not in Settings. By default, motion follows OS reduced-motion preferences and
responds to changes without a reload.

| Tier | DPR cap | Stars | Scene resolution | MSAA | Sky resolution |
| ---- | ------- | ----- | ---------------- | ---- | -------------- |
| High | 2 | 10,000 | 100% | 4x | 40% of CSS pixels |
| Medium | 1.25 | 2,000 | 100% | 4x | 35% of CSS pixels |
| Low | 1 | 800 | 85% | Off | 30% of CSS pixels |

Presentation stays at the output resolution. Both backends share sphere LODs,
star/satellite billboards, cloud detail, and atmosphere sampling. Low retains
clouds and atmospheres but skips inter-body shadows and post-effects. Its sky
updates at 30 Hz while the camera is stationary and immediately when it moves.
Medium and High run bloom, lens effects, and modal blur at 50% of CSS resolution;
High also enables flow-field terrain and more detailed cloud self-shadowing.

WebGL2 uses the same linear HDR composition, ACES tone mapping, gamma encoding,
bloom, lens effects, vignette, and modal blur as WebGPU when
`EXT_color_buffer_float` is available. It prefers packed `R11F_G11F_B10F`, matching
WebGPU's optional `rg11b10ufloat` format, with a validated `RGBA16F` fallback.
Medium/High MSAA uses the highest common color/depth sample count up to 4;
devices without float MSAA use a single-sample HDR target. Low renders directly
into its scene texture without an MSAA resolve. If HDR targets are unavailable
or incomplete, rendering falls back to RGBA8 with per-material tone mapping,
which cannot preserve the same HDR highlights.

Both backends use single-scattering atmospheres with exponential Rayleigh/Mie
density profiles and wavelength-dependent Beer-Lambert attenuation on both
paths. Medium/High use 16 view samples and 8 sunlight samples on both backends.
Low uses 8 view samples and a cached sunlight optical-depth lookup
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
Dry planets and moons skip ocean-glitter calculations behind a uniform ocean
flag, keeping screen-space derivatives valid. Ordinary specular lighting and
the wet-surface calculations are unchanged.

Local performance check (2026-09-18, Apple M1, Chromium/ANGLE Metal, DPR 1):

| Frozen scene | Original fixed WebGL | WebGL Low | WebGPU Low |
| ------------ | -------------------- | --------- | ---------- |
| 1440x900 timeline | 17.1 ms | 6.1 ms | 4.3 ms |
| 3840x2160 timeline | 75.0 ms | ~23 ms | 17.0 ms |
| 3840x2160 close-up | 109.7 ms | 37.2 ms | 27.2 ms |

Means include submission and a one-pixel GPU readback, with 30 measured frames
after 8 warm-up frames. Camera and scene state are identical across backends;
only the animation clock advances. The original fixed preset is Medium-like,
not equivalent to Low. Updated WebGL Medium/High measured 16.2/20.0 ms at
1440x900. These are local frame-cost measurements, not a 60 FPS guarantee;
4K close-ups remain expensive even on Low. Validate shaders in a GPU-capable
browser when changing either renderer, including tier switches and HDR fallbacks.

Frozen-frame checks across all tiers covered the timeline, close-ups, night
lighting, sun, rings, portrait layout, CRT, modal blur, and flight paths. The
27 normal-rendering comparisons averaged below 0.05 per color channel on the
0-255 scale when both backends used packed HDR. Native MSAA line coverage still
differs slightly in debug wireframe mode; disabling MSAA closely matches it.

### Accessibility & SEO

- The landing page prerenders a readable, semantic résumé from the same
  company data. It remains usable without JavaScript or a working GPU. A GPU
  startup failure shows this content with a reload action and collapsible
  diagnostics, rather than blocking the entire portfolio.
- During the interactive experience, the duplicate résumé is print-only:
  it cannot create invisible keyboard stops or duplicate screen-reader content.
  Printing hides the canvas and controls and exposes the complete résumé.
- Every route has a main landmark and a visible-on-focus skip link. Route
  changes reset scroll/focus unless navigating to a section anchor.
- Settings controls have 44px hit targets. Short touch-landscape layouts use
  the larger ribbon controls rather than squeezing in the side ruler.
- `prefers-reduced-motion` and Paused motion freeze idle scene animation, skip
  the fly-in, and disable dialog entrance effects. Direct interaction remains
  available. Important company labels no longer animate or glitch.
- Story and photo viewers use native modal dialogs for background inertness,
  focus containment, and focus restoration. Esc / backdrop / Close dismiss
  them; the lightbox adds ← / → paging and native touch swiping.
- All current photos have image-specific descriptions. The lightbox displays
  the caption, or the description when no separate caption is authored. Gallery
  tiles are real image links, so opening the original in a new tab or viewing it
  without JavaScript still works.
- POIs are deep-linkable via `#/{company}/{poi}`. Hash updates preserve router
  history state; malformed links cannot crash or freeze the experience.
- Every prerendered route has its own title, description, canonical URL, and
  absolute social-image URL. `public/robots.txt` and `public/sitemap.xml` cover
  the public routes. The generated `404.html` is a real not-found page, not a
  redirect loop.
  If the domain changes, update `SITE.url`, the robots file, and the sitemap.
- `public/og.svg` is the editable source for the 1200×630 social card. Regenerate
  the committed PNG after editing it:

  ```bash
  node --input-type=module -e "import sharp from 'sharp'; await sharp('public/og.svg').png().toFile('public/og.png')"
  ```

### Browser checks

In addition to typecheck, lint, and the production build, exercise:

- Desktop, 320px/390px portrait, and short landscape layouts; no horizontal
  overflow, obscured actions, or inaccessible settings controls.
- Continuous window resizing with motion running, paused, and a story open;
  no black frames during resizing, including when crossing layout breakpoints.
- Wheel, keyboard, ribbon, and ruler navigation in both directions; form
  controls and dialog scrolling must not also move the timeline.
- Interaction-hint dismissal through wheel, mouse/pen, touch, keyboard,
  chapter buttons, and story opening; it stays hidden after closing a dialog
  or returning from another route, and reappears on a fresh page load.
- Direct story links, project switching, expansion, Esc, Tab wrapping, and
  return focus in both viewers.
- Live system-motion changes, paused interaction, quality switches, and both
  rendering backends. A settled paused scene should submit **zero GPU draws**.
- Auto quality can reach Medium/High on both fine- and coarse-pointer devices
  when frame times permit; manual tiers stay selected, and switching back to
  Auto restarts the ramp at Low.
- Navigation away while shaders initialize; renderer failure and JavaScript
  disabled; prerendered metadata and printing.

A local 1440×900 WebGL2 check counted 7,950 indexed draw calls over two seconds
with motion paused before on-demand rendering, and zero after. This measures
eliminated idle submissions, not an improvement to the cost of an animated frame.

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
4. Add a faint `Cameron Micka` watermark at the bottom left.

Place source images directly in `public/photos/nature/` or
`public/photos/automotive/`, then preview and run the batch converter:

```bash
npm run photos:build -- --dry-run
npm run photos:build
```

The converter preserves the source files, auto-orients and converts them to
sRGB, strips metadata, creates both derivatives, and turns camera filenames
into URL-safe ids (`IMG_298_No_Wires.jpeg` becomes
`img-298-no-wires.webp`). It also refreshes
`src/content/photos.generated.ts` with the paths and full-size intrinsic
dimensions used by the gallery. Source JPEG, PNG, TIFF, and HEIF files in
those folders are ignored by git. To use different watermark text, pass
`--name "Your Name"`; to rebuild only the manifest, pass `--manifest-only`.

`--manifest-only` reads the committed WebP derivatives rather than the ignored
originals, so it works in a fresh checkout. It verifies that each full-size
file has a matching thumbnail and that both are readable WebPs within their
size limits, then rewrites the manifest. Both modes order the manifest by the
generated `photos/<category>/<id>.webp` path, so a full conversion and a
manifest-only refresh always produce the same file. `npm test` covers this.

New generated entries receive a category-based fallback description. Add an
image-specific description to `photoDetails` in `src/content/photos.ts` before
publishing new photos; captions and locations are optional. These authored
details survive future batch conversions.

Keep the site comfortably under GitHub Pages' ~1 GB soft limit. If the gallery
ever outgrows that, the files can move to an external object store/CDN, but the
manifest paths are not currently portable: `assetUrl()` in
`src/content/schema.ts` joins them onto `BASE_URL`, so it would need to pass
absolute URLs through untouched, and `scripts/build-photos.mjs` would need to
emit them. Do not use Git LFS: Pages does not resolve LFS pointers, so the
images would 404.

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

## ⚠️ Placeholder content

Company **dates, roles, summaries, and POI copy** in
`src/content/companies.ts` are best-effort placeholders pending confirmation.
Planet size derives from tenure and POI placement is seed-derived, so editing
dates/seeds deterministically restyles the scene. Verify career claims and
project descriptions before publishing; the UX polish does not validate them.
