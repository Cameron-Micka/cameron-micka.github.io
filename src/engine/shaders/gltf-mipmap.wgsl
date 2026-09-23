@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
  let x = f32((index << 1u) & 2u);
  let y = f32(index & 2u);
  var out: VertexOutput;
  out.position = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = vec2<f32>(x, y);
  return out;
}

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4<f32> {
  // A single-level view prevents read/write overlap. sRGB storage decodes on
  // sampling and re-encodes on attachment writes, averaging in linear light.
  return textureSample(sourceTexture, sourceSampler, input.uv);
}
