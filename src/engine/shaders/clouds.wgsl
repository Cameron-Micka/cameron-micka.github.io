// Optional cloud shell. A sphere mesh drawn between the planet surface and the
// atmosphere shell (at planetRadius * CLOUD_SHELL_SCALE), alpha-blended over
// the lit planet to look like coherent cloud cells. The same `cloudDensity`
// function is duplicated verbatim in `planet.wgsl` (and the WebGL2 mirrors)
// so cast shadows on the surface line up exactly with the visible puffs.
//
// The cloud noise is sampled in the planet's local (rotation-following) frame
// so clouds stay attached to the planet as the user drags / it auto-spins,
// and an additional Y-axis rotation that varies per-planet (speed *and* sign
// from the seed) makes them visibly drift relative to the surface.

struct Frame {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  keyLightDir : vec4<f32>,
  misc : vec4<f32>, // x=time, y=reducedMotion, z=qualityScale, w=aspect
  shadowSpheres : array<vec4<f32>, 8>,
  shadowMisc : vec4<f32>,
};

struct Obj {
  model : mat4x4<f32>,
  p0 : vec4<f32>, // x=planetRadius(world) y=shellScale z=time w=kind(5)
  palLow : vec4<f32>,
  palMid : vec4<f32>,
  palHigh : vec4<f32>, // rgb = atmosphere tint
  p1 : vec4<f32>, // x=focus y=seedf z=unused w=visibility
};

@group(0) @binding(0) var<uniform> frame : Frame;
@group(1) @binding(0) var<uniform> obj : Obj;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) localPos : vec3<f32>,
  @location(1) worldPos : vec3<f32>,
  @location(2) worldNormal : vec3<f32>,
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
  out.localPos = position;
  out.worldPos = world.xyz;
  out.worldNormal = normalize((obj.model * vec4<f32>(normal, 0.0)).xyz);
  return out;
}

// ---- cloud noise (must match planet.wgsl's copy exactly) -----------------
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

// Per-planet cloud rotation about local Y, varied by seed so different planets
// have visibly different drift rates and a minority spin the other way. The
// rate is scaled down (not zeroed) under reduced motion so the field still
// drifts subtly without becoming a static texture.
fn cloudRotation(time : f32, seedf : f32, reducedMotion : f32) -> f32 {
  let baseSpeed = 0.015;
  let jitter = fract(seedf * 0.000371) * 0.025;
  let dir = select(1.0, -1.0, fract(seedf * 0.0007) < 0.30);
  let mult = select(1.0, 0.10, reducedMotion > 0.5);
  return time * (baseSpeed + jitter) * dir * mult;
}

// Coverage varies per-planet: some worlds are mostly cloudy, others sparse.
fn cloudCoverage(seedf : f32) -> f32 {
  return 0.40 + 0.30 * fract(seedf * 0.00091);
}

// Sample cloud density at a unit direction in the planet's local rotation
// frame. `localDir` must be normalized. The same function lives in
// planet.wgsl so cast shadows register with rendered cloud puffs.
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
  // Higher coverage lowers the smoothstep window, so more of the noise
  // domain becomes cloud. Output in [0, 1].
  let lo = 0.62 - cov * 0.30;
  let hi = lo + 0.14;
  return smoothstep(lo, hi, n);
}

// Cheap directional self-shadowing for cloud depth detail. We sample density a
// few short steps toward the sun in cloud-local space and darken where upstream
// density is high. A tiny high-frequency modulation keeps the shadow break-up
// organic instead of uniformly soft.
fn cloudSelfShadow(localDir : vec3<f32>, worldSun : vec3<f32>, time : f32, seedf : f32, reducedMotion : f32) -> f32 {
  let r0 = normalize(obj.model[0].xyz);
  let r1 = normalize(obj.model[1].xyz);
  let r2 = normalize(obj.model[2].xyz);
  let localSun = normalize(vec3<f32>(
    dot(r0, worldSun),
    dot(r1, worldSun),
    dot(r2, worldSun),
  ));
  let d1 = cloudDensity(normalize(localDir + localSun * 0.045), time, seedf, reducedMotion);
  let d2 = cloudDensity(normalize(localDir + localSun * 0.090), time, seedf, reducedMotion);
  let d3 = cloudDensity(normalize(localDir + localSun * 0.160), time, seedf, reducedMotion);
  let occ = clamp(0.55 * d1 + 0.30 * d2 + 0.15 * d3, 0.0, 1.0);
  let grain = cFbm(localDir * 14.0 + vec3<f32>(seedf * 0.011, seedf * 0.013, seedf * 0.017));
  let occDetail = clamp(occ * mix(0.75, 1.20, grain), 0.0, 1.0);
  return 1.0 - occDetail * 0.70;
}

// ---- thunderstorms -------------------------------------------------------
// Localized, randomly-timed lightning flashes embedded in the cloud field.
// Storm sites are scattered feature points in a coarse 3D cell grid over the
// cloud-local sphere; only a fraction of cells host a storm. Each storm pulses
// on its own random period with a sharp multi-flicker envelope and per-cycle
// amplitude variation, so the flashing reads as irregular weather rather than
// a metronome. The glow is gated by local cloud density so the flash lights
// real puffs.
fn cHash3v(p : vec3<f32>) -> vec3<f32> {
  let q = vec3<f32>(
    dot(p, vec3<f32>(127.1, 311.7, 74.7)),
    dot(p, vec3<f32>(269.5, 183.3, 246.1)),
    dot(p, vec3<f32>(113.5, 271.9, 124.6)),
  );
  return fract(sin(q) * 43758.5453);
}

