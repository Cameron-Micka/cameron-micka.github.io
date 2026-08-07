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
  out.intensity = tw;
  out.tint = vec3<f32>(attribs.z, 1.0, attribs.w);
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let wf = frame.misc.z;
  if (wf > 0.5) {
    // Wireframe debug: render the underlying billboard quad as cyan
    // edges + the diagonal that splits its two triangles, matching the
    // planet wireframe style instead of a glowing point.
    let edgeDist = min(1.0 - abs(in.uv.x), 1.0 - abs(in.uv.y));
    let diagDist = abs(in.uv.x + in.uv.y) * 0.70710678;
    let lineDist = min(edgeDist, diagDist);
    let aaLine = length(vec2<f32>(dpdx(lineDist), dpdy(lineDist)));
    let a = 1.0 - smoothstep(0.0, 1.5 * aaLine, lineDist);
    return vec4<f32>(vec3<f32>(0.25, 1.0, 0.85) * a, a);
  }
  let d = length(in.uv);
  let glow = smoothstep(1.0, 0.0, d);
  let glow2 = glow * glow;
  let core = glow2 * glow2;
  let a = core * in.intensity;
  let col = mix(vec3<f32>(0.7, 0.8, 1.0), in.tint, 0.5) * a * 1.6;
  return vec4<f32>(col, a);
}
