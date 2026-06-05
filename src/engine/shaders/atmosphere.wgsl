// Atmospheric scattering shell. A sphere slightly larger than the planet is
// drawn additively; for each fragment we march the view ray through the shell
// (terminating at the planet surface when it is occluded) and accumulate an
// altitude-weighted, sun-lit density. This yields a soft blue limb glow that is
// brightest on the day side and fades into space — similar to views of Earth.

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
  p0 : vec4<f32>, // x=innerRadius(world) y=outerRadius(world) z=time w=kind
  palLow : vec4<f32>,
  palMid : vec4<f32>,
  palHigh : vec4<f32>, // rgb = atmosphere base color
  p1 : vec4<f32>, // x=focus y=intensity z,w=unused
};

@group(0) @binding(0) var<uniform> frame : Frame;
@group(1) @binding(0) var<uniform> obj : Obj;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) worldPos : vec3<f32>,
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
  out.worldPos = world.xyz;
  return out;
}

// Intersect a ray with a sphere. Returns (tNear, tFar); tNear > tFar on a miss.
fn raySphere(ro : vec3<f32>, rd : vec3<f32>, ce : vec3<f32>, ra : f32) -> vec2<f32> {
  let oc = ro - ce;
  let b = dot(oc, rd);
  let c = dot(oc, oc) - ra * ra;
  let h = b * b - c;
  if (h < 0.0) {
    return vec2<f32>(1.0, -1.0);
  }
  let s = sqrt(h);
  return vec2<f32>(-b - s, -b + s);
}

// Analytic shadow factor against the frame's sphere occluder list, with an
// exclusion (the parent planet whose atmosphere we're shading) so we don't
// double-darken the night side, which the per-sample sunAmt gate already
// handles. Returns 1.0 unshadowed, 0.0 fully shadowed.
fn shadowFactor(p : vec3<f32>, L : vec3<f32>, exclude : vec3<f32>) -> f32 {
  var s = 1.0;
  let cnt = i32(frame.shadowMisc.x);
  for (var i = 0; i < 8; i = i + 1) {
    if (i >= cnt) { break; }
    let sph = frame.shadowSpheres[i];
    if (distance(sph.xyz, exclude) < 1e-3) { continue; }
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
  let center = obj.model[3].xyz;
  let innerR = obj.p0.x;
  let outerR = obj.p0.y;
  let ro = frame.cameraPos.xyz;
  let rd = normalize(in.worldPos - ro);
  let sun = normalize(frame.keyLightDir.xyz);

  let outer = raySphere(ro, rd, center, outerR);
  if (outer.y <= outer.x) {
    return vec4<f32>(0.0);
  }
  var tNear = max(outer.x, 0.0);
  var tFar = outer.y;

  // The opaque planet truncates the column of atmosphere we can see through.
  let inner = raySphere(ro, rd, center, innerR);
  if (inner.x > 0.0 && inner.x < inner.y) {
    tFar = min(tFar, inner.x);
  }
  if (tFar <= tNear) {
    return vec4<f32>(0.0);
  }

  let thickness = max(outerR - innerR, 1e-4);
  let STEPS = 12;
  let dt = (tFar - tNear) / f32(STEPS);
  var dayGlow = 0.0;
  var ambient = 0.0;
  for (var i = 0; i < STEPS; i = i + 1) {
    let t = tNear + (f32(i) + 0.5) * dt;
    let pos = ro + rd * t;
    let up = pos - center;
    let r = length(up);
    let hgt = clamp((r - innerR) / thickness, 0.0, 1.0);
    let density = exp(-hgt * 4.0);
    // Sun gate starts past the terminator so night-side samples contribute 0.
    let sunAmt = smoothstep(0.05, 0.40, dot(normalize(up), sun));
    // Per-sample analytic shadow from other planets (self excluded so we
    // don't double-darken what sunAmt already handles).
    let shadow = shadowFactor(pos, sun, center);
    dayGlow = dayGlow + density * sunAmt * shadow * dt;
    ambient = ambient + density * dt;
  }
  dayGlow = dayGlow / thickness;
  ambient = ambient / thickness;

  let atmoColor = mix(obj.palHigh.rgb, vec3<f32>(0.45, 0.62, 1.0), 0.5);
  let focus = obj.p1.x;
  let intensity = obj.p1.y * (0.85 + 0.3 * focus);

  // Limb-sun gate: zero the whole shell on rays whose closest approach to
  // the planet center sits on the night-side hemisphere. Cubed so values
  // near the terminator are aggressively pushed toward zero, keeping the
  // bright-side rim intact while the night-side rim fully disappears.
  let tLimb = max(0.0, -dot(ro - center, rd));
  let limbPos = ro + rd * tLimb;
  let limbNormal = normalize(limbPos - center);
  let limbSunRaw = smoothstep(0.10, 0.40, dot(limbNormal, sun));
  let limbSun = limbSunRaw * limbSunRaw * limbSunRaw;

  var col = atmoColor * dayGlow * 0.55 * intensity;

  // Subtle forward (Mie) scatter where we look toward the sun through the shell.
  let mie = pow(max(dot(rd, sun), 0.0), 8.0) * dayGlow * 0.22;
  col = col + atmoColor * mie * intensity;

  // Surface-aware limb gate: limbSun is geared for *limb* (miss) rays where
  // it kills the night-side rim glow. For rays that pierce the planet's
  // disk, the per-sample `sunAmt` smoothstep above already provides a
  // smooth terminator on the haze accumulated through the column — and
  // applying the cubed limbSun on top of that paints a sharp angular cut
  // across the lit disk (visible from close-up free-cam views). Soft-blend
  // from limbSun at the silhouette to 1.0 inside the disk using the
  // ray's chord length through the inner sphere, so the silhouette stays
  // a continuous ring rather than swapping discretely.
  let hitsPlanet = inner.x > 0.0 && inner.x < inner.y;
  let innerSpan = max(inner.y - inner.x, 0.0);
  let surfaceBlend = smoothstep(0.0, thickness * 0.25, innerSpan);
  let limbBlend = select(0.0, surfaceBlend, hitsPlanet);
  let surfaceGate = mix(limbSun, 1.0, limbBlend);
  col = col * surfaceGate;

  // Distance fog (matches planet + ring): additive shell, so just attenuate
  // the contribution rather than mixing toward a colour.
  let dist = distance(in.worldPos, ro);
  let s = dist * 0.018;
  col = col * exp(-s * s);

  return vec4<f32>(col, 1.0);
}
