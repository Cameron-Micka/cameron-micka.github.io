// Upsamples the low-resolution backdrop target (the nebula raymarch) into the
// full-resolution scene target. Drawn as the very first thing in the scene
// pass, with depth compare `always` and no depth write, so it behaves exactly
// like the fullscreen nebula draw it replaces.
//
// The nebula is the only shader that shades every pixel every frame, and it is
// entirely low-frequency, so rendering it at a fraction of native and letting
// the hardware bilinear filter do the upscale is essentially free visually
// while cutting its cost by the square of the scale factor.
@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var src : texture_2d<f32>;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(3.0, 1.0),
  );
  var out : VSOut;
  let xy = p[vi];
  // z = 1.0 keeps the backdrop at the far plane, matching the nebula.
  out.pos = vec4<f32>(xy, 1.0, 1.0);
  out.uv = vec2<f32>(xy.x, -xy.y) * 0.5 + vec2<f32>(0.5);
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(textureSample(src, samp, in.uv).rgb, 1.0);
}
