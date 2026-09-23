# Cameron Micka — Portfolio 🌌

A personal portfolio built as a real-time 3D experience: the landing page is a
GPU-rendered "Time Machine" of my career, where each **planet** is a place I've
worked and each glowing **point of interest** opens a story. The UI is React;
the rendering is a hand-written engine with matching **WebGPU** and **WebGL2**
backends. About, Writing, Photography, not-found, and fallback résumé views are
statically rendered for fast loading and graceful degradation.

**Stack:** TypeScript · React 18 · Vite · WebGPU (WGSL) + WebGL2 (GLSL ES 3.0)
· `vite-react-ssg` for static pages · zod-validated content.

## 🛠️ Develop

```bash
npm install
npm run dev        # local dev server
npm run typecheck  # tsc --noEmit
npm run lint       # eslint, zero warnings
npm test           # node --test: assets, rendering, and scene interactions
npm run build      # static site -> dist/ (SSG)
npm run preview    # preview the production build
```

`.github/workflows/deploy.yml` runs typecheck, lint, tests, and the production
build on every pull request and on pushes to `main`. Only `main` (and a manual
dispatch) deploys to GitHub Pages: pull-request runs never receive the
`pages`/`id-token` scopes and cannot publish.
Deployment jobs are serialized separately from pull-request builds.

## Copilot skills

### Create a 3D model

The repository skill [create-3d-model](.github/skills/create-3d-model/SKILL.md)
creates optimized, reference-based 3D models for realtime rendering on this site.
Open this repository in VS Code, attach reference images or describe the subject
in Copilot Chat, and invoke:

```text
/create-3d-model Make a weathered sci-fi satellite from these references.
```

The workflow includes:

- **Five rendered iterations**, each with a visual critique and implemented
  improvements.
- **PBR materials** and a self-contained **GLB** with embedded textures.
- An **interactive preview**, close-up inspection, and a five-pass comparison.
- Measured triangle, draw-call, download, and texture-memory budgets, plus GLB
  validation and reproducible generation instructions.

