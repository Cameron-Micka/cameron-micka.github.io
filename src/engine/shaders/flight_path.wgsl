// Spacecraft trajectory ribbon: a continuous polyline of world-space samples
// rendered as camera-facing quads (one instanced quad per segment) so the line
// keeps a constant on-screen thickness. Mirrors the poi_line.wgsl pattern;
// drawn after all opaque + transparent scene passes so it overlays the
// atmosphere/clouds without being blended away.

struct Frame {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  keyLightDir : vec4<f32>,
  misc : vec4<f32>,    // w=aspect(width/height)
};
@group(0) @binding(0) var<uniform> frame : Frame;

// Half-thickness of the trajectory line in aspect-corrected NDC.
const HALF_THICK : f32 = 0.0022;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) edge : f32, // -1..1 across the line width, for AA
  @location(1) worldPos : vec3<f32>,
};

@vertex
fn vs(
  @builtin(vertex_index) vid : u32,
  @location(0) prev : vec3<f32>,
  @location(1) next : vec3<f32>,
) -> VSOut {
  var out : VSOut;
  let aspect = frame.misc.w;
  let ac = vec2<f32>(aspect, 1.0);

  // Two-triangle quad spanning prev->next with perpendicular side offset.
  var ends  = array<f32, 6>(0.0, 1.0, 1.0, 0.0, 1.0, 0.0);
  var sides = array<f32, 6>(-1.0, -1.0, 1.0, -1.0, 1.0, 1.0);
  let isEnd = ends[vid] > 0.5;
  let side = sides[vid];

  let clipPrev = frame.viewProj * vec4<f32>(prev, 1.0);
  let clipNext = frame.viewProj * vec4<f32>(next, 1.0);
  let ap = (clipPrev.xy / clipPrev.w) * ac;
  let an = (clipNext.xy / clipNext.w) * ac;
  var dir = an - ap;
  let len = length(dir);
  dir = select(vec2<f32>(0.0, 1.0), dir / len, len > 1e-6);
  let perp = vec2<f32>(-dir.y, dir.x);

  let chosen = select(ap, an, isEnd);
  let z = select(clipPrev.z, clipNext.z, isEnd);
  let w = select(clipPrev.w, clipNext.w, isEnd);

  let p = chosen + perp * side * HALF_THICK;
  let ndc = vec2<f32>(p.x / aspect, p.y);
  out.pos = vec4<f32>(ndc * w, z, w);
  out.edge = side;
  out.worldPos = select(prev, next, isEnd);
  return out;
}

// Distance fog: matches planet/clouds/atmosphere exp-squared falloff so the
// trajectory fades into the background haze instead of staying crisp white
// in front of distant nebulae and stars.
const FOG_DENSITY : f32 = 0.030;

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let aa = fwidth(in.edge);
  let cov = 1.0 - smoothstep(1.0 - aa, 1.0, abs(in.edge));
  let d = distance(in.worldPos, frame.cameraPos.xyz);
  let s = d * FOG_DENSITY;
  let fogA = exp(-s * s);
  let a = 0.85 * cov * fogA;
  return vec4<f32>(vec3<f32>(1.0) * a, a);
}
