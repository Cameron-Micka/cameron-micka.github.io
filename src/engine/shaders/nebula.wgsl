// Fullscreen volumetric nebula backdrop. Drawn first into the HDR target with
// no depth. Ray-marches a slowly evolving 3D fbm density field in screen space
// to produce billowing clouds with a warm core and cool periphery — inspired
// by https://www.shadertoy.com/view/wX2Bzy.
struct Frame {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  keyLightDir : vec4<f32>,
  misc : vec4<f32>,
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

fn fbm3(p : vec3<f32>) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 4; i = i + 1) {
    v = v + a * vnoise3(q);
    q = q * 2.03;
    a = a * 0.5;
  }
  return v;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let aspect = frame.misc.w;
  // Aspect-corrected centered UV with a slight upward bias so the warm core
  // sits near where the focused planet typically lives on screen.
  let uv = vec2<f32>((in.uv.x - 0.5) * aspect, in.uv.y - 0.48);
  let tt = frame.misc.x;
  // Two slightly different speeds let the field both drift sideways and
  // evolve in depth so the clouds look alive without distracting motion.
  let time = tt * 0.08;
  let drift = vec2<f32>(tt * 0.012, tt * -0.006);

  // Volumetric march through a screen-space density field. The "ray" is
  // synthetic — we just want billowy depth, not a physically accurate volume.
  let ro = vec3<f32>(0.0, 0.0, -1.4);
  let rd = normalize(vec3<f32>(uv.x, uv.y, 1.2));

  let warm = vec3<f32>(0.55, 0.30, 0.10);
  let glow = vec3<f32>(0.70, 0.42, 0.16);
  let cool = vec3<f32>(0.04, 0.06, 0.14);
  let deep = vec3<f32>(0.008, 0.014, 0.035);

  // Per-pixel jitter to break up stepping bands.
  let jitter = hash21(in.pos.xy) * 0.10;
  var t = 0.45 + jitter;
  var col = vec3<f32>(0.0);
  var alpha = 0.0;
  for (var i = 0; i < 28; i = i + 1) {
    let p = ro + rd * t;
    let n = fbm3(p * 1.05 + vec3<f32>(drift.x, drift.y, time));
    // Soft billow carving — leaves airy gaps without sharp edges.
    let dens = smoothstep(0.46, 0.78, n);
    let rad = length(p.xy);
    let coreFade = exp(-rad * 0.60);
    let density = dens * (0.35 + 0.95 * coreFade);

    // Warmth peaks near the core line, with hotter highlights where density
    // is highest (mimics a star illuminating the surrounding nebula).
    let warmth = coreFade * (0.35 + 0.65 * smoothstep(0.5, 0.85, n));
    var samp = mix(cool, warm, clamp(warmth, 0.0, 1.0));
    samp = mix(samp, glow, smoothstep(0.72, 1.0, n) * coreFade * 0.65);

    let inc = density * 0.14;
    col = col + samp * inc * (1.0 - alpha);
    alpha = alpha + inc * (1.0 - alpha);

    if (alpha > 0.97) { break; }
    t = t + 0.10 + t * 0.020;
  }

  // Deep background fills the corners with dark navy.
  let bgRad = length(uv);
  let bg = mix(deep, cool * 0.55, smoothstep(0.0, 1.4, bgRad));
  col = col + bg * (1.0 - alpha);

  // Soft corner vignette to keep edges quiet.
  let vig = 1.0 - 0.35 * smoothstep(0.6, 1.4, length(uv));
  col = col * vig;
  return vec4<f32>(col, 1.0);
}
