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
  return smoothstep(e0 + w, e1 - w, x);
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

  let bandFreqBroad = 120.0 + h1 * 120.0;   // 120..240 bands
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
  let innerStart = mix(innerBroad, 0.62, isThin);
  let outerEnd = mix(outerBroad, 0.72, isThin);
  // Broad rings keep the original wide soft fade to the geometry edge; thin
  // rings use a tight 0.06-wide outer fade so the band actually reads narrow.
  let outerFadeStart = mix(1.0, outerEnd + 0.06, isThin);
  // Screen-space footprint of the radial coordinate; drives local AA on every
  // radial threshold below so thin bands/edges don't shimmer when the ring is
  // far away or seen near edge-on.
  let rw = fwidth(radial);
  let edge = aaStep(innerStart, innerStart + 0.06, radial, rw) *
             aaStep(outerFadeStart, outerEnd, radial, rw);

  // Curved bands: cosine in radial with a very small angular sine offset so
  // the rings stay essentially concentric, just enough imperfection to avoid
  // looking machined.
  let broadBands = 0.5 + 0.5 * cos(radial * bandFreq - 0.6 * sin(angle * 7.0 + time * 0.03));
  // Fine Saturn-style sub-striations: a higher-frequency band set carved into
  // the broad bands so the disk reads as hundreds of thin concentric ringlets
  // instead of a few wide stripes. Faded out for thin rings (isThin) so those
  // keep their clean ~3-stripe look.
  let fineBands = 0.5 + 0.5 * cos(radial * bandFreq * 2.6 + 0.25 * sin(angle * 11.0));
  // Frequency-aware contrast attenuation (analytic AA, after iq's "filtering
  // procedural textures"). A band set's on-screen rate in cycles/pixel is
  // freq/(2π)·fwidth(radial); once it nears the Nyquist limit (~0.5) the bands
  // can't be resolved and post-threshold AA can't recover them — they shimmer
  // and moiré. So fade each set's contrast to its mean (0.5) as it approaches
  // Nyquist, converging undersampled rings to a smooth average instead.
  let invTwoPi = 0.15915494;
  let broadAtt = 1.0 - smoothstep(0.20, 0.45, bandFreq * rw * invTwoPi);
  let fineAtt = 1.0 - smoothstep(0.20, 0.45, bandFreq * 2.6 * rw * invTwoPi);
  // Bias the faded (far-field) mean above 0.5 so attenuated rings read as solid
  // bands instead of washing out to half-translucent — the resolved bright
  // bands were near-opaque, so their true area-average opacity is well above
  // the raw 0.5 band mean. This is a mix toward a constant: it adds no spatial
  // frequency, so no shimmer/moiré returns. Low-frequency gaps still cut through.
  let bandFar = 0.8;
  let broadF = mix(bandFar, broadBands, broadAtt);
  let fineF = mix(bandFar, fineBands, fineAtt);
  let fineAmt = 0.45 * (1.0 - isThin);
  let bands = broadF * (1.0 - fineAmt + fineAmt * fineF);

  // Layered fBm noise sampled in (radial, angle) so it stays seamless around
  // the loop. Drives fine dust/clump variation independent of the bands.
  let np = vec2<f32>(radial * 22.0, angle * 3.2);
  let n = fbm2(np) * 0.65 + fbm2(np * 2.7 + vec2<f32>(11.0, 5.0)) * 0.35;

  // Combine curved bands with noise, but weight the bands heavily so the
  // fine ring stripes stay crisp instead of being smeared by fbm. The density
  // threshold is the dominant aliasing source (band freq up to ~140), so widen
  // it by the per-pixel change of its own argument (fwidth(dv)).
  let dv = bands * 0.85 + n * 0.35;
  let density = aaStep(0.20, 0.85, dv, fwidth(dv));

  // Cassini-style gaps cut a couple of transparent slots into the disk.
  let s1 = 0.5 + 0.5 * sin(radial * gap1Freq + h2 * 6.28);
  let s2 = 0.5 + 0.5 * sin(radial * gap2Freq + gap2Phase);
  let g1 = aaStep(0.88, 0.95, s1, fwidth(s1));
  let g2 = aaStep(0.92, 0.97, s2, fwidth(s2));
  let gap = clamp(g1 + g2 * 0.7, 0.0, 1.0);
  let opaq = max(0.0, density - gap * 0.85);

  let a = edge * (0.18 + 0.55 * opaq) * (0.5 + 0.5 * obj.p1.x);

  // Broad colour zones: low-frequency fBm in both radial AND angular axes
  // picks a position across the planet's 3-colour palette (low/mid/high).
  // The radial term gives Saturn-style concentric C/B/A zones; the angular
  // term breaks the perfect circles so colour also drifts as you sweep
  // around the ring (one arc leans dusty/dark, the opposite arc leans icy/
  // bright) — real rings vary in composition along their circumference too,
  // not just radially. Sampled on a unit circle (cos,sin) so noise is
  // seamless at the angle=0/2π wrap. Seeded per planet so each ringed body
  // gets a unique zone layout.
  let ang2 = vec2<f32>(cos(angle), sin(angle));
  let zoneR = fbm2(vec2<f32>(radial * 4.5, 1.7 + h1 * 6.28));
  let zoneA = fbm2(ang2 * 1.7 + vec2<f32>(h4 * 5.0, radial * 2.1));
  let palT = clamp(zoneR * 0.75 + zoneA * 0.55 - 0.10, 0.0, 1.0);
  let pal01 = mix(obj.palLow.rgb, obj.palMid.rgb, smoothstep(0.0, 0.55, palT));
  let paletteCol = mix(pal01, obj.palHigh.rgb, smoothstep(0.50, 1.0, palT));
  // The densest sub-bands lean slightly further toward palHigh, as if the
  // brighter dust concentrates in the tightest stripes.
  let densityWarm = smoothstep(0.55, 0.92, density);
  let zonedCol = mix(paletteCol, obj.palHigh.rgb, densityWarm * 0.30);
  // Mid-frequency angular chroma jitter: small chunks of dust pick up a
  // slight palette shift around the ring so even within a single band the
  // hue varies along the circumference, not just brightness — mimics
  // distinct particle compositions clumping together. Seamless via ang2.
  let chroma = vnoise2(ang2 * 7.3 + vec2<f32>(radial * 9.0, h2 * 5.0));
  let chromaCol = mix(obj.palLow.rgb, obj.palHigh.rgb, chroma);
  let variedCol = mix(zonedCol, chromaCol, 0.18);
  // Fine high-frequency grain modulates brightness +/-15% so bands have a
  // dusty, granular texture instead of reading as flat fills. Sampled on
  // ang2 * frequency so it stays seamless around the loop.
  let grainP = vec2<f32>(radial * 22.0, 0.0) + ang2 * 8.5;
  let grain = vnoise2(grainP + vec2<f32>(33.0, 17.0));
  let grainBright = 0.85 + 0.30 * (grain - 0.5);
  // Density-driven luminance keeps the sparse outer dust readably dimmer
  // than the bright core bands (matches the pre-refactor look).
  let densityShade = mix(0.70, 1.05, smoothstep(0.20, 0.85, density));

  let baseCol = variedCol * densityShade * grainBright;
  // Planet shadow on the ring: dim the colour (keep alpha so the silhouette
  // stays the same). Sun direction (L) points from receiver toward the sun.
  let L = normalize(frame.keyLightDir.xyz);
  let shadow = shadowFactor(in.worldPos, L);
  // Fake subsurface / forward scattering: real ring particles are tiny
  // translucent ice and dust grains that scatter light forward through
  // their bodies. When the viewer looks roughly toward the sun through the
  // ring, individual grains glow as the light passes through — the famous
  // back-lit Cassini "Saturn from the dark side" look. Strongest in sparse
  // dust (low density) where the per-grain translucency dominates, biased
  // toward palHigh (icy/bright tone). Gated by shadow so a particle in the
  // planet's umbra can't scatter sunlight it isn't receiving.
  let V = normalize(frame.cameraPos.xyz - in.worldPos);
  let fwd = pow(max(dot(V, -L), 0.0), 3.0) * shadow;
  let scatterTint = mix(obj.palMid.rgb, obj.palHigh.rgb, 0.75);
  let scatterBoost = 1.0 + fwd * 3.2;
  let scatterCol = mix(vec3<f32>(1.0), scatterTint * 1.7, fwd);
  let col0 = baseCol * mix(0.0, 1.0, shadow) * scatterBoost * scatterCol;
  // Anisotropic specular highlights (Kajiya-Kay model). Ring particles
  // orbit in concentric circular tracks, so the dust/ice surface acts like
  // brushed metal with "grooves" running tangentially around the ring.
  // The reflection lobe stretches perpendicular to those grooves, giving
  // the characteristic bright spec streak that runs along the ring on the
  // sun-lit side — the look in Saturn reference shots. Unlike Blinn-Phong
  // (which needs H ≈ N and fails at grazing angles for flat rings), this
  // fires correctly at any view angle since it only cares about how the
  // half-vector aligns with the local circumferential tangent.
  let cosA = cos(angle);
  let sinA = sin(angle);
  // Local tangent (along circumference) transformed into world space.
  // Object-space ring lies in XZ; circumferential direction is (-sin, 0, cos).
  let T = normalize((obj.model * vec4<f32>(-sinA, 0.0, cosA, 0.0)).xyz);
  let HV = L + V;
  let Hlen = max(length(HV), 1e-4);
  let H = HV / Hlen;
  let TdotH = dot(T, H);
  let sinTH = sqrt(max(0.0, 1.0 - TdotH * TdotH));
  // Two lobes: a broad halo + a tight streak, both perpendicular to the
  // tangent direction. Together they give a soft glow with a hot core.
  let anisoBroad = pow(sinTH, 18.0);
  let anisoTight = pow(sinTH, 72.0);
  let aniso = anisoBroad * 0.40 + anisoTight * 0.95;
  // Dense bands shine; sparse outer dust gets only a faint contribution.
  // Grain adds per-particle sparkle so the streak isn't a smooth band.
  let anisoMask = (0.25 + 0.75 * smoothstep(0.25, 0.85, density))
                * (0.55 + 0.45 * smoothstep(0.30, 0.95, grain))
                * shadow;
  let anisoCol = mix(obj.palHigh.rgb, vec3<f32>(1.0), 0.60) * 1.35;
  let col = col0 + anisoCol * aniso * anisoMask;
  // Thin back-lit dust becomes more visible (translucent grains catch the
  // sun) — boost alpha where density is low and forward scatter is high.
  // Even the densest bands get a smaller alpha lift so the whole ring
  // brightens dramatically when fully back-lit.
  let alphaGain = 1.0 + fwd * (0.45 + 1.40 * (1.0 - smoothstep(0.45, 0.92, density)));
  let aFinal = a * alphaGain;
  // Distance fog: attenuate both colour and alpha so distant rings fade into
  // the nebula instead of stamping silhouettes over far-off planets.
  let d = distance(in.worldPos, frame.cameraPos.xyz);
  let s = d * 0.030;
  let fade = exp(-s * s);
  return vec4<f32>(col * aFinal * 1.4 * fade, aFinal * fade);
}
