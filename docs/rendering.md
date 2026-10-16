# Rendering backends & quality

Renderer selection, quality tiers, HDR, atmospheres, and measured performance.

## Renderer selection

Auto renderer uses WebGL2 on iOS/iPadOS and macOS. On other platforms, WebGPU is
used when available (two-step adapter+device probe); otherwise the app falls
back to WebGL2. Users can explicitly select WebGPU or WebGL in settings on any
platform. WebGL runs without a compatibility notice.

## Adaptive quality

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

## On-demand rendering

Paused motion renders on demand: once the camera settles, an unchanged scene
does not rebuild instances or submit GPU work. Dragging, travel, resizing,
quality changes, and other visual settings still invalidate the frame. The
Auto ramp samples animated frames only, so idle time cannot promote quality.
Motion is controlled with the pause/resume button beside the camera control,
not in Settings. By default, motion follows OS reduced-motion preferences and
responds to changes without a reload.

## Quality tiers

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

## HDR pipeline

WebGL2 uses the same linear HDR composition, ACES tone mapping, gamma encoding,
bloom, lens effects, vignette, and modal blur as WebGPU when
`EXT_color_buffer_float` is available. It prefers packed `R11F_G11F_B10F`, matching
WebGPU's optional `rg11b10ufloat` format, with a validated `RGBA16F` fallback.
Medium/High MSAA uses the highest common color/depth sample count up to 4;
devices without float MSAA use a single-sample HDR target. Low renders directly
into its scene texture without an MSAA resolve. If HDR targets are unavailable
or incomplete, rendering falls back to RGBA8 with per-material tone mapping,
which cannot preserve the same HDR highlights.

## Atmospheres

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

## Shader cost savings

Both surface shaders also skip polar-ice noise outside the mathematically
possible ice region, avoiding work on large equatorial areas without changing
terrain detail or render resolution.
Dry planets and moons skip ocean-glitter calculations behind a uniform ocean
flag, keeping screen-space derivatives valid. Ordinary specular lighting and
the wet-surface calculations are unchanged.

## Performance

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
