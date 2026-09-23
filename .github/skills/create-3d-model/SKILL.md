---
name: create-3d-model
description: Create reference-based 3D models as optimized GLB assets with PBR materials. Use when asked to make a 3D model from images or a description for a realtime website, with five visual critique-and-update iterations, an interactive preview, and verified performance budgets.
argument-hint: '[subject] [reference images or description] [optional performance budget]'
---

# Create a realtime 3D model

## Core request

Apply this reusable version of the original modeling prompt:

> Make a 3D model (.glb) of [subject] using [reference images or description].
> Use PBR materials. Do 5 iterations to make it look good: critique and make
> updates after each iteration. This will be rendered in realtime on this site,
> so keep performance in mind.

Deliver the actual model, not just modeling advice or a render. Adapt the
subject, style, proportions, and materials to the current request. Do not carry
over broken-ring features such as damage, icy terrain, or debris unless they
belong in the new model.

## Establish the asset contract

1. Inspect the supplied references and identify the defining silhouette,
   proportions, construction, material differences, and small-scale detail.
   Ask for the subject or reference only if the request is too ambiguous to
   model reliably.
2. Inspect the destination renderer, existing asset tools, and dependencies.
   Determine format support, intended on-screen size, target devices, and any
   existing budgets before selecting the modeling workflow.
3. Keep asset generation and production-scene integration separate. If scope
   is unclear, ask whether the user wants the model with a separate preview or
   integration into the live scene. Do not replace the site's renderer just to
   preview a model.
4. Choose a descriptive output name. Preserve existing models and their build
   commands; do not overwrite the broken-ring asset for a different subject.

## Build reproducibly

- Use available modeling tools, procedural geometry, or a combination. For
  procedural assets, retain an editable, deterministic builder with seeded
  randomness. For hand-modeled assets, retain an editable source and export
  instructions.
- Create original geometry and textures from the reference. Do not depend on
  unprovided game assets, unavailable external texture URLs, or absolute paths
  to local attachments.
- Export a self-contained GLB 2.0 with embedded textures, useful mesh/material
  names, sensible scale and pivot, and documented coordinate conventions.
- Prefer standard glTF metallic-roughness PBR. Use sRGB for base color and
  emission; linear data for normal, occlusion, roughness, and metallic maps.
  When packing ORM, use R = occlusion, G = roughness, B = metallic.
- Give different surfaces appropriate roughness and metalness. Use tangent-space
  normals, correct winding, clean UVs, atlas gutters, and consistent texel
  density. Inspect thin faces and fragments for stretched textures.
- Bake fine detail into textures where that is cheaper than geometry. Preserve
  geometry where it affects the silhouette, visible thickness, or structural
  depth. Do not use lighting or bloom to conceal missing model detail.

## Perform five genuine visual iterations

For each numbered pass, export and render the actual model, inspect the images,
compare them with the reference, state a concise critique, and implement a
specific improvement. Inspect the next render to confirm that the change helped.
Five exports without inspection and updates are not five iterations.

| Pass | Primary focus                 | Critique and update                                                                                                                  |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Silhouette and proportions    | Correct the major masses, scale relationships, negative space, and framing.                                                          |
| 2    | Structure                     | Improve thickness, layers, joints, edge treatment, and subject-specific construction.                                                |
| 3    | PBR surfaces                  | Improve material separation, color, roughness, normals, UV scale, and texture repetition.                                            |
| 4    | Character and detail          | Refine the subject's distinctive features; add wear, damage, or small parts only where appropriate. Inspect close-ups for artifacts. |
| 5    | Final polish and optimization | Resolve remaining visual problems, reduce unnecessary cost, and verify the final exported file.                                      |

The focus areas can shift to address what the images actually reveal. After the
fifth critique, make the final corrections and re-export/re-render; do not leave
the last critique as an unimplemented suggestion.

Keep numbered renders and intermediate models in session artifacts or another
non-production output directory. Use comparable framing and lighting where
possible, plus diagnostic close-ups and alternate angles. Retain a five-pass
comparison image and brief critique/update history for the user without adding
all intermediate binaries to the site's deployed assets.

## Keep realtime cost measurable

