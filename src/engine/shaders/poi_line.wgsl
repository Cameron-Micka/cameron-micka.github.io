// Thick connector "lines" from a planet's surface up to each floating POI
// marker, rendered as camera-facing quads (GPU line primitives are limited to
// 1px). One instanced quad (2 triangles) per POI. The quad is built in
// aspect-corrected NDC so the line keeps a constant on-screen thickness, with
// screen-space-derivative anti-aliasing across its width. The outer end stops
// at the marker circle's rim rather than its center. Additive, depth-tested
// like the markers so the planet occludes connectors on its far side.
struct Frame {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  keyLightDir : vec4<f32>,
  misc : vec4<f32>,    // x=time y=reducedMotion z=unused w=aspect(width/height)
};
@group(0) @binding(0) var<uniform> frame : Frame;

// Half-thickness of the connector in aspect-corrected NDC (constant pixels).
const HALF_THICK : f32 = 0.0035;
// Marker circle rim radius in NDC per unit of marker `size` (the billboard
// draws its rim at uv radius 0.85).
const CIRCLE_R : f32 = 0.85;
// UI accent orange (--accent: #ff7a18) so connectors match the interface.
const UI_ACCENT : vec3<f32> = vec3<f32>(1.0, 0.478, 0.094);

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) color : vec3<f32>,
  @location(1) alpha : f32,
  @location(2) edge : f32,  // -1..1 across the line width, for AA
  @location(3) axial : f32, // 0 at inner end, 1 at outer end (for wireframe debug)
};

@vertex
fn vs(
  @builtin(vertex_index) vid : u32,
  @location(0) inner : vec3<f32>,    // point on the planet surface
  @location(1) outer : vec3<f32>,    // floating marker position (circle center)
  @location(2) attribs : vec4<f32>,  // x=size y=dim z=accentR w=accentG
  @location(3) accentB : f32,
) -> VSOut {
  var out : VSOut;
  let aspect = frame.misc.w;
  let ac = vec2<f32>(aspect, 1.0);

  // Quad layout: two triangles spanning inner->outer. ends[] selects the
  // endpoint, sides[] the perpendicular offset.
  var ends = array<f32, 6>(0.0, 1.0, 1.0, 0.0, 1.0, 0.0);
  var sides = array<f32, 6>(-1.0, -1.0, 1.0, -1.0, 1.0, 1.0);
  let isOuter = ends[vid] > 0.5;
  let side = sides[vid];

  let clipInner = frame.viewProj * vec4<f32>(inner, 1.0);
  let clipOuter = frame.viewProj * vec4<f32>(outer, 1.0);

  // Endpoints in aspect-corrected NDC.
  let ai = (clipInner.xy / clipInner.w) * ac;
  var ao = (clipOuter.xy / clipOuter.w) * ac;
  var dir = ao - ai;
  let len = length(dir);
  dir = select(vec2<f32>(0.0, 1.0), dir / len, len > 1e-6);
  let perp = vec2<f32>(-dir.y, dir.x);

  // Stop the line at the rim of the marker circle instead of its center.
  ao = ao - dir * (CIRCLE_R * attribs.x);

  let chosen = select(ai, ao, isOuter);
  let z = select(clipInner.z, clipOuter.z, isOuter);
  let w = select(clipInner.w, clipOuter.w, isOuter);

  let p = chosen + perp * side * HALF_THICK;
  let ndc = vec2<f32>(p.x / aspect, p.y);
  out.pos = vec4<f32>(ndc * w, z, w);

  out.color = UI_ACCENT;
  // Brighter near the marker, faint where it meets the surface.
  out.alpha = attribs.y * select(0.25, 0.9, isOuter);
  out.edge = side;
  out.axial = ends[vid];
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let wf = frame.misc.z;
  if (wf > 0.5) {
    // Wireframe debug: 4 quad edges (|edge|=1, axial=0, axial=1) + the
    // diagonal that splits its two triangles (axial = 0.5*(edge+1)).
    let edgeD = 1.0 - abs(in.edge);
    let axialD = min(in.axial, 1.0 - in.axial);
    let diagD = abs(in.axial - 0.5 * (in.edge + 1.0));
    let aaE = fwidth(edgeD);
    let aaA = fwidth(axialD);
    let aaD = fwidth(diagD);
    let covE = 1.0 - smoothstep(0.0, 1.5 * aaE, edgeD);
    let covA = 1.0 - smoothstep(0.0, 1.5 * aaA, axialD);
    let covD = 1.0 - smoothstep(0.0, 1.5 * aaD, diagD);
    let a = max(covE, max(covA, covD));
    return vec4<f32>(vec3<f32>(0.25, 1.0, 0.85) * a, a);
  }
  // Screen-space derivative AA across the line width.
  let aa = fwidth(in.edge);
  let cov = 1.0 - smoothstep(1.0 - aa, 1.0, abs(in.edge));
  let a = in.alpha * cov;
  let base = in.color + vec3<f32>(0.15);
  return vec4<f32>(base * a, a);
}
