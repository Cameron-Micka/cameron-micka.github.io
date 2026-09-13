// Single-scattering atmosphere with Rayleigh/Mie density profiles. Optical
// depths use shell-thickness units so differently sized planets share the
// same atmosphere. The additive pass contributes attenuated in-scattered light.

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
@group(2) @binding(0) var opticalDepthLut : texture_2d<f32>;

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

// Other bodies cast analytic shadows; the parent is tested along each sun ray.
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

fn airDensity(pos : vec3<f32>, center : vec3<f32>, innerR : f32, thickness : f32) -> vec2<f32> {
  let altitude = clamp((length(pos - center) - innerR) / thickness, 0.0, 1.0);
  let falloff = vec2<f32>(6.0, 18.0);
  return max((exp(-altitude * falloff) - exp(-falloff)) / (vec2<f32>(1.0) - exp(-falloff)), vec2<f32>(0.0));
}

fn sunlightDepth(pos : vec3<f32>, center : vec3<f32>, sun : vec3<f32>, innerR : f32, thickness : f32) -> vec2<f32> {
  let up = pos - center;
  let radius = length(up);
  let altitude = clamp((radius - innerR) / thickness, 0.0, 1.0);
  let radiusRatio = innerR / radius;
  let horizonCosine = -sqrt(max(1.0 - radiusRatio * radiusRatio, 0.0));
  let angleCoord = sqrt(clamp((dot(up, sun) / radius - horizonCosine) / (1.0 - horizonCosine), 0.0, 1.0));
  let dimensions = vec2<i32>(textureDimensions(opticalDepthLut));
  let coord = vec2<f32>(angleCoord, sqrt(altitude)) * vec2<f32>(dimensions - vec2<i32>(1));
  let base = min(vec2<i32>(coord), dimensions - vec2<i32>(2));
  let blend = coord - vec2<f32>(base);
  let lower = mix(textureLoad(opticalDepthLut, base, 0).xy,
    textureLoad(opticalDepthLut, base + vec2<i32>(1, 0), 0).xy, blend.x);
  let upper = mix(textureLoad(opticalDepthLut, base + vec2<i32>(0, 1), 0).xy,
    textureLoad(opticalDepthLut, base + vec2<i32>(1, 1), 0).xy, blend.x);
  return mix(lower, upper, blend.y);
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
  let tNear = max(outer.x, 0.0);
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
  let betaRayleigh = vec3<f32>(0.32, 0.75, 1.83) * mix(vec3<f32>(1.0), obj.palHigh.rgb, 0.08);
  let betaMie = vec3<f32>(0.22);
  let betaMieExtinction = betaMie / 0.9;
  let cosine = clamp(dot(rd, sun), -1.0, 1.0);
  let phaseRayleigh = 3.0 * (1.0 + cosine * cosine) / (16.0 * 3.14159265);
  let anisotropy = 0.76;
  let phaseMie = (1.0 - anisotropy * anisotropy) /
    (4.0 * 3.14159265 * pow(1.0 + anisotropy * anisotropy - 2.0 * anisotropy * cosine, 1.5));
  let lowQuality = frame.shadowMisc.y >= 1.5;
  let STEPS = select(16, 8, lowQuality);
  let LIGHT_STEPS = 8;
  let dt = (tFar - tNear) / f32(STEPS);
  let stepLength = dt / thickness;
  var viewDepth = vec2<f32>(0.0);
  var col = vec3<f32>(0.0);
  for (var i = 0; i < STEPS; i = i + 1) {
    let t = tNear + (f32(i) + 0.5) * dt;
    let pos = ro + rd * t;
    let density = airDensity(pos, center, innerR, thickness);
    let segmentDepth = density * stepLength;
    viewDepth = viewDepth + segmentDepth * 0.5;
    let ground = raySphere(pos, sun, center, innerR);
    if (!(ground.x > 0.0 && ground.y > ground.x)) {
      var lightDepth = vec2<f32>(0.0);
      if (lowQuality) {
        lightDepth = sunlightDepth(pos, center, sun, innerR, thickness);
      } else {
        let lightDistance = max(raySphere(pos, sun, center, outerR).y, 0.0);
        for (var j = 0; j < LIGHT_STEPS; j = j + 1) {
          let start = f32(j) / f32(LIGHT_STEPS);
          let end = f32(j + 1) / f32(LIGHT_STEPS);
          let lightStart = start * start * lightDistance;
          let lightEnd = end * end * lightDistance;
          let lightPos = pos + sun * (lightStart + lightEnd) * 0.5;
          lightDepth = lightDepth + airDensity(lightPos, center, innerR, thickness) *
            ((lightEnd - lightStart) / thickness);
        }
      }
      let opticalDepth = viewDepth + lightDepth;
      let transmittance = exp(-(betaRayleigh * opticalDepth.x + betaMieExtinction * opticalDepth.y));
      let scattering = betaRayleigh * (density.x * phaseRayleigh) + betaMie * (density.y * phaseMie);
      col = col + transmittance * scattering * (stepLength * shadowFactor(pos, sun, center));
    }
    viewDepth = viewDepth + segmentDepth * 0.5;
  }
  let focus = obj.p1.x;
  let intensity = obj.p1.y * (0.85 + 0.3 * focus);
  col = col * (5.0 * intensity);

  // Distance fog (matches planet + ring): additive shell, so just attenuate
  // the contribution rather than mixing toward a colour.
  let dist = distance(in.worldPos, ro);
  let s = dist * 0.018;
  col = col * exp(-s * s);

  return vec4<f32>(col, 1.0);
}
