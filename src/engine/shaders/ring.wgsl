// Planetary ring. A flat annulus mesh oriented by the object model matrix.
struct Frame {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  keyLightDir : vec4<f32>,
  misc : vec4<f32>,
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
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  // Banded translucency across the ring width.
  let bands = 0.5 + 0.5 * sin(in.radial * 60.0);
  let edge = smoothstep(0.0, 0.08, in.radial) *
             smoothstep(1.0, 0.92, in.radial);
  let a = edge * (0.25 + 0.35 * bands) * (0.5 + 0.5 * obj.p1.x);
  let col = mix(obj.palMid.rgb, obj.palHigh.rgb, bands);
  return vec4<f32>(col * a * 1.4, a);
}
