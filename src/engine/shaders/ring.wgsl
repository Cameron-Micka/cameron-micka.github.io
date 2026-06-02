// Planetary ring. A flat annulus mesh oriented by the object model matrix.
// Bands are curved by angular sin modulation (after https://www.shadertoy.com/view/wsfXDl)
// and broken up with layered fBm + Cassini-style gaps so the ring reads as
// organic dust and ice rather than concentric stripes.
struct Frame {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  keyLightDir : vec4<f32>,
  misc : vec4<f32>,
  shadowSpheres : array<vec4<f32>, 8>,
  shadowMisc : vec4<f32>,
};
struct Obj {
  model : mat4x4<f32>,
  p0 : vec4<f32>,
  palLow : vec4<f32>,
  palMid : vec4<f32>,
  palHigh : vec4<f32>,
  p1 : vec4<f32>,
};
@group(0) @binding(0) var<uniform> frame : Frame;
@group(1) @binding(0) var<uniform> obj : Obj;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) radial : f32, // 0 inner .. 1 outer
  @location(1) angle : f32,  // 0..2π around the ring
  @location(2) worldPos : vec3<f32>,
};

@vertex
fn vs(
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv : vec2<f32>,
) -> VSOut {
  var out : VSOut;
  let world = obj.model * vec4<f32>(position, 1.0);
  out.pos = frame.viewProj * world;
  out.radial = uv.x;
  out.angle = uv.y * 6.2831853;
  out.worldPos = world.xyz;
  return out;
}

fn hash2(p : vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn vnoise2(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i), hash2(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash2(i + vec2<f32>(0.0, 1.0)), hash2(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y,
  );
}

fn fbm2(p : vec2<f32>) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 4; i = i + 1) {
    v = v + a * vnoise2(q);
    q = q * 2.03;
    a = a * 0.5;
  }
  return v;
}

// Analytic shadow factor against the frame's sphere occluder list. Returns
// 1.0 unshadowed, 0.0 fully shadowed; ~5% radial penumbra band.
fn shadowFactor(p : vec3<f32>, L : vec3<f32>) -> f32 {
  var s = 1.0;
  let cnt = i32(frame.shadowMisc.x);
  for (var i = 0; i < 8; i = i + 1) {
    if (i >= cnt) { break; }
    let sph = frame.shadowSpheres[i];
    let d = sph.xyz - p;
    let t = dot(d, L);
    if (t <= 0.0) { continue; }
    let c2 = dot(d, d) - t * t;
    let R = sph.w;
    let R2 = R * R;
    s = s * smoothstep(R2, R2 * 1.10, c2);
  }
  return s;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let radial = in.radial;
  let angle = in.angle;
  let time = frame.misc.x;
  let seed = obj.p0.y;

  // Per-planet variation so every ringed planet looks distinct (band count,
  // gap pattern, visible inner/outer width). Cheap sin-hash from the seed.
  let h1 = fract(sin(seed * 0.937 + 1.0) * 43758.5);
  let h2 = fract(sin(seed * 0.357 + 2.5) * 21758.3);
  let h3 = fract(sin(seed * 0.713 + 5.7) * 7853.7);
  let h4 = fract(sin(seed * 0.521 + 8.2) * 51247.7);

  let bandFreqBroad = 70.0 + h1 * 70.0;     // 70..140 bands
  let gap1Freq = 5.0 + h2 * 9.0;            // 5..14
  let gap2Freq = 12.0 + h3 * 11.0;          // 12..23
  let gap2Phase = h4 * 6.2831853;

  // Soft inner/outer edge falloff, with per-planet width so some rings sit
  // close to the planet while others stretch wider.
  let innerBroad = 0.02 + h2 * 0.18;        // 0.02..0.20
  let outerBroad = 0.82 + h3 * 0.12;        // 0.82..0.94

  // "Thin ring" style: narrow band hugging the planet with only ~3 visible
  // stripes. Selected per-planet via obj.p1.w (set when thinRing=true).
  let isThin = obj.p1.w;
  let bandFreq = mix(bandFreqBroad, 115.0, isThin);
  let innerStart = mix(innerBroad, 0.55, isThin);
  let outerEnd = mix(outerBroad, 0.76, isThin);
  // Broad rings keep the original wide soft fade to the geometry edge; thin
  // rings use a tight 0.06-wide outer fade so the band actually reads narrow.
  let outerFadeStart = mix(1.0, outerEnd + 0.06, isThin);
  let edge = smoothstep(innerStart, innerStart + 0.06, radial) *
             smoothstep(outerFadeStart, outerEnd, radial);

  // Curved bands: cosine in radial with a very small angular sine offset so
  // the rings stay essentially concentric, just enough imperfection to avoid
  // looking machined.
  let bands = 0.5 + 0.5 * cos(radial * bandFreq - 0.6 * sin(angle * 7.0 + time * 0.03));

  // Layered fBm noise sampled in (radial, angle) so it stays seamless around
  // the loop. Drives fine dust/clump variation independent of the bands.
  let np = vec2<f32>(radial * 22.0, angle * 3.2);
  let n = fbm2(np) * 0.65 + fbm2(np * 2.7 + vec2<f32>(11.0, 5.0)) * 0.35;

  // Combine curved bands with noise, but weight the bands heavily so the
  // fine ring stripes stay crisp instead of being smeared by fbm.
  let density = smoothstep(0.20, 0.85, bands * 0.85 + n * 0.35);

  // Cassini-style gaps cut a couple of transparent slots into the disk.
  let g1 = smoothstep(0.88, 0.95, 0.5 + 0.5 * sin(radial * gap1Freq + h2 * 6.28));
  let g2 = smoothstep(0.92, 0.97, 0.5 + 0.5 * sin(radial * gap2Freq + gap2Phase));
  let gap = clamp(g1 + g2 * 0.7, 0.0, 1.0);
  let opaq = max(0.0, density - gap * 0.85);

  let a = edge * (0.18 + 0.55 * opaq) * (0.5 + 0.5 * obj.p1.x);
  let baseCol = mix(obj.palMid.rgb * 0.75, obj.palHigh.rgb, smoothstep(0.2, 0.85, density));
  // Planet shadow on the ring: dim the color (keep alpha so the silhouette
  // stays the same). Sun direction (L) points from receiver toward the sun.
  let shadow = shadowFactor(in.worldPos, normalize(frame.keyLightDir.xyz));
  let col = baseCol * mix(0.18, 1.0, shadow);
  // Distance fog: attenuate both colour and alpha so distant rings fade into
  // the nebula instead of stamping silhouettes over far-off planets.
  let d = distance(in.worldPos, frame.cameraPos.xyz);
  let s = d * 0.030;
  let fade = exp(-s * s);
  return vec4<f32>(col * a * 1.4 * fade, a * fade);
}
