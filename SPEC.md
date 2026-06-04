# Cameron Micka — Portfolio Site Spec

A personal portfolio for **Cameron Micka** (Principal Software Engineer @ Microsoft — Mesh / MRTK / HoloLens; previously Fun Bits Interactive, LucasArts Entertainment; DigiPen alumnus).

The site's landing experience is a WebGPU-rendered 3D "Time Machine" timeline of Cameron's career, with procedurally generated planets representing each company / school. Clickable points of interest (POIs) on each planet open 2D React modals with descriptions, images, and videos. Conventional `/about`, `/contact`, and `/blog` (stub) routes ship as prerendered static HTML.

> Inspiration: Apple's Time Machine UI — cosmic backdrop with a receding Z-axis stack, a side time ruler, and a bottom ribbon. See `timemachine.png` in the repo root.

---

## 1. Tech Stack

| Layer                | Choice                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Language             | TypeScript (`strict` mode, `noUncheckedIndexedAccess`)                                                          |
| Build / dev server   | Vite                                                                                                            |
| UI framework         | React 18+                                                                                                       |
| Router               | React Router v6+ (revisit if it feels heavy)                                                                    |
| State                | Plain React (Context + reducer for UI state); engine owns its own state outside React                           |
| Content              | MDX files in `/content`, loaded via `@mdx-js/rollup` (Vite plugin)                                              |
| 3D — primary         | Hand-rolled mini-engine on **raw WebGPU + WGSL**                                                                |
| 3D — fallback        | Same mini-engine on **WebGL2 + GLSL ES 3.0** (mirrors experience at lower fidelity)                             |
| Shader authoring     | Author shaders in **GLSL ES 3.0**; transpile to WGSL at build time (Naga via WASM, or `naga-cli` in CI)         |
| Image pipeline       | `vite-imagetools` (AVIF/WebP/responsive `srcset`)                                                               |
| Static generation    | `vite-ssg` (or equivalent) for `/about`, `/contact`, `/blog`; landing route stays client-rendered               |
| Hosting              | GitHub Pages (`cameron-micka.github.io`) with `CNAME` file support for a future custom domain                   |
| CI/CD                | Single GitHub Actions workflow: install → typecheck → lint → build → deploy to `gh-pages` branch                |
| Lint / format        | ESLint (typescript-eslint) + Prettier                                                                           |
| Tests                | `tsc --noEmit` typecheck + ESLint only. No unit/e2e tests. (Explicit tradeoff.)                                 |
| Analytics            | **None.** No cookies, no consent banner.                                                                        |
| License              | MIT (`LICENSE` at repo root)                                                                                    |

### Browser support matrix

| Browser         | Min. version  | Render path |
| --------------- | ------------- | ----------- |
| Chrome / Edge   | 113+ desktop, 121+ Android | WebGPU |
| Safari (macOS)  | 18+           | WebGPU      |
| Safari (iOS)    | 18+           | WebGPU      |
| Firefox         | Latest stable | WebGL2 fallback (until WebGPU ships unflagged) |
| Older / locked-down | last 2 versions of evergreens | WebGL2 fallback |

---

## 2. Site Information Architecture

```
/               → 3D Time Machine landing (client-rendered)
/about          → Bio, headshot, longer-form narrative (SSG)
/contact        → Static links: email, GitHub, LinkedIn, Bluesky, X (SSG)
/blog           → "Coming soon" placeholder. MDX pipeline scaffolded for future posts. (SSG)
/blog/[slug]    → Reserved route; not yet populated
```

**Top navigation** (persistent on all routes, including landing):

- Logo / name (links to `/`)
- About · Contact · Blog
- Settings (gear icon, top-right) — see §10
- On mobile: collapsed into a hamburger; settings stays as a discrete icon

**Footer** (non-landing routes only; landing has no footer to preserve immersion):

- `© Cameron Micka · MIT · GitHub link`

---

## 3. The 3D Time Machine Experience

### 3.1 Scene overview

A vertical Z-axis stack of planets receding into a cosmic distance. A single bright key light ("the sun") sits near the vanishing point, producing the central glow seen in the reference image. The camera dollies along Z to scrub through time.

**Coordinate convention:**

- `+Z` points away from the camera into the scene (right-handed).
- "Now" planet sits at `Z = 0`. Older planets sit at increasing `+Z`.
- Camera starts at some `−Z` looking down `+Z`.

### 3.2 Timeline content

