// Procedural planet surface (also used for moons).
// Shared frame + per-object uniforms; value-noise fBm drives terrain color
// through three authored palette anchors. Atmosphere is a fresnel rim term.

struct Frame {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  keyLightDir : vec4<f32>,
  misc : vec4<f32>, // x=time, y=reducedMotion, z=qualityScale, w=unused
  shadowSpheres : array<vec4<f32>, 8>, // xyz=center, w=radius
  shadowMisc : vec4<f32>, // x=active sphere count, y=lowTier flag, zw unused
};

struct Obj {
  model : mat4x4<f32>,
  p0 : vec4<f32>, // x=radius, y=seedf, z=time, w=kind
  palLow : vec4<f32>,
  palMid : vec4<f32>,
  palHigh : vec4<f32>,
  p1 : vec4<f32>, // x=focus, y=hasAtmosphere, z=cloudShadow, w=oceans flag
  p2 : vec4<f32>, // x=cityLights flag, y=flowMap flag, zw=unused
};

@group(0) @binding(0) var<uniform> frame : Frame;
@group(1) @binding(0) var<uniform> obj : Obj;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) nrm : vec3<f32>,
  @location(1) localPos : vec3<f32>,
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
  out.nrm = normalize((obj.model * vec4<f32>(normal, 0.0)).xyz);
  out.localPos = position;
  out.worldPos = world.xyz;
  return out;
}

fn hash3(p : vec3<f32>) -> f32 {
  let q = fract(p * 0.3183099 + vec3<f32>(0.1, 0.2, 0.3));
  let r = q * 17.0;
  return fract(r.x * r.y * r.z * (r.x + r.y + r.z));
}