For a single static asset comparable to the reference ring, start with:

| Metric                            | Starting target                                               |
| --------------------------------- | ------------------------------------------------------------- |
| Triangles                         | At most 15,000                                                |
| Asset draw calls                  | At most 2                                                     |
| GLB download size                 | At most 3 MiB                                                 |
| Texture memory, including mipmaps | At most 20 MiB                                                |
| Texture dimensions                | Up to 2048 for base color; smaller data maps where sufficient |

These are starting targets, not universal limits. Use explicit user/project
budgets when provided. If complexity requires a larger budget, explain the
tradeoff and agree on it rather than silently raising a failing threshold.

- Batch static fragments and repeated details by material; avoid a draw call
  per small piece. Use instancing only when the destination supports it.
- Prefer opaque, backface-culled surfaces where appropriate. Introduce
  transparency, animation, particle systems, and extra materials only when
  needed for the requested appearance.
- Reduce invisible tessellation and choose texture sizes from actual screen
  coverage. Reinspect after quantization, downsampling, or other optimizations.
- Report file bytes separately from decoded GPU memory. For uncompressed RGBA8
  textures, estimate a full mip chain as width x height x 4 x 4/3. Include geometry
  memory separately and state assumptions; compressed downloads are not
  necessarily GPU-compressed textures.
- Avoid requiring Draco, Meshopt, KTX2, or other decoder/transcoder support unless
  the destination supports it and the added complexity is justified.

## Preview and verify

1. Provide a separate local interactive PBR preview when the target does not
   already offer one. Reuse the project's tools and keep preview-only libraries
   out of the production renderer. In this repository, use the native
   [GLB loader](../../../src/engine/gltf/loader.ts) and WebGPU/WebGL2 PBR adapters
   in [the glTF module](../../../src/engine/gltf/), rather than adding Three.js.
   Export the supported static core glTF subset and test both backends.
2. Use neutral environment/key lighting, orbit/pan/zoom, a reference view,
   structural/material close-ups, and wireframe inspection. Render on demand
   while idle; suspend optional auto-orbit when hidden.
3. Run Khronos glTF validation on the final GLB and resolve errors and warnings.
   Check embedded resources, finite attributes, indices, nondegenerate geometry,
   normals/tangents, UV bounds, and material assignments.
4. Decode the embedded textures and independently check dimensions, channels,
   actual mesh counts, file size, and memory estimates against the budget.
   Preserve these checks in focused asset tests where the repository supports
   them.
5. Load the final saved GLB in the browser, not just its source geometry.
   Verify actual draw/triangle counts, visual quality from multiple angles,
   desktop/mobile framing, preview controls, idle behavior, and GPU errors.
   Do not claim measured FPS or device coverage that was not tested.
6. Verify regeneration and run the smallest relevant tests/build checks for
   changed tooling. If the site build copies the asset, verify that its output
   contains the same GLB and that preview dependencies have not entered the
   production bundle.

If rendering or validation is blocked, state what could not be verified. Do not
invent screenshots, critiques, performance measurements, or successful checks.

## Deliver

Provide links to the final GLB, interactive preview, and five-pass comparison.
Summarize the visual features, measured triangle/draw/file/memory costs, completed
checks, and any limitations. Include regeneration instructions and explicitly
state whether the live site scene changed.

## Prior art in this repository

Read only the examples needed for the current asset, and reuse their patterns
without copying the ring-specific geometry:

- [Asset contract and iteration history](../../../README.md#broken-space-ring-asset)
- [Deterministic GLB builder and validator](../../../scripts/build-broken-ring.mjs)
- [Binary, PBR, and budget tests](../../../scripts/build-broken-ring.test.mjs)
- [Interactive preview page](../../../tools/broken-ring.html)
- [Native PBR preview implementation](../../../tools/broken-ring-preview.ts)
- [Shared geometry helpers](../../../src/engine/gltf/mesh.mjs)
- [Measured asset metrics](../../../public/models/broken-ring.metrics.json)

Example invocation with attached reference images:

```text
/create-3d-model Make a weathered sci-fi satellite from these references.
Use PBR materials and keep it suitable for realtime rendering on this site.
```