Four planets, ordered closest → farthest from the camera ("Now" → "Past"):

| Planet         | Real-world entity        | Approx. dates  | Tenure (yrs) → relative radius |
| -------------- | ------------------------ | -------------- | ------------------------------ |
| Microsoft      | Microsoft (Mesh/MRTK/HoloLens) | 2016 – present | Largest |
| Fun Bits       | Fun Bits Interactive     | TBD            | Medium  |
| LucasArts      | LucasArts Entertainment  | TBD            | Medium-small |
| DigiPen        | DigiPen Institute of Tech (alumnus) | TBD     | Smallest |

> Exact dates per planet come from the MDX content frontmatter (see §6); the engine reads them and labels the ruler.

**Spacing:** Even Z-spacing between planets. **Radius** of each planet is proportional to tenure (years at company / years in program). Microsoft, the longest tenure, has the largest sphere.

**Time direction:** Scrolling **down** moves the camera **away** from the viewer (into the past). Scrolling up moves the camera back toward "Now". Matches Apple Time Machine semantics.

### 3.3 Procedural planet generation

Each planet is fully deterministic from a per-company **seed** (string → 32-bit hash).

**Surface:** Procedural fragment shader (one shader, parameterized per planet):

- 3D simplex / fBm noise for terrain height proxy → fed into a 1D **biome palette LUT** authored per company (e.g., Microsoft = cyan/blue palette, Fun Bits = warm orange, LucasArts = gold/desert, DigiPen = green). LUT is a small 256×1 PNG in `/assets/palettes/`.
- Surface normal computed analytically from noise derivatives for crisp specular highlights.

**Atmosphere:** Two complementary parts. (1) A cheap fresnel rim glow on the planet surface; color sampled from the high end of the palette. (2) An **atmospheric-scattering shell** — a sphere at 1.02× the planet radius drawn additively. Its fragment shader ray-marches the view ray through the shell (terminating at the planet surface where occluded) and accumulates an altitude-weighted, sun-lit density, producing a soft blue limb glow that is brightest on the day side and fades into space. Implemented in `atmosphere.wgsl` (WebGPU, HDR + bloom) and mirrored in the WebGL2 fallback (LDR, ACES-clamped in-shader). Atmosphere shells are rendered for planets only.

**Rings:** Optional per-planet — flat ring mesh, single texture with alpha falloff. Authored on/off + tilt angle per company.

**Moons:** Optional per-planet — N small spheres orbiting at fixed radii and periods. Moons use a rocky grayscale palette (lower saturation, stone-biased tones) over the procedural terrain pattern so they read more lunar/rocky than planets. Authored count + orbital params per company.

> Final per-company "feature set" (rings y/n, moon count) lives in the MDX frontmatter.

### 3.4 Points of interest (POIs)

POIs are positioned on each planet's sphere using **Poisson-disk sampling on the sphere**, seeded from the planet's seed. The author writes only the POI **content** (slug, title, body MDX, optional accent color); the engine assigns the position. Same content + same seed → same position forever.

**Rendering:** Each POI is a small bright disc/sprite on the planet surface, with a soft outer glow.

**Backface handling:** All POIs always render. Backside POIs are **dimmed by a fresnel × depth term** so they're visible-but-deemphasized through the planet silhouette. The user can rotate the planet (auto or manual) to bring them forward.

**Pickability:**

- POIs on **any** planet (focused or not) are clickable.
- Clicking a POI on a non-focused planet smoothly scrubs the timeline to that planet **and** opens the POI modal.
- Hover state: subtle scale-up and brighter glow.
- Mobile: hit-test radius is enlarged in screen-space to a minimum tap target (~44pt). Distant planets' POIs use the same min target.

### 3.5 Planet rotation

- **Ambient rotation:** Slow auto-rotation around each planet's local Y axis (~1 rev / 90 seconds). Disabled when `prefers-reduced-motion: reduce` is set.
- **Manual orbit:** Click-and-drag (desktop) or one-finger-drag (mobile) on the focused planet rotates it. Manual interaction temporarily suspends ambient rotation; it resumes after a few seconds of idle.

### 3.6 Lighting

- One **key light** at the vanishing point (the central glow).
- Per-planet **rim/key fill** (a cheap second light term in the shader, not a real second light) to keep silhouettes legible against the dark background.
- **Screen-space ambient occlusion (SSAO)** on planet surfaces for crater/terrain depth. Disabled on Med/Low quality presets.
- No shadow mapping.

### 3.7 Backdrop