fn vnoise(x : vec3<f32>) -> f32 {
  let i = floor(x);
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash3(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash3(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash3(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash3(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash3(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash3(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash3(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash3(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  let nxy0 = mix(nx00, nx10, u.y);
  let nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
}

fn fbm(p : vec3<f32>) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 4; i = i + 1) {
    v = v + a * vnoise(q);
    q = q * 2.03;
    a = a * 0.5;
  }
  return v;
}

// Low-frequency fBm used for continent-scale land/sea distribution. Only 3
// octaves so the result is smooth at sub-continent scale, giving large
// coherent landmasses and open ocean basins rather than fragmented noise.
fn continentFbm(p : vec3<f32>) -> f32 {
  var v = 0.0;
  var a = 0.6;
  var q = p;
  for (var i = 0; i < 3; i = i + 1) {
    v = v + a * vnoise(q);
    q = q * 2.0;
    a = a * 0.5;
  }
  return v;
}

// Ridged fBm for mountain chains. `1 - |n - 0.5| * 2` per octave gives sharp
// linear ridges where the base noise crosses 0.5, like real orogenic belts.
// Only 2 octaves so the result reads as continuous scars rather than a
// noisy speckle field — the high-frequency octaves break up the linearity.
fn ridgedFbm(p : vec3<f32>) -> f32 {
  var v = 0.0;
  var a = 0.65;
  var q = p;
  for (var i = 0; i < 2; i = i + 1) {
    let n = vnoise(q);
    v = v + a * (1.0 - abs(n - 0.5) * 2.0);
    q = q * 2.1;
    a = a * 0.5;
  }
  return v;
}

// --- Cook-Torrance PBR helpers ---
// Standard real-time GGX BRDF (Walter et al. 2007 / Karis 2013). Lets land
// and water share one lighting path while their roughness/F0 alone shape the
// difference: smooth water -> tight Fresnel-driven glint, rough land -> matte.
const PI : f32 = 3.14159265359;

fn dGGX(NdH : f32, roughness : f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let f = (NdH * NdH) * (a2 - 1.0) + 1.0;
  return a2 / (PI * f * f);
}

fn gSchlickGGX(NdX : f32, roughness : f32) -> f32 {
  // k for direct (analytic) lighting = (r+1)^2 / 8
  let r = roughness + 1.0;
  let k = (r * r) * 0.125;
  return NdX / (NdX * (1.0 - k) + k);
}

fn gSmith(NdV : f32, NdL : f32, roughness : f32) -> f32 {
  return gSchlickGGX(NdV, roughness) * gSchlickGGX(NdL, roughness);
}

fn fSchlick(cosTheta : f32, F0 : vec3<f32>) -> vec3<f32> {
  // pow(x, 5) via multiplies — exact, avoids a transcendental in the hot path.
  let x = clamp(1.0 - cosTheta, 0.0, 1.0);
  let x2 = x * x;
  let f = x2 * x2 * x;
  return F0 + (vec3<f32>(1.0) - F0) * f;
}

// Distance fog: exp-squared falloff (~"GL_EXP2") so near-camera fragments
// are essentially untouched and far fragments smoothly drown into the haze
// colour. Density tuned for PLANET_SPACING=9 / VIEW_DISTANCE=8.5 so the
// focused planet stays crisp and planets two or three slots away noticeably
// fade. Shared by planet/ring/atmosphere shaders.
const FOG_DENSITY : f32 = 0.018;
const FOG_COLOR : vec3<f32> = vec3<f32>(0.04, 0.06, 0.14);

fn fogFactor(worldPos : vec3<f32>, cameraPos : vec3<f32>) -> f32 {
  let d = distance(worldPos, cameraPos);
  let s = d * FOG_DENSITY;
  return 1.0 - exp(-s * s);
}

// Analytic spherical shadow from a directional sun. For each occluder sphere
// we test whether the ray from the receiver point in direction L (toward sun)
// passes through the sphere. Returns 1.0 unshadowed, 0.0 fully shadowed,
// smoothstep'd across a ~5% radial penumbra band beyond the umbra.
fn shadowFactor(p : vec3<f32>, L : vec3<f32>) -> f32 {
  var s = 1.0;
  let cnt = i32(frame.shadowMisc.x);
  for (var i = 0; i < 8; i = i + 1) {
    if (i >= cnt) { break; }
    let sph = frame.shadowSpheres[i];
    let d = sph.xyz - p;
    let t = dot(d, L);
    if (t <= 0.0) { continue; } // occluder is behind the receiver
    let c2 = dot(d, d) - t * t;
    let R = sph.w;
    let R2 = R * R;
    s = s * smoothstep(R2, R2 * 1.10, c2);
  }
  return s;
}

// ---- cloud noise (must match clouds.wgsl's copy exactly) ------------------
// These three functions and the two parameter helpers below are duplicated
// verbatim in clouds.wgsl so cast shadows on the planet line up with the
// rendered cloud puffs. Keep in sync — any edit to one must edit both.
fn cHash3(p : vec3<f32>) -> f32 {
  let q = fract(p * 0.3183099 + vec3<f32>(0.1, 0.2, 0.3));
  let r = q * 17.0;
  return fract(r.x * r.y * r.z * (r.x + r.y + r.z));
}

fn cVnoise(x : vec3<f32>) -> f32 {
  let i = floor(x);
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = cHash3(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = cHash3(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = cHash3(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = cHash3(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = cHash3(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = cHash3(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = cHash3(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = cHash3(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  let nxy0 = mix(nx00, nx10, u.y);
  let nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
}

fn cFbm(p : vec3<f32>) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 4; i = i + 1) {
    v = v + a * cVnoise(q);
    q = q * 2.03;
    a = a * 0.5;
  }
  return v;
}

fn cloudRotation(time : f32, seedf : f32, reducedMotion : f32) -> f32 {
  let baseSpeed = 0.015;
  let jitter = fract(seedf * 0.000371) * 0.025;
  let dir = select(1.0, -1.0, fract(seedf * 0.0007) < 0.30);
  let mult = select(1.0, 0.10, reducedMotion > 0.5);
  return time * (baseSpeed + jitter) * dir * mult;
}

fn cloudCoverage(seedf : f32) -> f32 {
  return 0.40 + 0.30 * fract(seedf * 0.00091);
}

fn cloudDensity(localDir : vec3<f32>, time : f32, seedf : f32, reducedMotion : f32) -> f32 {
  let rot = cloudRotation(time, seedf, reducedMotion);
  let cs = cos(rot);
  let sn = sin(rot);
  let rp = vec3<f32>(
    cs * localDir.x + sn * localDir.z,
    localDir.y,
    -sn * localDir.x + cs * localDir.z,
  );
  let seedShift = vec3<f32>(seedf * 0.0017, seedf * 0.0023, seedf * 0.0029);
  let p = rp * 4.8 + seedShift;
  // Domain warp (iq): two extra fbm samples form a warp vector, the final
  // sample re-evaluates the field at the warped position. Produces the
  // characteristic swirly, turbulent look that pure additive fbm lacks.
  let qx = cFbm(p);
  let qy = cFbm(p + vec3<f32>(5.2, 1.3, 2.8));
  let n = cFbm(p + 0.85 * vec3<f32>(qx - 0.5, qy - 0.5, (qx - qy) * 0.7));
  let cov = cloudCoverage(seedf);
  let lo = 0.62 - cov * 0.30;
  let hi = lo + 0.14;
  return smoothstep(lo, hi, n);
}

const CLOUD_SHADOW_STRENGTH : f32 = 1.0;
// Shadow-projection shell, intentionally HIGHER than the rendered cloud shell
// (1.006 in clouds.wgsl). At the true render altitude the cast shadow would
// land within ~1-3 deg of the puff and stay hidden directly beneath the
// opaque cloud. Projecting the shadow ray against a taller shell displaces
// the shadow toward the anti-solar side by ~4-8 deg so it clears the puff
// and reads as a real cloud shadow. Cloud cells are ~9 deg radius (cFbm
// freq 3.2), so this is the minimum gap that makes shadows visible.
const CLOUD_SHADOW_SHELL : f32 = 1.06;

// Cloud shadow on the planet surface. From the surface fragment (vn is the
// normalized unit-sphere local position), march along the local-space sun
// direction (localL, the world sun dir rotated into the planet's local frame)
// to the exact ray-sphere intersection with the cloud shell, sample the same
// cloud density function the cloud shader uses, and attenuate direct light.
// vn and localL are precomputed by the caller (the fragment body already needs
// the planet's rotation basis for ice shading) so this avoids recomputing the
// basis and the two normalizes here. Returns a multiplier in [1 - STRENGTH, 1]
// for the direct term, or 1.0 on the night side where NdL already kills it.
fn cloudShadow(vn : vec3<f32>, localL : vec3<f32>, time : f32, seedf : f32, reducedMotion : f32, enabled : f32) -> f32 {
  if (enabled < 0.001) { return 1.0; }
  let nL = dot(vn, localL);
  if (nL <= 0.0) { return 1.0; }
  // Exact ray-sphere intersection from a unit-length surface point along a
  // unit-length direction with a shell at radius R: t = -nL + sqrt(nL^2 + R^2 - 1).
  // Uses the taller CLOUD_SHADOW_SHELL (not the render shell) so the shadow is
  // displaced far enough from the cloud to be visible.
  let R2m1 = CLOUD_SHADOW_SHELL * CLOUD_SHADOW_SHELL - 1.0;
  let t = -nL + sqrt(nL * nL + R2m1);
  let cloudDir = normalize(vn + localL * t);
  let density = cloudDensity(cloudDir, time, seedf, reducedMotion);
  return 1.0 - density * CLOUD_SHADOW_STRENGTH * enabled;
}

// Marbled land color + height from the domain-warped fBm at a noise-domain
// sample position `sp`. Factored out of the fragment body so the flow-field
// feature can sample it at two advected positions and cross-fade them. `local`
// is the un-advected surface position used for region-scale biome tinting so
// climate zones stay put while fine detail streams. Must stay in sync with the
// WebGL2 mirror (surfaceMarble in PLANET_FRAG).
struct Surf {
  color : vec3<f32>,
  height : f32,
};

fn surfaceMarble(sp : vec3<f32>, local : vec3<f32>, seed : f32) -> Surf {
  let q = vec3<f32>(
    fbm(sp),
    fbm(sp + vec3<f32>(5.2, 1.3, 2.8)),
    fbm(sp + vec3<f32>(7.1, 4.4, 6.9)),
  );
  let warpQ = sp + 2.5 * q;
  let r = vec3<f32>(
    fbm(warpQ + vec3<f32>(1.7, 9.2, 3.5)),
    fbm(warpQ + vec3<f32>(8.3, 2.8, 4.1)),
    fbm(warpQ + vec3<f32>(4.7, 7.7, 1.9)),
  );
  let height = clamp(fbm(sp + 2.5 * r), 0.0, 1.0);
  var land = mix(obj.palLow.rgb, obj.palMid.rgb, smoothstep(0.25, 0.55, height));
  land = mix(land, obj.palHigh.rgb, smoothstep(0.6, 0.85, height));
  let qLen = clamp(length(q) * 0.55, 0.0, 1.0);
  let rLen = clamp(length(r) * 0.55, 0.0, 1.0);
  land = mix(land, obj.palLow.rgb * 0.55, qLen * 0.22);
  land = mix(land, obj.palHigh.rgb * 1.15, rLen * 0.20);
  let biomeR = vnoise(local * 0.55 + vec3<f32>(11.3, 3.7, 5.1));
  let biomeG = vnoise(local * 0.55 + vec3<f32>(24.7, 6.2, 9.4));
  let biomeB = vnoise(local * 0.55 + vec3<f32>(37.1, 8.9, 2.6));
  let biomeColor = mix(obj.palLow.rgb, obj.palHigh.rgb, vec3<f32>(biomeR, biomeG, biomeB));
  land = mix(land, biomeColor, 0.18);
  let ridge = ridgedFbm(warpQ * 0.5);
  let mountainMask = smoothstep(0.62, 0.74, ridge) * smoothstep(0.42, 0.62, height);
  let mountainRock = mix(obj.palMid.rgb * 0.55, vec3<f32>(0.48, 0.28, 0.16), 0.75);
  land = mix(land, mountainRock, mountainMask * 0.85);
  let snowMask = smoothstep(0.78, 0.95, height) * smoothstep(0.58, 0.74, ridge);
  land = mix(land, vec3<f32>(0.94, 0.95, 0.97), snowMask * 0.9);
  return Surf(land, height);
}

// Smooth unit tangent flow direction for the flow-field feature: a
// low-frequency 3-channel noise vector projected onto the surface tangent
// plane gives a coherent swirling field the surface detail is advected along.
fn flowDir(local : vec3<f32>, n : vec3<f32>, seed : f32) -> vec3<f32> {
  let fp = local * 1.5 + vec3<f32>(seed * 0.002, seed * 0.0017, seed * 0.0023);
  var v = vec3<f32>(
    vnoise(fp) - 0.5,
    vnoise(fp + vec3<f32>(13.1, 7.7, 2.3)) - 0.5,
    vnoise(fp + vec3<f32>(5.5, 19.2, 8.8)) - 0.5,
  );
  v = v - n * dot(v, n);
  let l = length(v);
  if (l < 1e-4) { return vec3<f32>(0.0); }
  return v / l;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let seed = obj.p0.y;
  let n = normalize(in.nrm);
  let viewDir = normalize(frame.cameraPos.xyz - in.worldPos);
  let lightDir = normalize(frame.keyLightDir.xyz);
  let rimB = 1.0 - clamp(dot(n, viewDir), 0.0, 1.0);
  let rim = rimB * rimB * rimB;

  let basePos = in.localPos * (2.2 + seed * 0.0001) + vec3<f32>(seed * 0.001);

  // Flow-field advection (after Emil Dziewanowski,
  // https://emildziewanowski.com/flowfields/): when the planet's flowMap
  // feature is on, the marbled surface detail is displaced along a tangent
  // flow field. Two samples offset by half a cycle are cross-faded with a
  // triangle weight so the field streams continuously without stretching
  // unboundedly past a half cycle. Disabled under reduced motion.
  var land : vec3<f32>;
  var height : f32;
  // On the low tier, skip the two-sample flow-field advection and render the
  // static marble with a single surfaceMarble call. surfaceMarble is the
  // heaviest per-pixel function on the planet, so halving it is a sizeable
  // low-tier win on macOS; the streaming motion it drops is subtle on low.
  let lowTier = frame.shadowMisc.y > 1.5;
  if (obj.p2.y > 0.5 && !lowTier) {
    let rm = frame.misc.y;
    let speed = select(0.16, 0.0, rm > 0.5);
    let mag = 1.0;
    let flow = flowDir(in.localPos, n, seed);
    let t = obj.p0.z * speed;
    let ph0 = fract(t);
    let ph1 = fract(t + 0.5);
    let s0 = surfaceMarble(basePos - flow * ph0 * mag, in.localPos, seed);
    let s1 = surfaceMarble(basePos - flow * ph1 * mag, in.localPos, seed);
    let w = abs(0.5 - ph0) * 2.0;
    land = mix(s0.color, s1.color, w);
    height = mix(s0.height, s1.height, w);
  } else {
    let s = surfaceMarble(basePos, in.localPos, seed);
    land = s.color;
    height = s.height;
  }

  // Oceans: a separate low-frequency "continent" field drives the land/sea
  // split so landmasses clump like Earth's continents instead of fragmenting
  // with the fine surface noise. A small amount of the fine `height` is mixed
  // in so coastlines stay naturally jagged rather than perfectly smooth.
  let oceans = obj.p1.w;
  let continentPos = in.localPos * 1.1 + vec3<f32>(seed * 0.0011);
  let continentH = continentFbm(continentPos);
  let oceanField = continentH * 0.85 + height * 0.15;
  let waterLevel = 0.55;
  let waterMask = oceans * (1.0 - smoothstep(waterLevel - 0.03, waterLevel + 0.03, oceanField));
  let deepOcean = vec3<f32>(0.005, 0.018, 0.07);
  let shallowOcean = vec3<f32>(0.42, 0.82, 0.80);
  // Concentrate the lightening in a narrow band just inside the shoreline so
  // most of the ocean stays dark and coasts get a visible turquoise rim.
  let depth = smoothstep(waterLevel - 0.10, waterLevel, oceanField);
  let water = mix(deepOcean, shallowOcean, depth);
  let base = mix(land, water, waterMask);

  // Polar ice caps: keep them tighter to the poles, add breakup inside the
  // sheet, and tint some of the denser ice toward blue. A directional detail
  // mask darkens creases on the sun-facing side so the caps read less flat.
  // Two offset fbm passes form a domain-warp vector that distorts the edge
  // sampling position, producing wispy, tendril-like fronds at the boundary.
  // Mirror of PLANET_FRAG.
  let localPos = normalize(in.localPos);
  let r0 = normalize(obj.model[0].xyz);
  let r1 = normalize(obj.model[1].xyz);
  let r2 = normalize(obj.model[2].xyz);
  let localLightDir = normalize(vec3<f32>(dot(r0, lightDir), dot(r1, lightDir), dot(r2, lightDir)));
  let lat = abs(localPos.y);
  let iceWarpPos = localPos * 3.8 + vec3<f32>(seed * 0.0019, seed * 0.0023, seed * 0.0017);
  let iceWarpA = fbm(iceWarpPos) - 0.5;
  let iceWarpB = fbm(iceWarpPos + vec3<f32>(3.7, 1.8, 5.2)) - 0.5;
  // A second, higher-frequency domain-warp pass distorts the edge sampling
  // position at a finer scale, adding crinkly, small-scale detail to the
  // boundary on top of the broad warp.
  let iceWarpHiPos = localPos * 11.0 + vec3<f32>(seed * 0.0026, seed * 0.0034, seed * 0.0022);
  let iceWarpHiA = fbm(iceWarpHiPos) - 0.5;
  let iceWarpHiB = fbm(iceWarpHiPos + vec3<f32>(2.3, 6.1, 4.4)) - 0.5;
  let iceWarpedPos = localPos
    + vec3<f32>(iceWarpA, iceWarpA * iceWarpB, iceWarpB) * 0.34
    + vec3<f32>(iceWarpHiA, iceWarpHiA * iceWarpHiB, iceWarpHiB) * 0.11;
  let iceNoise = fbm(iceWarpedPos * 2.6 + vec3<f32>(seed * 0.0015, seed * 0.0021, seed * 0.0018));
  // A finer, higher-frequency octave adds small jagged fronds on top of the
  // broad domain-warped boundary so the cap edge reads more ragged.
  let iceEdgeFine = fbm(iceWarpedPos * 6.4 + vec3<f32>(seed * 0.0024, seed * 0.0033, seed * 0.0029)) - 0.5;
  let iceEdge = 0.87 + (iceNoise - 0.5) * 0.26 + iceEdgeFine * 0.08;
  let iceMask = oceans * smoothstep(iceEdge - 0.04, iceEdge + 0.03, lat);
  let iceDetailPos = localPos * 8.0 + vec3<f32>(seed * 0.0031, seed * 0.0027, seed * 0.0037);
  let iceDetail = fbm(iceDetailPos);
  let iceRidgePhase = vec3<f32>(4.2, 1.7, 8.4);
  let iceRidges = ridgedFbm(iceDetailPos * 0.8 + iceRidgePhase);
  let iceBlue = smoothstep(0.44, 0.78, iceDetail) * smoothstep(0.12, 0.7, iceMask);
  let iceCrease = smoothstep(0.34, 0.72, iceRidges);
  let iceSelfShadow = 1.0 - iceCrease * smoothstep(0.0, 0.75, dot(localPos, localLightDir)) * 0.28;
  let iceColor = mix(vec3<f32>(0.88, 0.93, 0.98), vec3<f32>(0.48, 0.70, 0.92), iceBlue * 0.85);
  let base2 = mix(base, iceColor * iceSelfShadow, iceMask);

  // --- Cook-Torrance PBR direct lighting from the key sun ---
  // Per-pixel material: water is a smooth-ish dielectric (moderate roughness,
  // low F0 ~ water IOR 1.33 -> F0 0.02); land is a rough dielectric (high
  // roughness, F0 0.04). Both share a single lighting path so the glint shape
  // and the matte response come purely from the material parameters.
  //
  // Water roughness floor (0.35) is chosen so the GGX highlight FWHM stays
  // wider than a UV-sphere triangle face at the equator (~5.6° arc on a
  // 48x64 mesh; see geometry.ts). Below ~0.30 the highlight gets sharp
  // enough that its sub-triangle peak snaps to mesh seams, producing a
  // visible polygonal/chevron kink right in the brightest pixels.
  let albedo = base2;
  let metallic = 0.0;
  // Ice is a brighter, smoother dielectric than rough land but still matte
  // next to open water, so it gets its own roughness/F0 lerp layered on top of
  // the land/water mix.
  let roughness = mix(mix(0.92, 0.35, waterMask), 0.5, iceMask);
  let F0base = mix(mix(vec3<f32>(0.04), vec3<f32>(0.02), waterMask), vec3<f32>(0.05, 0.055, 0.06), iceMask);
  let F0 = mix(F0base, albedo, metallic);

  let L = lightDir;
  let V = viewDir;
  let H = normalize(L + V);
  let NdL = clamp(dot(n, L), 0.0, 1.0);
  let NdV = max(dot(n, V), 1e-4);
  let NdH = clamp(dot(n, H), 0.0, 1.0);
  let VdH = clamp(dot(V, H), 0.0, 1.0);

  let D = dGGX(NdH, roughness);
  let G = gSmith(NdV, NdL, roughness);
  let F = fSchlick(VdH, F0);

  // Golden glitter on the water: tint the specular highlight toward warm gold
  // (only on water via waterMask) so the sun's reflection reads like a sunset
  // glint on the ocean rather than a neutral white spot. Land stays untinted.
  let specTint = mix(vec3<f32>(1.0), vec3<f32>(1.0, 0.78, 0.42), waterMask);
  let specular = (D * G) * F / max(4.0 * NdV * NdL, 1e-3) * specTint;
  let kS = F;
  let kD = (vec3<f32>(1.0) - kS) * (1.0 - metallic);

  // Sun radiance pre-multiplied by PI so that diffuse simplifies to
  // kD * albedo * NdL (matches the look of the previous Lambert-ish shader
  // at NdL=1) while the specular term retains its physical units.
  let sunRadiance = vec3<f32>(PI);
  // Analytic planet shadow on the lit side. Self-shadow is implicitly handled
  // because the lit-side test gives t <= 0 (the receiver's own sphere is
  // sun-ward, so the ray to the sun never re-enters).
  let shadow = shadowFactor(in.worldPos, lightDir);
  // Cloud shadow: gated by p1.z (renderer sets this to the planet's visibility
  // when clouds are on, 0 otherwise, so shadows fade in lockstep with the
  // alpha-blended cloud shell). Uses the same noise/rotation as clouds.wgsl
  // so the shadow lands directly under the rendered puff.
  let cloudShadowMul = cloudShadow(
    localPos,
    localLightDir,
    obj.p0.z,
    obj.p0.y,
    frame.misc.y,
    obj.p1.z,
  );
  let direct = (kD * albedo / PI + specular) * sunRadiance * NdL * shadow * cloudShadowMul;

  // Very faint ambient so the unlit hemisphere reads as deep shadow without
  // being pitch black — surface noise stays just barely legible.
  let ambientShadowMul = 0.10 + 0.90 * cloudShadowMul;
  let ambient = albedo * 0.01 * ambientShadowMul;
  var color = ambient + direct;

  // City lights on the night side of land masses. Gated by p2.x (planet
  // feature flag). Population density driven by the same continent field
  // that placed the oceans so cities cluster on coastlines and dense
  // interiors; sparse high-frequency cell hash places the actual pixel-scale
  // lights; per-cell twinkle uses time. Cloud shadows attenuate so the
  // lights flicker out under overcast cells.
  let cityFlag = obj.p2.x;
  if (cityFlag > 0.5) {
    // Hoist cell coordinate + screen-space footprint OUTSIDE the per-fragment
    // gates below. Derivatives (fwidth) require uniform control flow; only
    // the cityFlag branch is uniform per-draw, the night/land/presence
    // checks vary per fragment.
    let cityScale = 40.0;
    let cityCoord = in.localPos * cityScale
      + vec3<f32>(seed * 0.013, seed * 0.011, seed * 0.017);
    let fw = fwidth(cityCoord);
    let footprint = max(fw.x, max(fw.y, fw.z));
    // LOD fade: when one fragment spans a sizable fraction of a cell, the
    // hash-grid pattern aliases (sparkles). Fade lights out as the cell
    // approaches pixel size — they smoothly disappear at distance instead
    // of flickering.
    let lodFade = 1.0 - smoothstep(0.35, 0.9, footprint);

    let nightFactor = smoothstep(0.18, -0.05, NdL);
    let landFactor = (1.0 - waterMask) * (1.0 - iceMask);
    if (nightFactor > 0.001 && landFactor > 0.05 && lodFade > 0.001) {
      // Population proxy: continents at moderate freq with a coastline boost
      // (smoothstep peak where oceanField hovers near waterLevel).
      let popNoise = continentFbm(in.localPos * 2.2 + vec3<f32>(seed * 0.0019));
      let popMask = smoothstep(0.42, 0.72, popNoise);
      let coastBoost = smoothstep(0.07, 0.0, abs(oceanField - 0.60));
      let pop = clamp(max(popMask, coastBoost * 0.75), 0.0, 1.0);

      // City placement is two-layer:
      //   1. Low-frequency "city zone" mask carves out a handful of regions
      //      per planet where civilization clusters. Narrow threshold band
      //      gives tight clusters; squared falloff sharpens the cluster
      //      edges so lights pool in the cluster cores instead of fading
      //      gently out across the surrounding land.
      //   2. Inside those zones, a medium-frequency hash grid plants
      //      individual point lights. Larger cells = larger on-screen dots.
      let zoneNoise = vnoise(in.localPos * 4.5
        + vec3<f32>(seed * 0.0021, seed * 0.0017, seed * 0.0033));
      let zoneMask = smoothstep(0.66, 0.80, zoneNoise);
      let cityPresence = zoneMask * zoneMask * (0.40 + 0.60 * pop);

      if (cityPresence > 0.01) {
        let cellId = floor(cityCoord);
        let sub = fract(cityCoord);
        // High threshold even at peak presence — fewer, more distinct lights
        // (rather than a continuous speckle).
        let threshold = mix(0.92, 0.62, cityPresence);
        // Sample the surrounding 3x3x3 cells so a light placed near a cell
        // boundary still contributes to neighboring sub-cells. Without this
        // the glow gets sliced flat at cell walls, producing the visible
        // rectangular clips. Worley-style nearest-feature loop.
        let glowRadius = 0.30;
        var bestGlow = 0.0;
        for (var dx: i32 = -1; dx <= 1; dx = dx + 1) {
          for (var dy: i32 = -1; dy <= 1; dy = dy + 1) {
            for (var dz: i32 = -1; dz <= 1; dz = dz + 1) {
              let off = vec3<f32>(f32(dx), f32(dy), f32(dz));
              let nh = hash3(cellId + off);
              if (nh >= threshold) {
                let dotPos = vec3<f32>(fract(nh * 1.7), fract(nh * 7.3), fract(nh * 13.1));
                let d = length(sub - (off + dotPos));
                bestGlow = max(bestGlow, smoothstep(glowRadius, 0.0, d));
              }
            }
          }
        }
        let cloudMask = mix(1.0, cloudShadowMul, 0.7);
        let intensity = bestGlow * nightFactor * landFactor * cloudMask * lodFade;
        let cityColor = vec3<f32>(1.0, 0.72, 0.32);
        color = color + cityColor * intensity * 4.0;
      }
    }
  }

  let atmoStrength = obj.p1.y;
  // Multiplied by NdL (not (a + b*NdL)) so the rim fresnel fully zeroes on
  // the unlit side instead of leaving a faint constant glow there. Also gated
  // by shadow so it doesn't glow through another planet's shadow.
  let atmo = obj.palHigh.rgb * rim * NdL * 0.55 * atmoStrength * shadow;
  color = color + atmo;

  color = color * (0.85 + 0.3 * obj.p1.x);
  let f = fogFactor(in.worldPos, frame.cameraPos.xyz);
  color = mix(color, FOG_COLOR, f);
  return vec4<f32>(color, 1.0);
}
