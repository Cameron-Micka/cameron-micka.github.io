// Fullscreen volumetric nebula backdrop. Drawn first into the HDR target with
// no depth. Ray-marches a slowly evolving 3D fbm density field along the
// WORLD-space view ray (unprojected per-pixel from invViewProj) so the
// nebula stays locked to the world as the camera rotates / translates —
// behaves like a skybox at infinity. Inspired by
// https://www.shadertoy.com/view/wX2Bzy.
struct Frame {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  keyLightDir : vec4<f32>,
  misc : vec4<f32>,
  shadowCasters : array<vec4<f32>, 8>,
  shadowMisc : vec4<f32>,
  invViewProj : mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> frame : Frame;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  // Single oversized triangle covering the screen.
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(3.0, 1.0),
  );
  var out : VSOut;
  let xy = p[vi];
  out.pos = vec4<f32>(xy, 1.0, 1.0);
  out.uv = xy * 0.5 + vec2<f32>(0.5);
  return out;
}

fn hash21(p : vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn hash3(p : vec3<f32>) -> f32 {
  var q = fract(p * 0.3183099 + vec3<f32>(0.1, 0.2, 0.3));
  q = q * 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
}

fn vnoise3(x : vec3<f32>) -> f32 {
  let i = floor(x);
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash3(i);
  let n100 = hash3(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash3(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash3(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash3(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash3(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash3(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash3(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z,
  );
}

fn fbm3(p : vec3<f32>, oct : i32) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < oct; i = i + 1) {
    v = v + a * vnoise3(q);
    q = q * 2.03;
    a = a * 0.5;
  }
  return v;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  // Reconstruct a world-space view direction for this pixel. Using the
  // difference of two unprojected points (near vs far at the same NDC.xy)
  // gives a direction that's invariant to camera translation — so the
  // nebula doesn't slide around as the camera flies through the scene.
  let ndc = vec2<f32>(in.uv.x * 2.0 - 1.0, in.uv.y * 2.0 - 1.0);
  let nearH = frame.invViewProj * vec4<f32>(ndc, 0.0, 1.0);
  let farH = frame.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
  let dirW = normalize(farH.xyz / farH.w - nearH.xyz / nearH.w);

  // Anchor the warm core to a fixed world-space direction (slightly above
  // the -Z timeline forward) so it looks like a real distant feature rather
  // than glow that follows the lens.
  let coreDir = normalize(vec3<f32>(0.0, 0.20, -1.0));
  // Chord length between two unit vectors: 0 when aligned, up to 2 at
  // antipode. Cheap proxy for angular distance, plenty for falloff weighting.
  let rad = length(dirW - coreDir);

  let tt = frame.misc.x;
  // Two slightly different speeds let the field both drift sideways and
  // evolve in depth so the clouds look alive without distracting motion.
  let time = tt * 0.08;
  let drift = vec3<f32>(tt * 0.012, tt * -0.006, time);

  // Skybox-style march: origin at world 0, ray = world-space view direction.
  // Position doesn't enter the equation so camera translation is invisible;
  // only orientation changes the sampled slice of the field.
  let ro = vec3<f32>(0.0);
  let rd = dirW;

  let warm = vec3<f32>(0.55, 0.30, 0.10);
  let glow = vec3<f32>(0.70, 0.42, 0.16);
  let cool = vec3<f32>(0.04, 0.06, 0.14);
  let deep = vec3<f32>(0.008, 0.014, 0.035);

  // Per-pixel jitter to break up stepping bands.
  let jitter = hash21(in.pos.xy) * 0.10;
  var t = 0.45 + jitter;
  var col = vec3<f32>(0.0);
  var alpha = 0.0;
  // The nebula is the only shader that covers every pixel on every tier, so its
  // raymarch dominates fragment cost on the low tier (no post-processing there).
  // On low, halve the step count and drop one fbm octave; the larger steps and
  // coarser field are barely perceptible on a backdrop but roughly halve the
  // per-pixel work — the single biggest low-tier win on macOS (Metal/Dawn).
  let low = frame.shadowMisc.y > 0.5;
  let steps = select(28, 14, low);
  let stepLen = select(0.10, 0.20, low);
  let oct = select(4, 3, low);
  // Each low step covers ~2x the depth, so weight its contribution ~2x to keep
  // the integrated brightness close to the high-tier march.
  let incScale = select(1.0, 1.9, low);
  for (var i = 0; i < steps; i = i + 1) {
    let p = ro + rd * t;
    let n = fbm3(p * 1.05 + drift, oct);
    // Soft billow carving — leaves airy gaps without sharp edges.
    let dens = smoothstep(0.46, 0.78, n);
    let coreFade = exp(-rad * 1.10);
    let density = dens * (0.35 + 0.95 * coreFade);

    // Warmth peaks near the core direction, with hotter highlights where
    // density is highest (mimics a star illuminating the surrounding nebula).
    let warmth = coreFade * (0.35 + 0.65 * smoothstep(0.5, 0.85, n));
    var samp = mix(cool, warm, clamp(warmth, 0.0, 1.0));
    samp = mix(samp, glow, smoothstep(0.72, 1.0, n) * coreFade * 0.65);

    let inc = density * 0.14 * incScale;
    col = col + samp * inc * (1.0 - alpha);
    alpha = alpha + inc * (1.0 - alpha);

    if (alpha > 0.97) { break; }
    t = t + stepLen + t * 0.020;
  }

  // Deep background fills the periphery (away from coreDir) with dark navy.
  let bg = mix(deep, cool * 0.55, smoothstep(0.0, 1.4, rad));
  col = col + bg * (1.0 - alpha);

  // Soft vignette anchored to the world-space core direction.
  let vig = 1.0 - 0.35 * smoothstep(0.6, 1.4, rad);
  col = col * vig;
  return vec4<f32>(col, 1.0);
}
