# 3D models

Orbiting GLB companions, the Copilot modeling skill, and the committed model assets.

## Create a model with Copilot

The repository skill [create-3d-model](../.github/skills/create-3d-model/SKILL.md)
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

## Orbiting ring worlds

Set `features.ringWorld: true` on a company in
[companies.ts](../src/content/companies.ts) to add the
[broken-ring GLB](../public/models/broken-ring.glb) as an orbiting companion.
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
ring. [OrbitingModels.ts](../src/engine/OrbitingModels.ts) owns the orbital
appearance and shared draw instances for GLB companions.

## Orbiting space stations

Set `features.spaceStation: true` on a company in
[companies.ts](../src/content/companies.ts) to add the
[Death Star GLB](../public/models/death-star-ii.glb) as an orbiting model moon.
The flag defaults to `false`; **LucasArts has it enabled**.
It is independent of `rings`, `ringWorld`, and the procedural moon count.
The station stays in orbit and is not launchable.

Stations use the same paused moon clock, parent transforms, timeline visibility,
independent frustum culling, scene lighting, and fog as ring worlds. Each follows
a deterministic tilted orbit outside the regular moons; when both GLB flags are
enabled on one planet, the station also orbits outside its ring-world companion.
Existing moon, satellite, terrain, and POI seeds are unchanged.

Both native backends share one copy of the station's geometry and textures across
enabled planets. Each visible station adds **two draw calls and 14,772 triangles**,
included in the debug HUD. WebGPU prewarms 1x/4x sample-count variants.
The model is loaded only when enabled, and load failures use the existing
startup error/fallback UI rather than silently omitting it.

Both companions share the planets' depth convention, so nearer planets and
moons occlude them in solid and wireframe views. WebGL converts the shared
`[0, 1]` projection to `[-1, 1]` before procedural draws; the glTF renderer
already performs that conversion in its vertex shader.

## Broken space-ring asset

[broken-ring.glb](../public/models/broken-ring.glb) is an original, reference-based
broken ring with a muted blue-gray and sage-green mountainous inner habitat,
a slender silver-blue metallic shell, beveled plating, circular inset service
panels, scorched fractures, exposed structural splinters, and detached debris. Geometry and
textures are generated locally; no game meshes or textures are extracted or
downloaded.

The live timeline includes this model orbiting the **Microsoft** planet through
its `ringWorld` feature flag.
The separate [interactive preview](../tools/broken-ring.html) uses this repository's
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
- A self-contained **GLB 2.0**, **2.58 MiB** (under **3 MiB**), with four embedded
  textures:
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
  ring center. Radius is 10 model units, band width 2.2, shell thickness 0.18,
  and the surviving arc is about 197.7 degrees. Scale the root node to fit the
  destination scene; include debris in culling bounds.

The deterministic [builder](../scripts/build-broken-ring.mjs) enforces final limits
of 15,000 triangles, two draws, 3 MiB on disk, and 20 MiB of mipmapped textures.
Every export runs Khronos glTF validation and rejects errors **and** warnings.
[Metrics](../public/models/broken-ring.metrics.json) are generated from the actual
meshes and encoded images. Tests independently parse the committed binary,
check geometry/tangent frames, decode every texture, verify material channels,
and enforce the budgets. Texture regressions also check habitat color coverage
and restrained saturation, bright metallic plating with dark circular insets,
measured band width and shell thickness, unchanged body/debris topology, and
pixel-for-pixel preservation of the habitat/fracture atlas interiors and
the original fire map. Hull tests check both base-color contrast and the
roughness/metallic channels, not just the material's metallic factor.
Regeneration checks encoded textures exactly and permits only float-roundoff
differences in tangents.

### Thinner band and metallic exterior

The latest reference refinement narrows the axial band from 2.6 to 2.2 units
(about **15%**) and the radial shell from 0.24 to 0.18 units (**25%**). Edge-rail
overhangs shrink proportionally; the radius, surviving arc, topology, and debris
count stay unchanged. Physical shard UVs and circular hardware proportions
follow the new dimensions.

The exterior uses brighter silver-blue reflectance, varied lower roughness,
polished bevels, subtle brushed normals, and darker recessed machinery. Heavy
soot stays nearer the torn ends so intact metal can reflect the scene lights.
This is baked into the existing PBR atlas, not added emission or a global shader
change. The muted habitat, fracture atlas interiors, and orange heat map are
preserved. Final hull/rim normal quantization saves about 61 KiB compared with
the unoptimized material pass, without adding textures or draw calls.

The existing Microsoft-planet ring uses the updated asset in the live scene.
Its orbit, feature flag, renderer, and runtime dependencies are unchanged.
The five refinement passes and comparison renders are kept as session artifacts,
not deployed binaries. `--iteration 1..4` still produces the earlier modeling
stages; the default `--iteration 5` produces this final asset.

### Five visual critique-and-update passes

| Pass | Render critique                                                                      | Update                                                                                        |
| ---- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 1    | Narrower band preserved the silhouette, but edge rails still looked heavy and dark.  | Proportional rail thickness and cooler polished edge treatment.                               |
| 2    | Thin edges caught the light, but the broad hull remained matte graphite.             | Silver-blue plating, lower roughness, bright service panels, localized soot.                  |
| 3    | Metal read clearly, but close-up plates looked flat and similarly reflective.        | Beveled normals, rounded hardware rims, brushing, independent roughness variation.            |
| 4    | Reflection-aligned lighting washed out too much of the intact hull.                  | Slightly rougher plates and darker, recessed machinery bays to break up highlights.           |
| 5    | Detail and contrast held up, but exterior normals carried excess download precision. | Coarser post-resize hull/rim normal encoding, then re-exported and re-rendered the final GLB. |

