# Native GLB rendering

The dependency-free glTF/GLB loader and WebGPU/WebGL2 adapters used for static models.

[src/engine/gltf/](../src/engine/gltf/) is a small, dependency-free static-model
rendering module shared by the local asset preview and the site's ring worlds.
It does not introduce a scene framework or replace the timeline's renderer.
The model generator also uses its [mesh helpers](../src/engine/gltf/mesh.mjs) for
normals, tangent frames, and bounds, without a browser or GPU dependency.

## Supported glTF subset

The [loader](../src/engine/gltf/loader.ts) exposes `loadGlb(url, options)` for fetched
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

## Host-renderer integration

The two adapters consume the same [asset and frame types](../src/engine/gltf/types.ts):

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

For shader control, edit [gltf.frag.glsl](../src/engine/shaders/gltf.frag.glsl)
and [gltf.vert.glsl](../src/engine/shaders/gltf.vert.glsl) for WebGL2, and
[gltf.wgsl](../src/engine/shaders/gltf.wgsl) for WebGPU. The shared
[uniform packing](../src/engine/gltf/rendererShared.ts) is the contract between
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

The [native preview](../tools/broken-ring-preview.ts) demonstrates
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
