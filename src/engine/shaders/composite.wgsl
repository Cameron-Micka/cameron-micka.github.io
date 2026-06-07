// Composite / post pass. Samples the HDR scene, adds a cheap multi-tap bloom,
// applies ACES tonemapping, chromatic aberration, vignette, and an optional
// gaussian blur used to freeze-blur the scene behind the POI modal.
struct Post {
  params : vec4<f32>,   // x=blur(0..1) y=vignette z=caAmount w=bloomStrength
  texel : vec4<f32>,    // xy = 1/resolution
  flare : vec4<f32>,    // xy = sun screen uv, z = strength(0..1), w = aspect(w/h)
};
@group(0) @binding(0) var<uniform> post : Post;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var sceneTex : texture_2d<f32>;

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

fn aces(x : vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn sampleScene(uv : vec2<f32>) -> vec3<f32> {
  return textureSample(sceneTex, samp, clamp(uv, vec2<f32>(0.001), vec2<f32>(0.999))).rgb;
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
    let lum = dot(sampleScene(coord), vec3<f32>(0.2126, 0.7152, 0.0722));
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
// radius.
fn bloom(uv : vec2<f32>) -> vec3<f32> {
  var acc = vec3<f32>(0.0);
  var wsum = 0.0;
  let step = post.texel.xy * 2.0;
  for (var i = -2; i <= 2; i = i + 1) {
    for (var j = -2; j <= 2; j = j + 1) {
      let o = vec2<f32>(f32(i), f32(j));
      // sigma ~1.3 taps; weights at radius 2 are ~exp(-0.59) = 0.55 of
      // center, so the kernel fills its support cleanly.
      let w = exp(-dot(o, o) * 0.30);
      let s = sampleScene(uv + o * step);
      let bright = max(s - vec3<f32>(0.7), vec3<f32>(0.0));
      acc = acc + bright * w;
      wsum = wsum + w;
    }
  }
  return acc / wsum;
}

// Wide gaussian-ish blur for the frozen modal backdrop. Uses a 13x13 kernel
// at ~2.5-texel spacing so adjacent taps' bilinear footprints overlap. Wider
// or sparser kernels leave discrete bright "ghost dots" of every specular
// highlight in the source, since each tap samples the HDR scene directly.
// Sample offsets are nudged by 0.5 of a step so each tap lands between two
// texels and benefits from bilinear filtering.
fn blurScene(uv : vec2<f32>, amount : f32) -> vec3<f32> {
  var acc = vec3<f32>(0.0);
  var wsum = 0.0;
  let r = post.texel.xy * 2.5 * amount;
  for (var i = -6; i <= 6; i = i + 1) {
    for (var j = -6; j <= 6; j = j + 1) {
      let o = vec2<f32>(f32(i) + 0.5, f32(j) + 0.5);
      // sigma ~3.2 taps so the bell rolls off well inside the loop bounds.
      let w = exp(-dot(o, o) * 0.05);
      acc = acc + sampleScene(uv + o * r) * w;
      wsum = wsum + w;
    }
  }
  return acc / wsum;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let blurAmt = post.params.x;
  let caAmt = post.params.z;

  var scene : vec3<f32>;
  if (blurAmt > 0.001) {
    scene = blurScene(uv, blurAmt);
  } else {
    if (caAmt > 0.00001) {
      // Chromatic aberration: offset channels radially from center.
      let dir = uv - vec2<f32>(0.5);
      let ca = dir * caAmt;
      let rC = sampleScene(uv + ca).r;
      let gC = sampleScene(uv).g;
      let bC = sampleScene(uv - ca).b;
      scene = vec3<f32>(rC, gC, bC);
    } else {
      scene = sampleScene(uv);
    }
  }

  var col = scene;
  if (post.params.w > 0.001) {
    col = col + bloom(uv) * post.params.w;
  }
  col = col + sunFlare(uv);
  col = col + godRays(uv);
  var mapped = aces(col);

  if (post.params.y > 0.001) {
    // Vignette.
    let d = distance(uv, vec2<f32>(0.5));
    let vig = 1.0 - post.params.y * smoothstep(0.35, 0.85, d);
    mapped = mapped * vig;
  }

  // Dim the frozen backdrop a touch so the modal pops.
  mapped = mapped * (1.0 - 0.25 * blurAmt);

  return vec4<f32>(pow(mapped, vec3<f32>(1.0 / 2.2)), 1.0);
}