Earlier working stages can be regenerated without replacing the final asset:

```bash
npm run models:build -- --iteration 3 --output /tmp/ring-pass-3.glb
```

For other subjects, reuse the [create-3d-model skill](#create-a-model-with-copilot).

## Unfinished battle-station asset

[death-star-ii.glb](../public/models/death-star-ii.glb) is an original procedural
model inspired by the unfinished station in the supplied _Return of the Jedi_
reference. It includes a physically recessed dish, equatorial trench, incomplete
armor, an angular construction wall, layered decks, and structural supports.
Seeded, multiscale damage varies the front/back cut lines, missing plate groups,
fragment lengths, and individual deck elevations. Small cool-white surface
lights cluster around the equator and hull districts, with rare warm accents;
the dish, bulkheads, and fragment undersides remain unlit.
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

- **14,772 triangles, 19,393 vertices, two draws, two PBR materials.**
  Armor/dish and interior/construction framework are batched separately;
  individual struts and plates do not add draw calls. The interior uses sloping
  bulkhead faces, skewed joints, clipped corners, and varied diagonal braces
  instead of cubes or a smooth inner sphere. Clustered bays are deeply recessed,
  and 21 complete core sections are omitted to expose real negative space.
  Selected braces tie into the recessed walls; each machinery face has planar,
  world-scaled UVs. The bulkheads stay within radius 9.35.
  The outer shell remains double-sided so its inside is visible around the
  construction bays; fully missing core sections can open through the unfinished
  side. The intact armor hemisphere remains opaque, and the framework remains
  backface-culled. Both materials share the same four texture maps.
- **2.20 MiB self-contained core GLB 2.0**, with a 2048x1024 sRGB base-color
  atlas, 768x384 PNG normal and packed ORM maps, and a 1536x768 sRGB emissive map.
  The smaller data maps reserve texture memory for finer light points.
  ORM is R = occlusion, G = roughness, B = metallic.
- Approximately **19.7 MiB RGBA8 textures with mipmaps** and **0.97 MiB exported
  geometry**. The native adapters use about **1.53 MiB of geometry buffers**,
  including their interleaved layout and cached wireframe edges. Render targets
  are not included in those costs.
- **+Y up, front +Z, origin at the sphere center**. Radius 10 model units,
  dish radius 3.05, dish depth 1. The orbiting-model adapter scales and rotates
  the root for scene use.
  Both meshes are static and opaque, with no extensions, compression decoders,
  particle systems, animation, or transparent layers.

The [builder](../scripts/build-death-star.mjs) enforces the original targets of
15,000 triangles, two draws, 3 MiB on disk, and 20 MiB of mipmapped textures,
and rejects Khronos validation errors and warnings. The
[metrics](../public/models/death-star-ii.metrics.json) are measured from actual
meshes and encoded textures. [Tests](../scripts/build-death-star.test.mjs)
verify native loading, geometry/tangents, sloping planar bulkheads, real core
openings and recessed bays, staggered deck elevations, outer-shell occlusion,
per-mesh sidedness, shared GPU
textures, dish/trench depth, sparse clustered emission, PBR maps, budgets, and
byte-for-byte regeneration.
The ring and station builders reuse the
[PBR GLB writer](../scripts/lib/write-pbr-glb.mjs), seeded procedural helpers,
and native mesh math; no new modeling dependencies are required.

### Five station critique-and-update passes

| Pass | Render critique                                                              | Implemented update                                                                                                       |
| ---- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1    | Coarse armor, stacked sheets, and triangulated equatorial edges.             | Clipped armor boundaries, recessed trench, narrower decks and supports.                                                  |
| 2    | Repetitive tiles and checkerboard dish; framework lacked small-scale detail. | Multi-scale PBR plating, subdued dish sectors, sparse lights and precise equatorial clipping.                            |
| 3    | Construction edge too clean and hull too speckled.                           | Fragmented armor fingers, lower unfinished bays, denser decks and narrower etched detail.                                |
| 4    | Close-up exposed empty framework and oversized dark openings.                | Recessed machinery, internal panels, interrupted decks, finer fringe and welded vertices.                                |
| 5    | Lower bays still too blocky; front boundary too straight.                    | Smaller layered lower-hull detail, stepped construction edges, and rebalanced tessellation to meet the original budgets. |

The subsequent damage/light refinement used five additional visual passes
on the final-stage asset: irregular cut heights and clustered fragments,
dedicated interior UVs, finer and less uniform light points, visible structural
depth, and unlit fragment undersides. A follow-up replaced the smooth core with
the stepped construction wall, then deepened its backing and added cross-braces
after checking front, reverse, and structural views. A further five-pass
refinement removed the brick-like courses: skewed panel outlines and tilted
faces, fully missing sections, quieter machinery textures, diagonal corner
cuts with planar UVs, and varied braces tied into deep recesses. Final corner
cut proportions are seeded rather than repeated. These refinements apply to
iteration 5; intermediate exports and comparison images stay outside deployed
assets.

Rebuild an earlier pass without overwriting the final model:

```bash
npm run models:death-star -- --iteration 2 --output /tmp/death-star-pass-2.glb
```
