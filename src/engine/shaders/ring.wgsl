// Planetary ring. A flat annulus mesh oriented by the object model matrix.
// Radial ice/dust ringlets, C/B/A density zones and two-sided particle lighting.
// Keep the material in sync with RING_FRAG in WebGL2Renderer.ts.
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
  out.worldPos = world.xyz;
  return out;
}

fn hash1(p : f32) -> f32 {
  return fract(sin(p * 127.1) * 43758.5453);
}

fn radialNoise(p : f32) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(hash1(i), hash1(i + 1.0), u);
}

// Fade each octave to its mean before it becomes subpixel. Radial-only
// sampling keeps the ringlets circular and avoids an angular UV seam.
fn ringlets(t : f32, width : f32, seed : f32) -> f32 {
  var v = 0.0;
  var amplitude = 0.5;
  var frequency = 24.0;
  for (var i = 0; i < 4; i = i + 1) {
    let contrast = 1.0 - smoothstep(0.20, 0.65, frequency * width);
    v += amplitude * mix(0.5, radialNoise(t * frequency + seed + f32(i) * 19.0), contrast);
    frequency *= 3.0;
    amplitude *= 0.5;
  }
  return v / 0.9375;
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

// Local anti-aliasing for a thresholded signal. Widens the smoothstep
// transition by the signal's screen-space derivative `w` (= fwidth(x)) so the
// edge is always ~1px wide — this band-limits the ring's high-frequency bands,
// gaps and silhouette at distance/grazing angles. Reduces to the plain
// smoothstep up close where the footprint vanishes. Handles ascending
// (e0 < e1) and descending (e0 > e1) edges, widening outward in both.
fn aaStep(e0 : f32, e1 : f32, x : f32, w : f32) -> f32 {
  if (e0 <= e1) {
    return smoothstep(e0 - w, e1 + w, x);
  }
  return 1.0 - smoothstep(e1 - w, e0 + w, x);
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let radial = in.radial;
  let seed = obj.p0.y;

  // Per-planet variation so every ringed planet looks distinct (band count,
  // gap pattern, visible inner/outer width). Cheap sin-hash from the seed.
  let h1 = fract(sin(seed * 0.937 + 1.0) * 43758.5);
  let h2 = fract(sin(seed * 0.357 + 2.5) * 21758.3);
  let h3 = fract(sin(seed * 0.713 + 5.7) * 7853.7);
  let h4 = fract(sin(seed * 0.521 + 8.2) * 51247.7);

  // Soft inner/outer edge falloff, with per-planet width so some rings sit
  // close to the planet while others stretch wider.
  let innerBroad = 0.02 + h2 * 0.18;        // 0.02..0.20
  let outerBroad = 0.82 + h3 * 0.12;        // 0.82..0.94

  // "Thin ring" style: three distinct ringlets within a narrow envelope.
  // Selected per-planet via obj.p1.w (set when thinRing=true).
  let isThin = obj.p1.w;
  let innerStart = mix(innerBroad, 0.48, isThin);
  let outerEnd = mix(outerBroad, 0.76, isThin);
  // Thin rings taper inside their envelope; broad rings retain the dusty halo.
  let edgeWidth = mix(0.06, 0.025, isThin);
  let outerFadeStart = mix(1.0, outerEnd, isThin);
  let outerFadeEnd = mix(outerEnd, outerEnd - edgeWidth, isThin);
  // Screen-space footprint of the radial coordinate; drives local AA on every
  // radial threshold below so thin bands/edges don't shimmer when the ring is
  // far away or seen near edge-on.
  let rw = fwidth(radial);
  let edge = aaStep(innerStart, innerStart + edgeWidth, radial, rw) *
             aaStep(outerFadeStart, outerFadeEnd, radial, rw);

  // Saturn's macro structure: the disk is not a uniform sheet but a small
  // number of distinct radial zones — a faint inner C ring, the bright dense
  // B ring, the near-empty Cassini Division, then the medium A ring with the
  // narrow Encke gap cut near its outer edge. `t` is the position across the
  // visible span so the layout scales with each planet's inner/outer width,
  // and each boundary is jittered by the seed so no two rings match exactly.
  let span = max(outerEnd - innerStart, 1e-3);
  let t = clamp((radial - innerStart) / span, 0.0, 1.0);
  let tw = rw / span;
  let cEnd = 0.24 + h1 * 0.06;                 // C ring -> B ring
  let bEnd = 0.54 + h2 * 0.05;                 // B ring -> Cassini Division
  let divEnd = bEnd + 0.05 + h3 * 0.03;        // Division -> A ring
  let aEnd = 0.96;                             // outer edge of the A ring
  var st = 0.22;                               // faint, translucent C ring
  st = mix(st, 1.00, aaStep(cEnd, cEnd + 0.03, t, tw));       // dense B ring
  st = mix(st, 0.015, aaStep(bEnd, bEnd + 0.012, t, tw));     // Cassini Division
  st = mix(st, 0.72, aaStep(divEnd, divEnd + 0.012, t, tw));  // A ring
  st = mix(st, 0.00, aaStep(aEnd, aEnd + 0.02, t, tw));       // beyond A: empty
  // Encke gap: a single hairline slot inside the outer third of the A ring.
  let encke = divEnd + (aEnd - divEnd) * (0.68 + h4 * 0.10);
  let enckeSlot = clamp(
    aaStep(encke - 0.012, encke - 0.004, t, tw) -
      aaStep(encke + 0.004, encke + 0.012, t, tw),
    0.0,
    1.0,
  );
  st = st * (1.0 - 0.95 * enckeSlot);
  let detail = ringlets(t, tw, h1 * 100.0);
  // Resolve three soft bands across the envelope, fading to their mean at
  // distance. Sparse gaps remain translucent even at grazing view angles.
  let thinContrast = 1.0 - smoothstep(0.20, 0.65, 3.0 * tw);
  let thinBands = 0.5 - 0.5 * cos(t * 18.84955592) * thinContrast;
  let structure = mix(st, 0.25 + 0.75 * thinBands, isThin);
  let density = mix(detail, mix(thinBands, detail, 0.18), isThin);
  let tau = mix(0.25, 1.8, density) * mix(0.55, 1.0, structure);

  // Retain rocky dust and creamy ice while bringing out the planet's palette.
  let ice = clamp(0.25 + density * 0.65 + structure * 0.15, 0.0, 1.0);
  let saturnCol = mix(vec3<f32>(0.32, 0.25, 0.17), vec3<f32>(0.88, 0.82, 0.68), ice);
  let pal01 = mix(obj.palLow.rgb, obj.palMid.rgb, smoothstep(0.0, 0.55, density));
  let paletteCol = mix(pal01, obj.palHigh.rgb, smoothstep(0.50, 1.0, density));
  let baseCol = mix(saturnCol, paletteCol, mix(0.45, 0.85, isThin));

  // Optical depth increases at grazing view angles. Keep gaps as coverage
  // so they do not become opaque when the disk is viewed almost edge-on.
  let N = normalize((obj.model * vec4<f32>(0.0, 1.0, 0.0, 0.0)).xyz);
  let L = normalize(frame.keyLightDir.xyz);
  let V = normalize(frame.cameraPos.xyz - in.worldPos);
  let nl = dot(N, L);
  let nv = dot(N, V);
  let muL = max(abs(nl), 0.08);
  let muV = max(abs(nv), 0.15);
  let a = edge * structure * (1.0 - exp(-tau / muV)) * (0.8 + 0.2 * obj.p1.x);
  // Light the particles on both faces instead of switching to an exponentially
  // dark transmission term when rotation puts the camera behind the ring plane.
  // Keep the incidence response and sparse dust's forward scattering.
  let fwd = pow(max(dot(V, -L), 0.0), 6.0);
  let reflected = 1.7 * muL / (muL + muV);
  let lighting = reflected + 0.35 * fwd * (1.0 - density);
  let shadow = shadowFactor(in.worldPos, L);
  let col = baseCol * (0.035 + shadow * lighting);
  // Distance fog: attenuate both colour and alpha so distant rings fade into
  // the nebula instead of stamping silhouettes over far-off planets.
  let d = distance(in.worldPos, frame.cameraPos.xyz);
  let s = d * 0.018;
  let fade = exp(-s * s);
  return vec4<f32>(col * a * 1.4 * fade, a * fade);
}
