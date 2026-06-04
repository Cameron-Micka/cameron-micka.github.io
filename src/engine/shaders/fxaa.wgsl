// FXAA post pass. Runs after composite/tonemap on the gamma-encoded LDR image
// and smooths luminance edges left behind once MSAA no longer covers shader
// aliasing (specular highlights, thin POI lines, planet limbs). Compact
// Timothy Lottes FXAA (the widely used mattdesl WebGL port) adapted to WGSL.
@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var srcTex : texture_2d<f32>;

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
  out.pos = vec4<f32>(xy, 0.0, 1.0);
  out.uv = vec2<f32>(xy.x, -xy.y) * 0.5 + vec2<f32>(0.5);
  return out;
}

const LUMA = vec3<f32>(0.299, 0.587, 0.114);
const REDUCE_MIN = 1.0 / 128.0;
const REDUCE_MUL = 1.0 / 8.0;
const SPAN_MAX = 8.0;
// Local contrast below this (relative to the brightest neighbor) is treated as
// flat and left untouched — the standard FXAA edge gate.
const EDGE_THRESHOLD = 0.125;
const EDGE_MIN = 0.0312;
// If the center pixel is brighter than every diagonal neighbor by more than
// this, treat it as an isolated emissive sprite (city light, star, POI dot)
// and skip FXAA so its bright core isn't smeared into a blocky streak.
const POINT_GUARD = 0.10;

fn sample(uv : vec2<f32>) -> vec3<f32> {
  return textureSampleLevel(srcTex, samp, uv, 0.0).rgb;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let dim = vec2<f32>(textureDimensions(srcTex));
  let texel = vec2<f32>(1.0) / dim;
  let uv = in.uv;

  let rgbNW = sample(uv + vec2<f32>(-1.0, -1.0) * texel);
  let rgbNE = sample(uv + vec2<f32>(1.0, -1.0) * texel);
  let rgbSW = sample(uv + vec2<f32>(-1.0, 1.0) * texel);
  let rgbSE = sample(uv + vec2<f32>(1.0, 1.0) * texel);
  let rgbM = sample(uv);

  let lumaNW = dot(rgbNW, LUMA);
  let lumaNE = dot(rgbNE, LUMA);
  let lumaSW = dot(rgbSW, LUMA);
  let lumaSE = dot(rgbSE, LUMA);
  let lumaM = dot(rgbM, LUMA);

  let lumaNeighborMax = max(max(lumaNW, lumaNE), max(lumaSW, lumaSE));
  let lumaNeighborMin = min(min(lumaNW, lumaNE), min(lumaSW, lumaSE));
  let lumaMin = min(lumaM, lumaNeighborMin);
  let lumaMax = max(lumaM, lumaNeighborMax);

  // Skip flat regions and isolated bright sprites. (sample() uses an explicit
  // LOD, so this early-out is free of any derivative/uniformity constraint.)
  if (lumaMax - lumaMin < max(EDGE_MIN, lumaMax * EDGE_THRESHOLD) ||
      lumaM - lumaNeighborMax > POINT_GUARD) {
    return vec4<f32>(rgbM, 1.0);
  }

  var dir : vec2<f32>;
  dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
  dir.y = ((lumaNW + lumaSW) - (lumaNE + lumaSE));

  let dirReduce = max(
    (lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * REDUCE_MUL),
    REDUCE_MIN,
  );
  let rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2<f32>(-SPAN_MAX), vec2<f32>(SPAN_MAX)) * texel;

  let rgbA = 0.5 * (
    sample(uv + dir * (1.0 / 3.0 - 0.5)) +
    sample(uv + dir * (2.0 / 3.0 - 0.5))
  );
  let rgbB = rgbA * 0.5 + 0.25 * (
    sample(uv + dir * -0.5) +
    sample(uv + dir * 0.5)
  );

  let lumaB = dot(rgbB, LUMA);
  var col = rgbB;
  if (lumaB < lumaMin || lumaB > lumaMax) {
    col = rgbA;
  }
  return vec4<f32>(col, 1.0);
}