The skill adapts to the requested subject and keeps live-scene integration
separate unless requested. See the [broken space-ring asset](#broken-space-ring-asset)
for a completed example.

## 🧭 Architecture

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

### Finding the work

On roomy viewports, the landing introduction explains the experience and
provides an explicit **Explore the work** action. Narrow screens (720px and
below) and short landscape windows hide that introduction so the canvas and
controls have room; the lower readout remains the primary chapter and story
entry point.

The POI dialog is a scrollable, snap-aligned feed of every story across the
career timeline. Its native project picker opens any story without requiring a
precise click on a 3D marker. The picker's visible "Jump to a story" label is
hidden at narrow widths, while its accessible name remains available.

The timeline reads newest to oldest: scroll down or press **Down** to move
toward older work; scroll up or press **Up** to return toward the present.
**Home / Page Up** go to the current role, and **End / Page Down** go to the
earliest chapter.
These shortcuts do not intercept links, form controls, editable content, or
dialogs. On touch screens, use the ribbon arrows or a two-finger drag to travel.

Drag a planet to rotate it; faster swipes carry more momentum and coast farther
after release. Grab again or hold still before releasing to stop the spin.
Reduced motion keeps direct rotation available without the coast.

The scroll/drag/tap hint disappears after the first scene interaction, chapter
button activation, or story opening. It stays dismissed across client-side
navigation until the page is reloaded.

The About page provides a conventional, newest-first career summary and direct
links to every story. Writing is currently a coming-soon page, and Photography
provides separate Nature and Automotive galleries with a native lightbox.
Sound effects are opt-in in Settings and never start before a user gesture.

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

### Orbiting ring worlds

Set `features.ringWorld: true` on a company in
[companies.ts](src/content/companies.ts) to add the
[broken-ring GLB](public/models/broken-ring.glb) as an orbiting companion.
The flag defaults to `false`; **Microsoft has it enabled**. It is separate from
the existing `rings` flag and does not replace or change the planet's moons.

The ring follows a deterministic, tilted orbit outside the planet's moons.
It uses the moon clock, follows parent translations/rotations (including
free-camera planet drags), shrinks with timeline visibility, and pauses with
motion and story dialogs. It is decorative, not a launchable moon. Its own
debris-inclusive bounds are frustum-culled independently of the planet.

Both backends draw it into the existing scene depth/HDR pass with the scene's
light direction and distance fog. The WebGL LDR fallback tonemaps it before
the host's final gamma encode. Each visible ring adds **two draw calls and
13,264 triangles**. Geometry and textures are uploaded once and shared across
all enabled planets, adding approximately **19.7 MiB** of GPU buffers/textures.
WebGPU prewarms both 1x and 4x sample-count variants, so quality changes do not
reload the GLB or duplicate its texture allocation. The debug HUD includes
these draws, triangles, and allocations.

The loader runs only when at least one company enables the flag; asset failures
use the existing startup error/fallback UI rather than silently omitting the
ring. [OrbitingModels.ts](src/engine/OrbitingModels.ts) owns the orbital
appearance and shared draw instances for GLB companions.

### Orbiting space stations

Set `features.spaceStation: true` on a company in
[companies.ts](src/content/companies.ts) to add the
[Death Star GLB](public/models/death-star-ii.glb) as an orbiting model moon.
The flag defaults to `false`; **LucasArts has it enabled**.
It is independent of `rings`, `ringWorld`, and the procedural moon count.
The station stays in orbit and is not launchable.

Stations use the same paused moon clock, parent transforms, timeline visibility,
independent frustum culling, scene lighting, and fog as ring worlds. Each follows
a deterministic tilted orbit outside the regular moons; when both GLB flags are
enabled on one planet, the station also orbits outside its ring-world companion.
Existing moon, satellite, terrain, and POI seeds are unchanged.

Both native backends share one copy of the station's geometry and textures across
enabled planets. Each visible station adds **two draw calls and 14,902 triangles**,
included in the debug HUD. WebGPU prewarms 1x/4x sample-count variants.
The model is loaded only when enabled, and load failures use the existing
startup error/fallback UI rather than silently omitting it.

Both companions share the planets' depth convention, so nearer planets and
moons occlude them in solid and wireframe views. WebGL converts the shared
`[0, 1]` projection to `[-1, 1]` before procedural draws; the glTF renderer
already performs that conversion in its vertex shader.

### ⚙️ Backends & quality

Auto renderer uses WebGL2 on iOS/iPadOS and macOS. On other platforms, WebGPU is
used when available (two-step adapter+device probe); otherwise the app falls
back to WebGL2. Users can explicitly select WebGPU or WebGL in settings on any
platform. WebGL runs without a compatibility notice.
On both backends, Auto quality starts at `med`, ramps up to `high` after 3+
seconds of stable frames at or below 18 ms, and steps down when average frame
time reaches 20 ms over a 1.5-second window. It does not retry an unsustainable
tier until Auto restarts. Desktop and mobile/coarse-pointer devices use the same
performance-based adjustment. Explicit quality choices are never overridden.
Quality, renderer, motion, sound, CRT, and debug preferences persist in
`localStorage`; wireframe, flight path, and free-camera mode reset each session.
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

| Tier   | DPR cap | Stars  | Scene resolution | MSAA | Sky resolution    |
| ------ | ------- | ------ | ---------------- | ---- | ----------------- |
| High   | 2       | 10,000 | 100%             | 4x   | 40% of CSS pixels |
| Medium | 1.25    | 2,000  | 100%             | 4x   | 35% of CSS pixels |
| Low    | 1       | 800    | 85%              | Off  | 30% of CSS pixels |

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

| Frozen scene       | Original fixed WebGL | WebGL Low | WebGPU Low |
| ------------------ | -------------------- | --------- | ---------- |
| 1440x900 timeline  | 17.1 ms              | 6.1 ms    | 4.3 ms     |
| 3840x2160 timeline | 75.0 ms              | ~23 ms    | 17.0 ms    |
| 3840x2160 close-up | 109.7 ms             | 37.2 ms   | 27.2 ms    |

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

### ♿ Accessibility & SEO

- The landing page prerenders a readable, semantic résumé from the same
  company data. It remains usable without JavaScript or a working GPU. A GPU
  startup failure shows this content with a reload action and collapsible
  diagnostics, rather than blocking the entire portfolio.
- During the interactive experience, the duplicate résumé is print-only:
  it cannot create invisible keyboard stops or duplicate screen-reader content.
  Printing hides the canvas and controls and exposes the complete résumé.
- Every route has a main landmark and a visible-on-focus skip link. Route
  changes reset scroll/focus unless navigating to a section anchor.
- Settings controls have 44px hit targets. Narrow layouts hide the side ruler
  and landing introduction. Short landscape layouts also move Pause and Free
  Camera to the upper left; touch layouts retain the larger ribbon controls.
- `prefers-reduced-motion` and Paused motion freeze idle scene animation, skip
  the fly-in, and disable dialog entrance effects. Direct interaction remains
  available. Important company labels no longer animate or glitch.
- Story and photo viewers use native modal dialogs for background inertness,
  focus containment, and focus restoration. Esc / backdrop / Close dismiss
  them; the story selector remains accessibly named when its visible narrow-
  screen label is hidden, and the lightbox adds ← / → paging and native touch
  swiping.
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
  Auto restarts adaptive quality at Medium.
- Navigation away while shaders initialize; renderer failure and JavaScript
  disabled; prerendered metadata and printing.

A local 1440×900 WebGL2 check counted 7,950 indexed draw calls over two seconds
with motion paused before on-demand rendering, and zero after. This measures
eliminated idle submissions, not an improvement to the cost of an animated frame.

## Native GLB rendering

[src/engine/gltf/](src/engine/gltf/) is a small, dependency-free static-model
rendering module shared by the local asset preview and the site's ring worlds.
It does not introduce a scene framework or replace the timeline's renderer.
The model generator also uses its [mesh helpers](src/engine/gltf/mesh.mjs) for
normals, tangent frames, and bounds, without a browser or GPU dependency.

### Supported glTF subset

The [loader](src/engine/gltf/loader.ts) exposes `loadGlb(url, options)` for fetched
assets and `parseGlb(bytes, options)` for in-memory GLB 2.0 files. It validates
resource bounds and references and produces one renderer-independent asset:

- Scene selection, node hierarchy, matrix/TRS transforms, shared meshes, and
  nonuniform or negative scales.
- Indexed and non-indexed triangles, triangle strips/fans, 8/16/32-bit indices,
  interleaved accessors, sparse accessors, normalized UV/color attributes, and
  vertex colors. Missing normals are generated as flat face normals; missing
  tangents are generated from the normal map's UV set.
- Core metallic-roughness PBR: base color, metallic/roughness, normal, occlusion,
  and emissive maps/factors; UV0 or UV1 per map; opaque, alpha-mask, and alpha-blend
  materials; double-sided surfaces.
- Embedded, data-URI, or relative external PNG/JPEG images and buffers, with
  core wrap/filter/mipmap samplers. `loadGlb` accepts an `AbortSignal`; `parseGlb`
  accepts a URI-to-bytes resource map for external resources.

This is deliberately **not a full glTF scene engine**. It rejects animations,
skinning, morph targets, points/lines, texture-coordinate sets beyond UV1, and
singular transforms. It loads GLB containers, not standalone JSON `.gltf` files.
Required extensions are rejected; optional extensions are ignored with explicit
warnings and only their core fallback is used. There are no compression decoders,
extension-based materials/lights, or imported-camera controls.

### Host-renderer integration

The two adapters consume the same [asset and frame types](src/engine/gltf/types.ts):

```ts
import { loadGlb } from './gltf/loader';
import { WebGL2GltfRenderer } from './gltf/WebGL2GltfRenderer';
import { WebGPUGltfRenderer } from './gltf/WebGPUGltfRenderer';

const asset = await loadGlb('/models/broken-ring.glb');

// WebGL2: bind the host framebuffer and viewport before rendering.
const glModel = await WebGL2GltfRenderer.create(gl, asset);
glModel.render(frame);

// WebGPU: use the host device, target formats, MSAA count, and open render pass.
const gpuModel = await WebGPUGltfRenderer.create(device, asset, {
  colorFormat: 'rgba16float',
  depthFormat: 'depth24plus',
  sampleCount: 4,
  sampleCounts: [1, 4], // Prewarm quality changes without duplicate uploads.
});
gpuModel.render(scenePass, frame, currentSampleCount);

// On teardown; these do not destroy the host device or context.
glModel.dispose();
gpuModel.dispose();
```

Choose the appropriate adapter for the active backend; the example shows both
APIs, not a requirement to allocate both. `frame` supplies the view and
view-projection matrices, camera position, optional root model transform, two
directional lights, and sky/ground ambient colors. Both adapters use the site's
WebGPU-style **[0, 1] clip-depth** matrices; the WebGL shader converts clip depth.
Use `output: 'linear'` for the site's HDR scene pass so its existing composite
handles exposure and tonemapping exactly once. Use `output: 'srgb'` and an
exposure value when rendering directly to a preview canvas, or
`output: 'tonemapped'` for linear LDR output when the host still applies gamma.
Optional `frame.fog` supplies a color and exponential-squared distance density.
The WebGPU render call can select any sample count prepared during creation.

The shaders implement GGX metallic-roughness PBR with linear-light shading,
normal mapping, occlusion, and emission. Ambient lighting is a lightweight
hemisphere approximation, **not** prefiltered environment-map IBL. The host owns
shadows, environment integration, culling, scene placement, postprocessing,
frame scheduling, and render-target allocation.

For shader control, edit [gltf.frag.glsl](src/engine/shaders/gltf.frag.glsl)
and [gltf.vert.glsl](src/engine/shaders/gltf.vert.glsl) for WebGL2, and
[gltf.wgsl](src/engine/shaders/gltf.wgsl) for WebGPU. The shared
[uniform packing](src/engine/gltf/rendererShared.ts) is the contract between
CPU materials/lights and both shader implementations. Keep equations and
layouts in sync when adding features; no third-party material system generates
these shaders.

The adapters do not clear the host framebuffer, submit a WebGPU encoder, or
start their own animation loops. They own and dispose only their model GPU
resources; WebGPU initialization submits its own texture-mipmap preparation.
The GL adapter preserves framebuffer, viewport, and scissor, but owns program,
VAO, uniform bindings 0-2, texture/sampler units 0-4, and raster/depth/blend state
during drawing. **Rebind host drawing state after it.** WebGPU similarly changes
pass bindings and pipelines. Submit the encoded pass before calling `render()`
again on the same WebGPU adapter instance, because its uniform buffers are
reused; use separate instances for overlapping independently encoded views.
Geometry and materials are uploaded once; recreate the adapter after editing
them. Lights, camera, the root transform, and each source draw's `transform`
and `visible` fields can change each frame. Define all instance draw slots
before creation, then update them in place to share geometry/textures without
overwriting another instance's WebGPU uniforms.

The [native preview](tools/broken-ring-preview.ts) demonstrates
standalone context creation, frame setup, resizing, backend selection, native
orbit controls, antialiasing, and teardown.
Its standalone production JavaScript totals approximately **77 KiB minified /
29 KiB gzip**, including the loader, controls, and both adapters; only the
selected backend is loaded. Model bytes and textures are separate. The timeline
loads its selected adapter and model when `ringWorld` is enabled; static pages
do not load them.

```bash
node --test scripts/gltf-*.test.mjs scripts/ring-world.test.mjs scripts/build-broken-ring.test.mjs
```

The focused tests cover loader fixtures, mesh math, camera gestures, material
and sampler packing, transform/sorting behavior, and GPU resource failure
cleanup. Real GPU shader compilation and rendering also require browser checks
on both backends; a passing TypeScript check alone does not validate shaders.

## Broken space-ring asset

[broken-ring.glb](public/models/broken-ring.glb) is an original, reference-based
broken ring with a muted blue-gray and sage-green mountainous inner habitat,
a dark graphite mechanical shell, circular inset service panels, scorched
fractures, exposed structural splinters, and detached debris. Geometry and
textures are generated locally; no game meshes or textures are extracted or
downloaded.

The live timeline includes this model orbiting the **Microsoft** planet through
its `ringWorld` feature flag.
The separate [interactive preview](tools/broken-ring.html) uses this repository's
native WebGPU/WebGL2 PBR adapters and shared GLB loader, not Three.js. These
same modules render into the site's existing scene pass; the
preview is a development tool, not a new production route.

```bash
npm run models:build       # regenerate the final GLB and its metrics
npm run models:preview     # open /tools/broken-ring.html in the Vite dev server
node --test scripts/build-broken-ring.test.mjs
```

The VS Code **Preview broken ring** task opens the preview on
`http://127.0.0.1:5174/tools/broken-ring.html`. Reference, silhouette, hull, and
fracture views support orbit/pan/zoom, wireframe, and optional auto-orbit.
Select **WebGL2** or **WebGPU** in the preview to exercise either backend.
The preview otherwise renders on demand and suspends auto-orbit when hidden.
Append `?model=/models/another-model.glb` to preview another static asset;
`&backend=webgpu` selects WebGPU. Non-ring models are framed from their bounds.

### Asset contract and realtime cost

- **13,264 triangles, 12,776 vertices, two draw calls**, one shared PBR material.
  The body and all 206 debris pieces are separate, batched meshes; debris does
  not create a draw call per fragment.
- A self-contained **GLB 2.0**, under **3 MiB**, with four embedded textures:
  a 2048x1024 sRGB base-color JPEG and 1024x512 PNG normal, packed
  occlusion/roughness/metallic, and sRGB emissive maps. ORM channels are
  **R = occlusion, G = roughness, B = metallic**; normals and ORM are linear.
- Approximately **18.7 MiB of texture memory including mipmaps**, plus 0.7 MiB
  of exported geometry, assuming RGBA8 GPU textures. The native adapters use
  about **1.05 MiB of geometry buffers**, including their canonical vertex
  layout and cached wireframe indices. This excludes the host renderer's
  environment, render targets, and framebuffer. Download compression does not
  imply GPU texture compression.
- Opaque, backface-culled geometry; static debris and baked heat, with no
  transparency, particle simulation, animation, skinning, or decoder extensions.
  Use environment lighting, the embedded tangent-space normals, mipmaps, and
  anisotropic filtering for the intended PBR appearance. Bloom is optional,
  not required for the asset to work.
- **+Y up**, ring in the **XY plane**, width along **Z**, origin at the original
  ring center. Radius is 10 model units, band width 2.6, shell thickness 0.24,
  and the surviving arc is about 197.7 degrees. Scale the root node to fit the
  destination scene; include debris in culling bounds.

The deterministic [builder](scripts/build-broken-ring.mjs) enforces final limits
of 15,000 triangles, two draws, 3 MiB on disk, and 20 MiB of mipmapped textures.
Every export runs Khronos glTF validation and rejects errors **and** warnings.
[Metrics](public/models/broken-ring.metrics.json) are generated from the actual
meshes and encoded images. Tests independently parse the committed binary,
check geometry/tangent frames, decode every texture, verify material channels,
and enforce the budgets. Texture regressions also check habitat color coverage
and restrained saturation, dark plating and circular insets, unchanged
body/debris geometry and UVs, and pixel-for-pixel preservation of exterior
colors, normal/ORM maps, and the original fire map. Regeneration checks
encoded textures exactly and permits only float-roundoff differences in tangents.

### Reference texture refresh

The latest surface pass follows the supplied reference's dense, dark hull
paneling and inset circular hardware, with blue water, green lowlands, rocky
coasts, and localized mountain snow on the inner band. Five visual texture
reviews refined the palette, circular panels, terrain transitions, varied
machinery bays, and final fine detail. The existing scorch/fissure pipeline and
emissive heat map are retained, including the burning ends and heated debris.
Earlier modeling iterations remain available through `--iteration`.

The habitat-only palette refinement returns the greens and blues toward the
first version's cooler, muted appearance: slate-blue water, sage-green lowlands,
and softer gray-green coasts. Terrain placement and detail, mountain snow, the
dark mechanical shell, and orange fracture heat are retained; only the habitat's
base-color palette changes.

This updates the appearance of the existing Microsoft-planet ring without
changing its geometry, placement, feature flag, renderer, or runtime dependencies.

### Five visual critique-and-update passes

| Pass | Render critique | Update |
| --- | --- | --- |
| 1 | Clean horseshoe shape, square ends, overly upright framing. | Layered rims, asymmetric torn ends, diagonal presentation. |
| 2 | Interior resembled clouds; exterior repeated large tiles; right branch too long. | Ridged terrain, water basins, finer multi-scale plating, shorter asymmetric arc. |
| 3 | Terrain was too glossy and contoured; destruction lacked depth. | Rougher snow/rock, charred hull, emissive fissures, structural splinters, batched debris. |
| 4 | Close-ups exposed stretched emissive shard UVs; landscape was too smooth and geometry too dense. | World-scaled shard UVs, finer icy terrain, lower arc tessellation, tetrahedral small debris. |
| 5 | Wide and fracture views held up, but glow was too uniform and material maps carried excess precision. | Patchier restrained heat, smaller normal/ORM encodings, final framing and idle-render checks. |

Earlier working stages can be regenerated without replacing the final asset:

```bash
npm run models:build -- --iteration 3 --output /tmp/ring-pass-3.glb
```

For other subjects, reuse the [create-3d-model skill](#copilot-skills).

## Unfinished battle-station asset

[death-star-ii.glb](public/models/death-star-ii.glb) is an original procedural
model inspired by the unfinished station in the supplied *Return of the Jedi*
reference. It includes a physically recessed dish, equatorial trench, incomplete
armor, a closed recessed interior, layered decks, structural supports, and sparse
maintenance lights.
No film/game geometry, textures, or reference-image pixels are embedded.
The live timeline includes this model as the **LucasArts** planet's orbit-only
moon through its `spaceStation` feature flag.

```bash
npm run models:death-star          # deterministic final GLB + metrics
npm run models:preview:death-star  # native interactive PBR preview
node --test scripts/build-death-star.test.mjs
```

When the dev server is already running, open
`/tools/broken-ring.html?model=/models/death-star-ii.glb`. The shared preview
offers **Reference**, **Dish**, **Reverse**, and **Structure** views, native
orbit/pan/zoom, wireframe, optional auto-orbit, and WebGL2/WebGPU selection.
Append `&background=pink` for high-contrast inspection of see-through gaps in
either renderer; omit it or use `&background=dark` for the normal background.
The existing ring build/preview commands and ring-world integration are unchanged.

### Station asset contract

- **14,902 triangles, 18,553 vertices, two draws, two PBR materials.**
  Armor/dish and interior/construction framework are batched separately;
  individual struts and plates do not add draw calls. The final model's closed
  radius-8.1 inner body backs the exposed decks. The outer shell is double-sided
  so its inside also blocks sightlines that pass around the core; the framework
  remains backface-culled. Both materials share the same four texture maps.
- **2.37 MiB self-contained core GLB 2.0**, with a 2048x1024 sRGB base-color
  atlas and 1024x512 PNG normal, packed ORM, and sRGB emissive maps.
  ORM is R = occlusion, G = roughness, B = metallic.
- Approximately **18.7 MiB RGBA8 textures with mipmaps** and **0.93 MiB exported
  geometry**. The native adapters use about **1.47 MiB of geometry buffers**,
  including their interleaved layout and cached wireframe edges. Render targets
  are not included in those costs.
- **+Y up, front +Z, origin at the sphere center**. Radius 10 model units,
  dish radius 3.05, dish depth 1. The orbiting-model adapter scales and rotates
  the root for scene use.
  Both meshes are static and opaque, with no extensions, compression decoders,
  particle systems, animation, or transparent layers.

The [builder](scripts/build-death-star.mjs) enforces the original targets of
15,000 triangles, two draws, 3 MiB on disk, and 20 MiB of mipmapped textures,
and rejects Khronos validation errors and warnings. The
[metrics](public/models/death-star-ii.metrics.json) are measured from actual
meshes and encoded textures. [Tests](scripts/build-death-star.test.mjs)
verify native loading, geometry/tangents, core and outer-shell occlusion,
per-mesh sidedness, shared GPU textures, dish/trench depth, PBR maps, budgets,
and byte-for-byte regeneration.
The ring and station builders reuse the
[PBR GLB writer](scripts/lib/write-pbr-glb.mjs), seeded procedural helpers,
and native mesh math; no new modeling dependencies are required.

### Five station critique-and-update passes

| Pass | Render critique | Implemented update |
| --- | --- | --- |
| 1 | Coarse armor, stacked sheets, and triangulated equatorial edges. | Clipped armor boundaries, recessed trench, narrower decks and supports. |
| 2 | Repetitive tiles and checkerboard dish; framework lacked small-scale detail. | Multi-scale PBR plating, subdued dish sectors, sparse lights and precise equatorial clipping. |
| 3 | Construction edge too clean and hull too speckled. | Fragmented armor fingers, lower unfinished bays, denser decks and narrower etched detail. |
| 4 | Close-up exposed empty framework and oversized dark openings. | Recessed machinery, internal panels, interrupted decks, finer fringe and welded vertices. |
| 5 | Lower bays still too blocky; front boundary too straight. | Smaller layered lower-hull detail, stepped construction edges, and rebalanced tessellation to meet the original budgets. |

Rebuild an earlier pass without overwriting the final model:

```bash
npm run models:death-star -- --iteration 2 --output /tmp/death-star-pass-2.glb
```

## 📷 Photography assets

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