- **Nebula skybox:** A procedural 2D noise / smoothed gradient shader on a large inward-facing sphere or a single fullscreen quad behind everything.
- **Star sprites:** ~5,000–10,000 instanced point sprites on a distant inward-facing shell. Each instance has a per-vertex phase (from `instance_index`) for subtle twinkle. Parallax via slight camera-relative offset.
- Star count tier-scaled (High: 10k, Med: 2k, Low: 0).

### 3.8 Post-processing

Compositing pipeline (post-FX chain executed each frame):

1. Tonemapping (ACES Filmic)
2. **Bloom** on the central glow + bright POIs (3-tap downsample/upsample, 3 mips). Mandatory.
3. **Chromatic aberration** (subtle, radial). Disabled on Low.
4. **Vignette** (subtle, dark corners). Always on.
5. Gamma encode

---

## 4. Camera & Navigation

### 4.1 Camera model

- Perspective camera, fixed FOV (~50°).
- Single degree of freedom for scrubbing: position along Z.
- Always looks at `(0, 0, currentCameraZ + lookAheadDistance)` — i.e., always pointed forward into the stack.
- During manual planet orbit, the camera doesn't move — the **planet** rotates around its local axis.

### 4.2 Scrubbing

- **Desktop:** Mouse wheel + trackpad vertical scroll scrubs the camera along Z. Side ruler is also clickable to jump.
- **Mobile:** Single-finger vertical swipe scrubs (in "scrub mode" — i.e., when not actively dragging on a planet). Two-finger drag also scrubs.
- **Keyboard:** Up/Down arrows step to previous/next planet. PageUp/PageDown jumps to first/last. Home → "Now", End → oldest.
- **Snap behavior:** During input, scrub is free and continuous. **On release**, the camera eases (cubic out, ~400ms) to the **nearest planet**. URL hash updates only on snap settling.

### 4.3 Orbit (planet rotation by user)

- **Desktop:** Click-and-drag on a planet rotates it (yaw + small pitch range).
- **Mobile:** One-finger drag on the focused planet's screen-space bounds rotates it.
- **Pinch (mobile):** Pinch zoom on a planet adjusts a per-planet zoom factor (camera distance to focused planet within a small range). Desktop equivalent: Ctrl + wheel.

### 4.4 First-load cinematic

On the **first** mount of the landing route:

