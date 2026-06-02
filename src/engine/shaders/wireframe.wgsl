// Debug wireframe pass: transforms the shared mesh vertex layout with the
// per-object model matrix and emits a flat, bright edge color. Drawn with
// line-list topology using an edge index buffer derived from the triangle mesh.

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

@vertex
fn vs(
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv : vec2<f32>,
) -> @builtin(position) vec4<f32> {
  let world = obj.model * vec4<f32>(position, 1.0);
  return frame.viewProj * world;
}

@fragment
fn fs() -> @location(0) vec4<f32> {
  return vec4<f32>(0.25, 1.0, 0.85, 1.0);
}
