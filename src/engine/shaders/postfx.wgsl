// Half-resolution post-effects. Everything here is a wide, low-frequency
// filter with a high tap count — bloom (25 taps), god rays (64 taps) and the
// modal freeze-blur (49 taps). Run at native resolution they dominate frame
// time on fill-rate limited GPUs; run at a fraction of native they cost almost
// nothing and look identical, because none of them carry high-frequency detail.
//
// Two entry points share this module (and one bind group layout):
//   fs_down — box-downsamples the HDR scene into the FX-resolution source.
//   fs_fx   — reads that source and produces the composited effect layer,
//             which the final full-resolution composite pass adds (or, while
//             the modal freeze-blur is active, uses directly as the scene).
struct Post {
  params : vec4<f32>,   // x=blur(0..1) y=vignette z=caAmount w=bloomStrength
  texel : vec4<f32>,    // xy = 1/scene resolution, zw = 1/fx resolution
  flare : vec4<f32>,    // xy = sun screen uv, z = strength(0..1), w = aspect(w/h)
  misc : vec4<f32>,     // x = fx layer enabled (0/1)
};
@group(0) @binding(0) var<uniform> post : Post;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var srcTex : texture_2d<f32>;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(3.0, 1.0),
  );
  var out : VSOut;
  let xy = p[vi];
  out.pos = vec4<f32>(xy, 0.0, 1.0);
  out.uv = vec2<f32>(xy.x, -xy.y) * 0.5 + vec2<f32>(0.5);
  return out;
}

fn sampleSrc(uv : vec2<f32>) -> vec3<f32> {
  return textureSample(srcTex, samp, clamp(uv, vec2<f32>(0.001), vec2<f32>(0.999))).rgb;
}

// Four bilinear taps at the corners of the destination texel. The scene can be
// several times larger than the FX target, so a single tap would alias bright
// pixels in and out and make the bloom crawl as the camera moves.
@fragment
fn fs_down(in : VSOut) -> @location(0) vec4<f32> {
  let o = post.texel.zw * 0.25;
  let acc =
    sampleSrc(in.uv + vec2<f32>(-o.x, -o.y)) +
    sampleSrc(in.uv + vec2<f32>(o.x, -o.y)) +
    sampleSrc(in.uv + vec2<f32>(-o.x, o.y)) +
    sampleSrc(in.uv + vec2<f32>(o.x, o.y));
  return vec4<f32>(acc * 0.25, 1.0);
}

// Deep-space lens flare adapted from mu6k's classic Shadertoy (4sX3Rs): a
// chain of chromatic ghost discs marching from the light through screen centre,
// and faint reflection halos. The per-channel offset of the ghosts/halos
// produces the rainbow prism fringing. uv and pos are centred, aspect-corrected
// screen coords.
fn lensflare(uv : vec2<f32>, pos : vec2<f32>) -> vec3<f32> {
  let uvd = uv * length(uv);

  let f2v = uvd + 0.8 * pos;
  let f2 = max(1.0 / (1.0 + 32.0 * dot(f2v, f2v)), 0.0) * 0.25;
  let f22v = uvd + 0.85 * pos;
  let f22 = max(1.0 / (1.0 + 32.0 * dot(f22v, f22v)), 0.0) * 0.23;
  let f23v = uvd + 0.9 * pos;
  let f23 = max(1.0 / (1.0 + 32.0 * dot(f23v, f23v)), 0.0) * 0.21;

  var uvx = mix(uv, uvd, -0.5);
  let f4 = max(0.01 - pow(length(uvx + 0.4 * pos), 2.4), 0.0) * 6.0;
  let f42 = max(0.01 - pow(length(uvx + 0.45 * pos), 2.4), 0.0) * 5.0;
  let f43 = max(0.01 - pow(length(uvx + 0.5 * pos), 2.4), 0.0) * 3.0;

  uvx = mix(uv, uvd, -0.4);
  let f5 = max(0.01 - pow(length(uvx + 0.2 * pos), 5.5), 0.0) * 2.0;
  let f52 = max(0.01 - pow(length(uvx + 0.4 * pos), 5.5), 0.0) * 2.0;
  let f53 = max(0.01 - pow(length(uvx + 0.6 * pos), 5.5), 0.0) * 2.0;

  uvx = mix(uv, uvd, -0.5);
  let f6 = max(0.01 - pow(length(uvx - 0.3 * pos), 1.6), 0.0) * 6.0;
  let f62 = max(0.01 - pow(length(uvx - 0.325 * pos), 1.6), 0.0) * 3.0;
  let f63 = max(0.01 - pow(length(uvx - 0.35 * pos), 1.6), 0.0) * 5.0;

  var c = vec3<f32>(
    f2 + f4 + f5 + f6,
    f22 + f42 + f52 + f62,
    f23 + f43 + f53 + f63,
  );
  c = c * 1.3 - vec3<f32>(length(uvd) * 0.05);
  return max(c, vec3<f32>(0.0));
}

