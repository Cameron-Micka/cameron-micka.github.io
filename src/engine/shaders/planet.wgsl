// Procedural planet surface (also used for moons).
// Shared frame + per-object uniforms; value-noise fBm drives terrain color
// through three authored palette anchors. Atmosphere is a fresnel rim term.

struct Frame {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  keyLightDir : vec4<f32>,
  misc : vec4<f32>, // x=time, y=reducedMotion, z=qualityScale, w=unused
};

struct Obj {
  model : mat4x4<f32>,
  p0 : vec4<f32>, // x=radius, y=seedf, z=time, w=kind
  palLow : vec4<f32>,
  palMid : vec4<f32>,
  palHigh : vec4<f32>,
  p1 : vec4<f32>, // x=focus, y=hasAtmosphere, z=rotationY, w=unused
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
  for (var i = 0; i < 5; i = i + 1) {
    v = v + a * vnoise(q);
    q = q * 2.02;
    a = a * 0.5;
  }
  return v;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let seed = obj.p0.y;
  let n = normalize(in.nrm);
  let viewDir = normalize(frame.cameraPos.xyz - in.worldPos);
  let lightDir = normalize(frame.keyLightDir.xyz);
  let ndl = clamp(dot(n, lightDir), 0.0, 1.0);
  let rim = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.0);

  // Terrain color from fBm through the palette anchors.
  let sample = in.localPos * (2.2 + seed * 0.0001);
  let h = fbm(sample + vec3<f32>(seed * 0.001));
  let detail = fbm(sample * 4.0) * 0.25;
  let height = clamp(h + detail, 0.0, 1.0);
  var base = mix(obj.palLow.rgb, obj.palMid.rgb, smoothstep(0.25, 0.55, height));
  base = mix(base, obj.palHigh.rgb, smoothstep(0.6, 0.85, height));

  // Terminator shading + a touch of rim/key fill.
  let shade = 0.12 + 0.95 * ndl;
  var color = base * shade;
  let atmoStrength = obj.p1.y;
  let atmo = obj.palHigh.rgb * rim * (0.6 + 0.8 * ndl) * atmoStrength;
  color = color + atmo;

  // Specular pinpoint highlight.
  let half = normalize(lightDir + viewDir);
  let spec = pow(clamp(dot(n, half), 0.0, 1.0), 32.0) * 0.25 * ndl;
  color = color + vec3<f32>(spec);

  // Slight brightness boost for focused planets.
  color = color * (0.85 + 0.3 * obj.p1.x);
  return vec4<f32>(color, 1.0);
}
