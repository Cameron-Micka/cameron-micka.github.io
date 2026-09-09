// Bounded single scattering in a spherical Rayleigh/Mie atmosphere.
// Premultiplied composition: scattering + background * viewTransmission.
// RGB sunlight extinction preserves sunset color; background extinction uses
// a scalar RGB mean because fixed-function blending cannot transmit per channel.

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

// The parent planet is tested exactly along each sun ray in the integrator.
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
  // Tier is 0=high, 1=medium, 2=low. All loops have fixed upper bounds.
  let steps = select(select(12, 8, frame.shadowMisc.y > 0.5), 6, frame.shadowMisc.y > 1.5);
  let sunSteps = select(4, 2, frame.shadowMisc.y > 0.5);
  let dt = (tFar - tNear) / f32(steps);
  let ds = dt / thickness;
  let betaR = vec3<f32>(0.18, 0.42, 0.90) * mix(vec3<f32>(1.0), max(obj.palHigh.rgb, vec3<f32>(0.05)), 0.25);
  let betaM = vec3<f32>(0.12);
  let mu = clamp(dot(rd, sun), -1.0, 1.0);
  let phaseR = 3.0 * (1.0 + mu * mu) / (16.0 * 3.14159265);
  let g = 0.76;
  let phaseM = (1.0 - g * g) / (4.0 * 3.14159265 * pow(max(1.0 + g * g - 2.0 * g * mu, 0.01), 1.5));
  var viewTau = 0.0;
  var col = vec3<f32>(0.0);
  for (var i = 0; i < 12; i = i + 1) {
    if (i >= steps) { break; }
    let t = tNear + (f32(i) + 0.5) * dt;
    let pos = ro + rd * t;
    let h = clamp((length(pos - center) - innerR) / thickness, 0.0, 1.0);
    let density = exp(-vec2<f32>(4.0, 12.0) * h);
    let extinction = betaR * density.x + betaM * density.y;
    let scalarExt = dot(extinction, vec3<f32>(1.0 / 3.0));
    let stepTau = min(scalarExt * ds, 20.0);
    let stepWeight = exp(-viewTau) * (1.0 - exp(-stepTau)) / max(scalarExt, 1e-5);
    viewTau = min(viewTau + stepTau, 20.0);

    // Twilight follows geometric planet occlusion, not a normal/limb gate.
    let ground = raySphere(pos, sun, center, innerR);
    if (ground.x >= 0.0 && ground.y > ground.x) { continue; }
    let sunExit = raySphere(pos, sun, center, outerR).y;
    let sunDt = max(sunExit, 0.0) / f32(sunSteps);
    var sunDepth = vec2<f32>(0.0);
    for (var j = 0; j < 4; j = j + 1) {
      if (j >= sunSteps) { break; }
      let sp = pos + sun * ((f32(j) + 0.5) * sunDt);
      let sh = clamp((length(sp - center) - innerR) / thickness, 0.0, 1.0);
      sunDepth = sunDepth + exp(-vec2<f32>(4.0, 12.0) * sh) * (sunDt / thickness);
    }
    let sunTransmission = exp(-min(betaR * sunDepth.x + betaM * sunDepth.y, vec3<f32>(20.0)));
    let scattering = betaR * density.x * phaseR + betaM * density.y * phaseM;
    // Same unit-albedo solar irradiance (PI) as the surface BRDF.
    col = col + scattering * sunTransmission * stepWeight * shadowFactor(pos, sun, center) * 3.14159265;
  }
  let dist = distance(in.worldPos, ro);
  let s = dist * 0.018;
  let visibility = clamp(obj.p1.y, 0.0, 1.0) * exp(-s * s);
  return vec4<f32>(col * visibility, (1.0 - exp(-viewTau)) * visibility);
}
