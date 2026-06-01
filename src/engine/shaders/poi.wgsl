// Instanced point-of-interest markers. Billboarded glowing discs at each POI's
// world position. Backside POIs arrive pre-dimmed from the CPU. Additive.
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
  @location(1) accent : vec3<f32>,
  @location(2) dim : f32,
};

@vertex
fn vs(
  @location(0) corner : vec2<f32>,   // unit quad -1..1
  @location(1) center : vec3<f32>,   // POI world position
  @location(2) attribs : vec4<f32>,  // x=size y=dim z=accentR w=accentG
  @location(3) accentB : f32,        // accentB
) -> VSOut {
  var out : VSOut;
  let clip = frame.viewProj * vec4<f32>(center, 1.0);
  out.pos = clip + vec4<f32>(corner * attribs.x * clip.w, 0.0, 0.0);
  out.uv = corner;
  out.accent = vec3<f32>(attribs.z, attribs.w, accentB);
  out.dim = attribs.y;
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let d = length(in.uv);
  // Ring-like marker: bright rim, soft center, outer glow.
  let ring = smoothstep(0.85, 0.6, d) - smoothstep(0.5, 0.3, d);
  let glow = smoothstep(1.0, 0.0, d) * 0.5;
  let pulse = 0.75 + 0.25 * sin(frame.misc.x * 3.0);
  let a = clamp((ring + glow) * in.dim * pulse, 0.0, 1.0);
  let col = (in.accent + vec3<f32>(0.2)) * a * 2.0;
  return vec4<f32>(col, a);
}
