// Instanced star sprites on a distant shell. Per-instance position/size/phase;
// subtle twinkle from per-star phase. Additive into the HDR target.
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
  @location(1) intensity : f32,
  @location(2) tint : vec3<f32>,
};

@vertex
fn vs(
  @location(0) corner : vec2<f32>,       // unit quad corner -1..1
  @location(1) center : vec3<f32>,       // star world position
  @location(2) attribs : vec4<f32>,      // x=size y=phase z=tintR w=tintB
) -> VSOut {
  var out : VSOut;
  let clip = frame.viewProj * vec4<f32>(center, 1.0);
  let size = attribs.x;
  // Expand the point into a screen-aligned quad in clip space.
  out.pos = clip + vec4<f32>(corner * size * clip.w, 0.0, 0.0);
  out.uv = corner;
  let tw = 0.6 + 0.4 * sin(frame.misc.x * 2.0 + attribs.y * 6.2831);
  let reduced = frame.misc.y;
  let twinkle = mix(tw, 1.0, reduced);
  out.intensity = twinkle;
  out.tint = vec3<f32>(attribs.z, 1.0, attribs.w);
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let d = length(in.uv);
  let glow = smoothstep(1.0, 0.0, d);
  let core = pow(glow, 4.0);
  let a = core * in.intensity;
  let col = mix(vec3<f32>(0.7, 0.8, 1.0), in.tint, 0.5) * a * 1.6;
  return vec4<f32>(col, a);
}