// Tints, scales by sun visibility and composes the lens flare. The warm-blue
// tint reads as a cinematic deep-space flare; kept gentle so it augments the
// sun without washing the scene.
fn sunFlare(uv : vec2<f32>) -> vec3<f32> {
  let strength = post.flare.z;
  if (strength <= 0.001) {
    return vec3<f32>(0.0);
  }
  let aspect = post.flare.w;
  let scale = 1.6;
  let cuv = (uv - vec2<f32>(0.5)) * vec2<f32>(aspect, 1.0) * scale;
  let cpos = (post.flare.xy - vec2<f32>(0.5)) * vec2<f32>(aspect, 1.0) * scale;
  let lf = lensflare(cuv, cpos) * vec3<f32>(1.4, 1.2, 1.0);
  return lf * strength * 0.5;
}

// Crepuscular rays (god rays) via GPU Gems 3 ch.13 volumetric light-scattering
// post-process: march from each pixel toward the sun's screen position,
// accumulating the bright (sun) part of the HDR scene with exponential decay.
// Planets in front of the sun read dark here, carving the shadow gaps between
// rays. Gated by the same occlusion-aware sun strength as the lens flare.
fn godRays(uv : vec2<f32>) -> vec3<f32> {
  let strength = post.flare.z;
  if (strength <= 0.001) {
    return vec3<f32>(0.0);
  }
  let NUM = 64;
  let density = 0.6;
  let decay = 0.96;
  let exposure = 0.016;
  let delta = (uv - post.flare.xy) * (density / f32(NUM));
  var coord = uv;
  var illum = 1.0;
  var acc = 0.0;
  for (var i = 0; i < NUM; i = i + 1) {
    coord = coord - delta;
    // Bounded "is this the sun" mask rather than raw HDR brightness, so a very
    // bright sun can't blow the rays out to a full-screen white wash.
    let lum = dot(sampleSrc(coord), vec3<f32>(0.2126, 0.7152, 0.0722));
    let m = clamp((lum - 0.85) * 3.0, 0.0, 1.0);
    acc = acc + m * illum;
    illum = illum * decay;
  }
  return vec3<f32>(acc) * (exposure * strength) * vec3<f32>(1.0, 0.92, 0.78);
}

// Cheap bloom: threshold bright areas across a small Gaussian-weighted disk
// of taps. A 5x5 grid (25 taps) with Gaussian weights produces a smooth
// filled blur instead of the hollow ring artifact a single-ring kernel
// leaves around small bright sources (e.g. the lit limb of a far-away
// planet's atmosphere). Each bright HDR pixel must contribute to a disk,
// not a hollow circle, or you see its silhouette echoed at the kernel
// radius. Offsets are in FX texels, which already span several scene pixels.
fn bloom(uv : vec2<f32>) -> vec3<f32> {
  var acc = vec3<f32>(0.0);
  var wsum = 0.0;
  let step = post.texel.zw;
  for (var i = -2; i <= 2; i = i + 1) {
    for (var j = -2; j <= 2; j = j + 1) {
      let o = vec2<f32>(f32(i), f32(j));
      // sigma ~1.3 taps; weights at radius 2 are ~exp(-0.59) = 0.55 of
      // center, so the kernel fills its support cleanly.
      let w = exp(-dot(o, o) * 0.30);
      let s = sampleSrc(uv + o * step);
      let bright = max(s - vec3<f32>(0.7), vec3<f32>(0.0));
      acc = acc + bright * w;
      wsum = wsum + w;
    }
  }
  return acc / wsum;
}

// Wide gaussian-ish blur for the frozen modal backdrop. A 7x7 kernel over the
// already-downsampled source covers the same screen-space radius the old
// full-resolution 13x13 kernel did, for a fraction of the taps. Offsets are
// nudged by 0.5 of a step so each tap lands between two texels and benefits
// from bilinear filtering.
fn blurScene(uv : vec2<f32>, amount : f32) -> vec3<f32> {
  var acc = vec3<f32>(0.0);
  var wsum = 0.0;
  let r = post.texel.zw * 2.2 * amount;
  for (var i = -3; i <= 3; i = i + 1) {
    for (var j = -3; j <= 3; j = j + 1) {
      let o = vec2<f32>(f32(i) + 0.5, f32(j) + 0.5);
      // sigma ~1.8 taps so the bell rolls off well inside the loop bounds.
      let w = exp(-dot(o, o) * 0.16);
      acc = acc + sampleSrc(uv + o * r) * w;
      wsum = wsum + w;
    }
  }
  return acc / wsum;
}

@fragment
fn fs_fx(in : VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let blurAmt = post.params.x;

  // While the modal freeze-blur is active this layer carries the whole scene
  // (blurred) rather than an additive overlay, so the composite pass never has
  // to run a wide kernel at native resolution.
  var col = vec3<f32>(0.0);
  if (blurAmt > 0.001) {
    col = blurScene(uv, blurAmt);
  }
  if (post.params.w > 0.001) {
    col = col + bloom(uv) * post.params.w;
  }
  col = col + sunFlare(uv);
  col = col + godRays(uv);
  return vec4<f32>(col, 1.0);
}