- Camera starts far back in the void (deep `−Z`, beyond the oldest planet's depth).
- Dolly forward over ~2 seconds (cubic ease-out) and settle at "Now" (Microsoft).
- **Skippable** via any user input (click, key, scroll, touch). Skip immediately cuts to the rest state.
- **`prefers-reduced-motion: reduce`** skips the cinematic entirely.

---

## 5. 2D UI

### 5.1 Layout

```
┌───────────────────────────────────────────────────────────────┐
│ [logo]     About · Contact · Blog              [⚙]           │ ← top nav
├───────────────────────────────────────────────────────────────┤
│                                                            │  │
│                                                            │  │
│              [    3D canvas — fullscreen     ]             │R │ ← side ruler
│                                                            │  │
│                                                            │  │
│                                                            │  │
│                                                            │  │
├───────────────────────────────────────────────────────────────┤
│        ◀  [ Microsoft · 2016 – present ]  ▶                  │ ← bottom ribbon
└───────────────────────────────────────────────────────────────┘
```

- **Canvas:** Fullscreen, `position: fixed`, `inset: 0`, `z-index: 0`. All other UI sits on top (`z-index ≥ 1`).
- **Top nav:** Translucent dark bar over the canvas. Visible on all routes.
- **Side ruler:** Right edge, vertical scale of years with chevron tick marks. Clickable to jump to a planet. On mobile, collapses to a thin right-edge affordance; tap expands the full ruler temporarily.
- **Bottom ribbon:** Shows currently focused planet's name + date range. Chevrons step to neighbors. Mimics the Time Machine "Cancel / Today (Now) / Restore" ribbon visually.
- **Settings gear:** Top-right, opens the settings panel (see §10).

### 5.2 POI modal

When a POI is clicked:

- Centered **glassmorphism card**, ~60% viewport width (max 720px) on desktop, full-width with 16px margins on mobile.
- Card content: title, accent color stripe, MDX body (text + responsive images + optional `<video>` tags), close button.
- **3D scene is paused** on modal open: render one extra frame, downsample + 2-pass separable Gaussian blur it, draw the blurred copy as a fullscreen quad in the canvas. Stop the rAF loop. The DOM modal sits on top of the (now static) blurred canvas.
- On modal close: re-blit the original (unblurred) framebuffer once, then resume rAF.
- **Close:** ESC key, click on the dimmed backdrop, or explicit ✕ button in the modal header. All three.
- Modal mount/unmount eased with a 200ms opacity + 4px translate transition. `prefers-reduced-motion`: instant.

### 5.3 Deep linking

- URL hash convention: `/#/{planet-slug}/{poi-slug}` for an open POI; `/#/{planet-slug}` for just a focused planet; `/` for default ("Now", no modal).
- On load, parse the hash:
  - If `planet-slug` is present, set initial camera position to that planet (skipping the fly-in cinematic).
  - If `poi-slug` is present, open the matching modal once the scene is ready.
- On user navigation, **replace** the hash via `history.pushState` (so back/forward navigation works across planets and modals).
- Invalid slugs in the hash → silently fall back to defaults.

### 5.4 Theme

- **Color:** Cosmic dark base — near-black background (~`#05060a`), off-white text. Per-planet accent color derived from each planet's palette LUT (used for POI glow, bottom ribbon highlight, modal accent stripe).
- **Typography & precise palette:** **Deferred.** Pick a custom display font + final accent shades as a polish pass after the 3D engine is stable. Default for now: system font stack.
- All hardcoded UI strings live in `src/strings.ts` (no i18n library, but easy to extract later).

---

## 6. Content Model

All site content authored as MDX in `/content`:

```
/content
  /companies
    microsoft.mdx
    fun-bits.mdx
    lucasarts.mdx
    digipen.mdx
  /pages
    about.mdx
    contact.mdx
  /blog
    .gitkeep         # stub
```

### 6.1 Company MDX schema (frontmatter)

```yaml
---
slug: microsoft               # URL slug
name: Microsoft               # Display name
role: Principal Software Engineer
start: 2016-01                # YYYY-MM
end: null                     # null = present
seed: microsoft-mesh-mrtk     # deterministic procedural seed
palette: ms-cyan              # references /assets/palettes/ms-cyan.png
features:
  rings: false
  moons: 2
pois:
  - slug: mrtk-graphics-tools
    title: "MRTK Graphics Tools for Unity"
    accent: "#3aa0ff"
    media:
      - type: image
        src: ./media/mrtk-hero.png
        alt: "MRTK Graphics Tools sample scene"
      - type: video
        src: ./media/mrtk-demo.mp4
        poster: ./media/mrtk-demo-poster.jpg
  - slug: shader-foundations-talk
    title: "MR Speaker Series: Shader Foundations"
    accent: "#7ad6ff"
---

Body MDX here — long-form description of the role, narrative, etc.
Each POI's *long* description lives inside `## {{poi.slug}}` sections
below the frontmatter, allowing rich MDX (embedded React, code, etc.).
```

### 6.2 Validation

- A small zod schema validates each MDX file's frontmatter at build time. Build fails loud if a slug, seed, palette ref, or media path is invalid.
- All slugs (planet + POI) must be unique and URL-safe.

### 6.3 Media

- All images and videos committed to the repo under `/content/companies/*/media/`.
- Build pipeline (`vite-imagetools`) produces AVIF + WebP + fallback JPEG at responsive widths, with `<picture>` srcset emitted by the MDX renderer.
- Videos: MP4 (H.264) + WebM (VP9), both committed. `<video>` tag with `preload="none"`, `poster=` attribute set. Videos load **only on modal open**.
- Images shown inside modals respect a maxHeight to prevent jumping above the viewport on small screens; tap-to-fullscreen lightbox is **out of scope** for v1.

---

## 7. Engine Architecture

### 7.1 Module layout

```
/src
  /engine
    Renderer.ts           # interface, two impls: WebGPURenderer, WebGL2Renderer
    Pipeline.ts           # pipeline / program abstraction
    Mesh.ts               # vertex buffer + index buffer wrappers
    Texture.ts
    Camera.ts
    Scene.ts              # owns all planets, lights, starfield, post chain
    /passes               # geometry pass, post-fx passes
    /shaders              # *.glsl source files → transpiled to WGSL at build
    /math                 # vec3, mat4, quat, easing, raycast utilities
    PickingSystem.ts      # CPU ray-vs-sphere
    InputController.ts    # unified wheel/touch/keyboard → scrub/orbit/pick events
    QualityManager.ts     # presets, perf probe, runtime adjustments
    Engine.ts             # owns RAF loop, owns state, publishes events
  /ui                     # React components (top nav, ruler, ribbon, modal, settings)
  /content                # MDX loader + zod validator
  /routes                 # /about, /contact, /blog, landing
  strings.ts
  main.tsx
/content                  # MDX content (see §6)
/public                   # static, non-processed assets (favicon, og.png, CNAME)
/assets                   # imported assets (palettes, fonts) — processed by Vite
```

### 7.2 Renderer abstraction

Two concrete implementations behind one interface:

```ts
interface Renderer {
  init(canvas: HTMLCanvasElement): Promise<void>;
  resize(width: number, height: number, dpr: number): void;
  createPipeline(desc: PipelineDesc): Pipeline;
  createMesh(desc: MeshDesc): Mesh;
  createTexture(desc: TextureDesc): Texture;
  beginFrame(): void;
  draw(pass: RenderPass): void;
  endFrame(): void;
  readbackPixel?(x: number, y: number): Promise<Uint8Array>; // optional
  destroy(): void;
}
```

The Engine writes **once** against this interface; concrete implementations live in `WebGPURenderer.ts` and `WebGL2Renderer.ts`.

### 7.3 Shader pipeline

- All shaders authored in **GLSL ES 3.0** under `/src/engine/shaders/`.
- Build step transpiles GLSL → WGSL via **Naga** (run as a CLI or via the wasm build of `naga-cli`) producing `*.wgsl` siblings.
- Vite plugin (custom or `vite-plugin-glsl` + thin wrapper) imports a shader and yields both strings: `{ glsl: string, wgsl: string }`. The renderer picks one.
- **Tradeoff:** Author once; some GLSL idioms may not map cleanly to WGSL and need annotations. Document GLSL conventions in `/src/engine/shaders/README.md`. If a shader can't be transpiled cleanly, write a hand-written `.wgsl` override that lives next to the `.glsl` file.

### 7.4 Engine ↔ React boundary

The engine owns its own state and runs entirely outside React:

```ts
// Engine.ts
class Engine extends TinyEventEmitter {
  state: { focusedPlanetIndex: number; scrubProgress: number; openPoi: string | null; ... };
  // emits: 'focusedPlanetChanged', 'scrubProgressChanged', 'poiOpened', 'poiClosed', 'qualityChanged'
}
```

React UI subscribes via `useSyncExternalStore`, with snapshot/getServerSnapshot functions reading only the slice it needs (e.g., the ribbon component subscribes only to `focusedPlanetIndex`). This guarantees no per-frame React re-renders even though the engine ticks at 60 FPS.

A single `<CanvasMount />` React component mounts the canvas + initializes the engine in a `useEffect`; everything else in `/ui` is a subscriber.

### 7.5 Picking

- **CPU ray-vs-sphere**, identical in both renderer backends.
- Mouse / touch position → unprojected NDC ray (using current camera matrices).
- Iterate planets front-to-back; first hit (ray vs planet sphere) becomes the candidate planet.
- For that planet, iterate its POIs (each is a tiny sphere at a known position on the planet's surface, accounting for current rotation); first hit becomes the POI.
- On mobile, expand each POI's pick radius to at least the screen-space equivalent of 44pt before testing.

### 7.6 Picking through-the-planet (backside POIs)

Because backside POIs are visible (just dimmed), users may try to click them. **Backside POI clicks are intentionally rejected** — only POIs on the camera-facing hemisphere of the relevant planet are pickable. The visible-but-dimmed appearance is purely a wayfinding cue; the user must rotate the planet to interact. This matches the affordance: dimmed POIs look "behind" something.

### 7.7 Quality presets

| Preset    | DPR cap | Stars | SSAO | Clouds | CA  | Bloom mips | MSAA | Notes              |
| --------- | ------- | ----- | ---- | ------ | --- | ---------- | ---- | ------------------ |
| High      | 2.0     | 10k   | on   | on     | on  | 3          | 4x   | Default if probe passes |
| Med       | 1.25    | 2k    | off  | on     | on  | 2          | 4x   |                    |
| Low       | 1.0     | 0     | off  | off    | off | 1          | 4x   | Hard fallback      |
| WebGL2    | 1.0     | 2k    | off  | on     | off | 1          | off  | The fallback renderer always runs at this fidelity ceiling |

> MSAA applies to the WebGPU scene pass only. WebGPU guarantees sample counts of 1 and 4, so MSAA is either off (1x) or 4x.

**Selection:** On first load, run a 5-second perf probe (render the scene normally, measure median frame time). Map the result to a tier:

- ≤ 17ms → High
- ≤ 25ms → Med
- otherwise → Low

User can override via the settings panel; the override is persisted to `localStorage` and short-circuits the probe on future loads.

### 7.8 Adaptive quality

After the initial tier is locked, the engine **does not** silently change tiers mid-session (avoid jarring quality flips). If frame time degrades sustainedly (>25ms over 3 seconds), the debug HUD (if visible) flags it; otherwise no action.

### 7.9 Frame loop

- `requestAnimationFrame` driven.
- Delta-time clamped to a max of 50ms (avoids large jumps after tab visibility resume).
- On `document.visibilityState === 'hidden'`: **pause RAF entirely.** On `'visible'`: resume, with the delta-time clamp protecting the first frame.
- Risk: on long backgrounds, GPU device may be lost. Recovery policy is hard reload (§7.10).

### 7.10 GPU device loss

- Listen for `device.lost` (WebGPU) / `webglcontextlost` (WebGL2).
- On loss: render a minimal fullscreen DOM overlay ("Restoring graphics…") and trigger `window.location.reload()`. Simple, reliable.

### 7.11 WebGPU detection & fallback gate

Boot sequence:

1. `if (!('gpu' in navigator)) → WebGL2.`
2. `const adapter = await navigator.gpu.requestAdapter(); if (!adapter) → WebGL2.`
3. `const device = await adapter.requestDevice(); if (error) → WebGL2.`
4. Cache the chosen backend in `sessionStorage` (`renderer: 'webgpu' | 'webgl2'`) to skip the probe on internal route changes.
5. On *any* WebGPU pipeline-creation failure within 2 seconds of init, treat it as a startup failure and reload into WebGL2 mode (URL flag or sessionStorage flag).

---

## 8. Accessibility

- **`prefers-reduced-motion: reduce`**: kills all *idle* motion — auto-rotation, star twinkle, ambient camera drift, intro cinematic, modal mount/unmount easing. User-initiated motion (scrubbing, dragging to orbit) still happens but with instant transitions (no eased snap).
- **Keyboard nav (chrome / modal / nav only):**
  - Tab order: top nav → settings → bottom ribbon chevrons → side ruler → POI close button (when modal open).
  - Modal: ESC closes; focus trap inside modal while open; restore focus to the triggering POI's logical DOM target on close.
  - Arrow Up/Down (when canvas has focus): step focused planet ± 1.
- **Screen readers:**
  - The canvas itself is `aria-hidden`.
  - The hidden **print resume** DOM (see §11) doubles as a screen-reader-readable representation of all timeline content. It lives inside a `<main>` with `visibility: hidden; position: absolute` (still in the accessibility tree).
  - **Known gap:** scrubbing, orbiting, and per-POI focus events are not mirrored into the SR experience. Documented in `README.md`.
- **Color contrast:** All text overlay UI (ruler labels, ribbon, modal text) maintains WCAG AA contrast against the dark cosmic backdrop. Text never sits directly on a bright planet/glow region without a tinted background.
- **Tap targets:** ≥ 44pt for all interactive elements on touch devices.

---

## 9. Mobile-Specific Behavior

- **Gesture map:**
  - Tap → pick POI / planet.
  - Single-finger drag on focused planet → orbit.
  - Two-finger vertical drag (or single-finger vertical swipe in empty space) → scrub timeline.
  - Pinch on planet → zoom focused planet (clamped range).
- **Side ruler:** Collapsed to a thin right-edge affordance (a slim strip with current planet's accent color). Tap expands the full ruler for ~3s, then collapses.
- **Bottom ribbon:** Always visible; chevrons are large tap targets.
- **Modal:** Full viewport width minus 16px margins. Body scrolls within the modal if content overflows viewport.
- **Address bar / 100vh issues:** Use `100dvh` for canvas sizing; subscribe to `visualViewport.resize` to adapt during browser-chrome show/hide.
- **Orientation change:** On rotation, debounce 200ms then re-measure canvas and update camera aspect. The scrub position and any open modal are preserved.

---

## 10. Settings Panel

Triggered by the gear icon top-right. Modal-style panel (smaller than POI modal, top-right anchored on desktop, bottom sheet on mobile).

| Setting          | Options                                                | Default        |
| ---------------- | ------------------------------------------------------ | -------------- |
| Quality          | Auto (probe), High, Med, Low, WebGL2 (force)           | Auto           |
| Sound            | On / Off                                               | Off            |
| Reduced motion   | Auto (follow OS), Force on, Force off                  | Auto           |
| Debug HUD        | On / Off                                               | Off            |
| Wireframe        | On / Off (debug: renders scene meshes as wireframe)   | Off            |

All settings persist to `localStorage` under the key `cm-portfolio-settings`.

### 10.1 Sound

- **Off by default.** No autoplay.
- When On: subtle "whoosh" on scrub snap, soft "pop" on modal open/close. No ambient drone.
- Sounds are tiny (≤ 30KB total), bundled as `.webm`/`.mp3` pair, lazy-loaded only after the user enables sound.

### 10.2 Debug HUD

- Toggleable via settings *or* the backtick (`` ` ``) hotkey.
- Hidden by default. When on, shows in the bottom-left:
  - FPS (60-frame rolling avg + min/max)
  - 1-line FPS sparkline graph
  - Renderer backend (webgpu / webgl2) + adapter info
  - Quality tier
  - Draw call count (last frame)
  - Triangle count (last frame)
  - GPU memory estimate (sum of allocated buffers + textures, in MB)
  - Camera state: Z position, focused planet index, scrub progress

---

## 11. Print Stylesheet ("Print to PDF" Path)

The site is the resume — recruiters print from the browser. The landing route includes a hidden `<main role="main">` containing a plain-HTML chronological version of all timeline content:

```html
<main class="print-resume">
  <h1>Cameron Micka</h1>
  <p>Principal Software Engineer · Redmond, WA</p>
  <section data-company="microsoft">
    <h2>Microsoft <small>2016 – present</small></h2>
    <p>Role: Principal Software Engineer (Mesh, MRTK, HoloLens)</p>
    <p>{narrative}</p>
    <ul>
      <li><h3>MRTK Graphics Tools for Unity</h3><p>{poi body}</p></li>
      ...
    </ul>
  </section>
  ...
</main>
```

- Visually hidden on screen via `clip-path` / `position: absolute; visibility: hidden` (still in the accessibility tree).
- `@media print` rules:
  - Hide canvas, nav, settings gear, ruler, ribbon, modal.
  - Show the `.print-resume` block at its natural layout.
  - Force colors to black on white, sans-serif body, generous line-height.
- This DOM is generated at build time from the same MDX content used by the 3D engine — single source of truth.

---

## 12. SEO & Metadata

- `vite-ssg` (or equivalent) prerenders `/about`, `/contact`, `/blog` to static HTML.
- Each route ships:
  - `<title>` and `<meta name="description">` from front-matter or per-route config.
  - **Open Graph:** static `og.png` (1200×630), hand-rendered screenshot of the 3D scene, served from `/public/og.png`. Same image used for `og:image`, `twitter:image` on all routes.
- Landing route is **not** prerendered (it's a 3D experience), but ships a basic `<title>`, description, and the same OG card. The print-resume DOM (§11) is in the initial HTML, giving crawlers something to read.
- `robots.txt` allows all. `sitemap.xml` generated at build listing all SSG routes.

---

## 13. Error Handling

- **React Error Boundary** at the route level. Shows the error message + stack trace in a styled panel (you, the dev, are the main consumer here; recruiters seeing it is acceptable). Includes a "Reload page" button.
- **Engine errors:** All WebGPU pipeline / shader / device errors are caught and routed through the error boundary by re-throwing during render. Boundary text differentiates "shader error" / "device error" / "asset load error".
- **Content errors** (missing image, malformed MDX) **fail the build**, not at runtime.

---

## 14. CI / Deploy

`.github/workflows/deploy.yml`:

1. Trigger: push to `main`.
2. Setup Node (pinned major version).
3. `npm ci`.
4. `npm run typecheck` (`tsc --noEmit`).
5. `npm run lint` (`eslint .`).
6. `npm run build` (Vite + SSG + image pipeline + shader transpile).
7. Upload artifact, deploy to `gh-pages` branch via the `actions/deploy-pages` action.
8. Preserves `CNAME` file at repo root (committed manually when domain is ready).

PRs run steps 1–6 (no deploy). Branch protection: green CI required.

---

## 15. Performance Budgets

- **Time to interactive (TTI, landing):** ≤ 3 seconds on fast 4G + mid-range mobile.
- **JS bundle:** ≤ 200KB gzipped initial; total transfer ≤ 500KB initial (excluding videos, which are lazy).
- **Per-route code split:** landing's engine is its own chunk; `/about`, `/contact`, `/blog` ship as separate chunks. MDX content for distant companies prefetched on idle (`requestIdleCallback`).
- **Per-planet asset budget:** ≤ 200KB total (palette LUT + ring texture if present) per planet.
- **Video budget:** ≤ 5MB per POI video, ≤ 720p H.264. Loaded only on modal open.
- **FPS targets:**
  - Desktop, discrete GPU: 60 FPS sustained.
  - Mid-range laptop iGPU: 30 FPS minimum.
  - Modern mobile (iPhone 13+, Pixel 7+): 30 FPS minimum.
  - Below floor → next-lower quality preset (pre-locked via probe, not mid-session).

---

## 16. Repository Layout

```
/                       (repo root: cameron-micka.github.io)
├── .github/workflows/
│   └── deploy.yml
├── public/
│   ├── og.png
│   ├── favicon.svg
│   ├── 404.html        ← SPA fallback for GH Pages
│   └── CNAME           ← committed when custom domain ready
├── content/
│   ├── companies/
│   │   ├── microsoft.mdx (+ media/)
│   │   ├── fun-bits.mdx  (+ media/)
│   │   ├── lucasarts.mdx (+ media/)
│   │   └── digipen.mdx   (+ media/)
│   ├── pages/
│   │   ├── about.mdx
│   │   └── contact.mdx
│   └── blog/.gitkeep
├── assets/
│   ├── palettes/       ← per-company 256×1 LUT PNGs
│   └── sounds/         ← optional, opt-in audio
├── src/
│   ├── engine/         (see §7.1)
│   ├── ui/
│   ├── routes/
│   ├── strings.ts
│   └── main.tsx
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── LICENSE             ← MIT
├── README.md
├── SPEC.md             ← this file
└── timemachine.png     ← reference image (kept for design history)
```

---

## 17. Out of Scope (v1)

Explicitly **not** included in the first release:

- Real blog posts (route is stubbed; first post comes later).
- Unit / integration / e2e tests.
- Analytics & telemetry of any kind.
- Internationalization (English only).
- A contact form (static contact links only).
- A downloadable resume PDF (print-to-PDF via browser is the path).
- Image lightbox / fullscreen viewer inside POI modals.
- Per-route or per-planet dynamic OG images.
- Custom domain (file is committed when the domain is ready; nothing else changes).
- Visual regression / snapshot testing.
- Adaptive quality changes during a session (locked after the initial probe).
- Screen reader narration of timeline scrubbing / planet orbit (chrome + modal + print resume only).

---

## 18. Known Tradeoffs (for the record)

1. **Two shader languages, transpiled.** Authoring in GLSL and transpiling to WGSL trades the "WGSL flex" for maintenance simplicity. WGSL chops are still demonstrated in pipeline / bind-group / engine code.
2. **No runtime tests.** Trades safety net for development velocity. Mitigated by strict TS, zod validation of content, and the error boundary catching live failures with full stack traces.
3. **Hard reload on GPU device loss.** Trades graceful recovery for simplicity. Acceptable because device loss is rare on modern hardware.
4. **No screen-reader mirror of 3D scrubbing.** Trades full a11y for engineering scope. Hidden print-resume DOM provides full content access; documented as a known limitation.
5. **No adaptive quality mid-session.** Avoids the bad UX of mid-session quality drops; relies on the initial probe being accurate. Override via settings panel for users who disagree.
6. **Bundled videos in the repo.** Trades repo size for asset reliability. Re-evaluate if the repo crosses ~500MB.
7. **Pause-and-snapshot blur instead of real-time backdrop blur.** Trades the "living" backdrop behind modals for guaranteed cross-browser correctness and lower GPU load while the modal is open.
8. **No mid-scene WebGPU↔WebGL2 swap.** The backend is chosen once at boot and stuck with for the session.

---

## 19. Roadmap After v1

- Custom font + final color palette / design pass.
- First real blog post.
- Per-planet (or per-route) dynamically rendered OG images at build time.
- Optional ambient soundscape (drone) layer.
- Adaptive quality based on rolling perf metrics, with a non-jarring transition.
- A11y: ARIA live region narrating focused planet on scrub change.
- Light mode toggle.
- An interactive credits / about-this-site POI on the "Now" planet that explains the engine itself.