// One storm cycle of brightness for x in [0,1): a bright leading stroke then
// two quick flickers, all decaying fast so most of the cycle stays dark.
fn stormFlicker(x : f32) -> f32 {
  return exp(-x * 20.0)
       + 0.55 * exp(-abs(x - 0.05) * 45.0)
       + 0.30 * exp(-abs(x - 0.09) * 70.0);
}

fn cloudStorm(localDir : vec3<f32>, time : f32, seedf : f32, density : f32, reducedMotion : f32) -> f32 {
  // Reduced motion disables the flashing entirely (no strobing for users who
  // asked to limit motion).
  if (reducedMotion > 0.5) { return 0.0; }
  let freq = 5.0;
  let sOff = vec3<f32>(seedf * 0.00061, seedf * 0.00043, seedf * 0.00077);
  let p = localDir * freq + sOff;
  let base = floor(p);
  var energy = 0.0;
  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let cell = base + vec3<f32>(f32(x), f32(y), f32(z));
        let rnd = cHash3v(cell);
        if (rnd.x < 0.86) { continue; } // ~14% of cells host a storm
        let site = cell + cHash3v(cell + 19.0);
        let d = length(p - site);
        let glow = exp(-d * d * 8.0);
        if (glow < 0.003) { continue; }
        let period = 4.0 + 9.0 * rnd.y;
        let tnorm = (time + rnd.z * period) / period;
        let xph = fract(tnorm);
        // Per-cycle amplitude: many cycles are weak/absent, a few are strong,
        // so a given storm doesn't flash identically every period.
        let cycAmp = smoothstep(0.25, 1.0, cHash3v(cell + floor(tnorm) * 1.37).x);
        energy = energy + glow * stormFlicker(xph) * cycAmp;
      }
    }
  }
  return min(energy * (0.15 + 0.85 * density), 3.0);
}

// Emissive color ramp: purple-blue halo brightening to a white-blue core.
fn stormColor(e : f32) -> vec3<f32> {
  let halo = vec3<f32>(0.34, 0.30, 1.00);
  let core = vec3<f32>(0.78, 0.88, 1.00);
  let t = clamp(e, 0.0, 1.0);
  return mix(halo, core, t * t) * e * 2.0;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let n = normalize(in.worldNormal);
  let sun = normalize(frame.keyLightDir.xyz);
  let viewDir = normalize(frame.cameraPos.xyz - in.worldPos);

  // Sample density in the local rotation frame. localPos length is < 1 by a
  // tiny amount due to vertex-attribute interpolation across triangle chords,
  // so normalize to a unit direction before sampling.
  let localDir = normalize(in.localPos);
  let seedf = obj.p1.y;
  let time = obj.p0.z;
  let reducedMotion = frame.misc.y;
  let density = cloudDensity(localDir, time, seedf, reducedMotion);
  let selfShadow = cloudSelfShadow(localDir, sun, time, seedf, reducedMotion);

  // Lighting: diffuse-only white dielectric with a small ambient floor so the
  // unlit side reads as deep grey without a hard terminator. Tinted very
  // slightly by the planet's atmosphere color so clouds feel cohesive.
  let NdL = clamp(dot(n, sun), 0.0, 1.0);
  let albedo = mix(vec3<f32>(1.0), obj.palHigh.rgb, 0.08);
  var col = albedo * (0.05 + 0.95 * NdL) * selfShadow;

  // Per-planet analytic shadow from other planets (no self-exclude needed:
  // the parent planet's surface is behind every cloud fragment along L).
  var s = 1.0;
  let cnt = i32(frame.shadowMisc.x);
  let modelCenter = obj.model[3].xyz;
  for (var i = 0; i < 8; i = i + 1) {
    if (i >= cnt) { break; }
    let sph = frame.shadowSpheres[i];
    if (distance(sph.xyz, modelCenter) < 1e-3) { continue; }
    let d = sph.xyz - in.worldPos;
    let t = dot(d, sun);
    if (t <= 0.0) { continue; }
    let c2 = dot(d, d) - t * t;
    let R2 = sph.w * sph.w;
    s = s * smoothstep(R2, R2 * 1.10, c2);
  }
  col = col * s;

  // Night-side fade: smooth out the cloud alpha across the terminator so we
  // don't see bright clouds on the unlit hemisphere. Slightly past the
  // terminator on both sides for a gentle wrap.
  let dayMask = smoothstep(-0.10, 0.25, dot(n, sun));

  // Fade alpha near the silhouette so the cloud back-face culling doesn't
  // produce a hard cutoff at the limb. Front-faces near the limb have a
  // small dot with the view, so taper alpha as the surface goes edge-on.
  let edgeFade = smoothstep(0.05, 0.30, dot(n, viewDir));

  let vis = obj.p1.w;
  let baseA = density * dayMask * edgeFade * vis;

  // Thunderstorm flashes: localized purple-blue lightning lighting cloud cells
  // from within. Brightest on the night side, faint on the day side. stormA
  // rises with the flash so the emissive color survives the alpha blend even
  // where the night-side cloud alpha is otherwise near zero.
  let storm = cloudStorm(localDir, time, seedf, density, reducedMotion);
  let nightBoost = mix(0.55, 1.0, 1.0 - dayMask);
  col = col + stormColor(storm) * nightBoost;
  let stormA = clamp(storm, 0.0, 1.0) * edgeFade * vis;
  let alpha = max(baseA, stormA);

  // Distance fog attenuation — clouds fade with depth same as everything
  // else. Applied to the alpha so far-away cloud shells don't punch holes
  // in the haze.
  let dist = distance(in.worldPos, frame.cameraPos.xyz);
  let sd = dist * 0.018;
  let fogA = exp(-sd * sd);

  return vec4<f32>(col, alpha * fogA);
}
