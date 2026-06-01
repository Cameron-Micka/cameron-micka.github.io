// Fullscreen nebula backdrop. Drawn first into the HDR target with no depth.
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

fn hash2(p : vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn noise2(p : vec2<f32>) -> f32 {
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
  for (var i = 0; i < 5; i = i + 1) {
    v = v + a * noise2(q);
    q = q * 2.03;
    a = a * 0.5;
  }
  return v;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p = uv * 3.0;
  let c = fbm2(p + vec2<f32>(2.0, 1.0));
  let c2 = fbm2(p * 1.7 - vec2<f32>(5.0, 3.0));

  let deep = vec3<f32>(0.012, 0.016, 0.035);
  let purple = vec3<f32>(0.10, 0.06, 0.22);
  let blue = vec3<f32>(0.04, 0.12, 0.30);

  var col = deep;
  col = mix(col, purple, smoothstep(0.45, 0.85, c) * 0.7);
  col = mix(col, blue, smoothstep(0.5, 0.95, c2) * 0.5);

  // Subtle central glow toward the vanishing point.
  let d = distance(uv, vec2<f32>(0.5, 0.42));
  col = col + vec3<f32>(0.10, 0.14, 0.22) * smoothstep(0.6, 0.0, d) * 0.5;
  return vec4<f32>(col, 1.0);
}
