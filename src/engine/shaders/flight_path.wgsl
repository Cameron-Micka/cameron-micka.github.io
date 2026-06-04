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
const HALF_THICK : f32 = 0.0032;
// Arrowhead size (aspect-corrected NDC) drawn at the end of the path.
const ARROW_LEN : f32 = 0.024;  // how far the tip extends past the end point
const ARROW_HALF : f32 = 0.013; // half-width of the arrowhead base

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) edge : f32, // -1..1 across the line width, for AA
  @location(1) worldPos : vec3<f32>,
  @location(2) axial : f32, // 0 at prev, 1 at next (for wireframe debug)
  @location(3) shape : f32, // 0 = ribbon segment, 1 = arrowhead
};

@vertex
fn vs(
  @builtin(vertex_index) vid : u32,
  @location(0) prev : vec3<f32>,
  @location(1) next : vec3<f32>,
  @location(2) kind : f32, // 0 = ribbon segment, 1 = arrowhead
) -> VSOut {
  var out : VSOut;
  let aspect = frame.misc.w;
  let ac = vec2<f32>(aspect, 1.0);

  let clipPrev = frame.viewProj * vec4<f32>(prev, 1.0);
  let clipNext = frame.viewProj * vec4<f32>(next, 1.0);
  let ap = (clipPrev.xy / clipPrev.w) * ac;
  let an = (clipNext.xy / clipNext.w) * ac;
  var dir = an - ap;
  let len = length(dir);
  dir = select(vec2<f32>(0.0, 1.0), dir / len, len > 1e-6);
  let perp = vec2<f32>(-dir.y, dir.x);

  if (kind > 0.5) {
    // Camera-facing triangle at the path start (prev), pointing opposite the
    // travel direction (away from next). Three real vertices plus three
    // degenerate fillers so it can share the 6-vertex-per-instance ribbon draw.
    var aoff = array<vec2<f32>, 6>(
      -dir * ARROW_LEN,   // tip, pointing away from the path
      -perp * ARROW_HALF, // left barb at the start point
      perp * ARROW_HALF,  // right barb at the start point
      -dir * ARROW_LEN,   // degenerate fillers (collapse to the tip)
      -dir * ARROW_LEN,
      -dir * ARROW_LEN,
    );
    let pa = ap + aoff[vid];
    let ndcA = vec2<f32>(pa.x / aspect, pa.y);
    out.pos = vec4<f32>(ndcA * clipPrev.w, clipPrev.z, clipPrev.w);
    out.edge = 0.0;
    out.worldPos = prev;
    out.axial = 1.0;
    out.shape = 1.0;
    return out;
  }

  // Two-triangle quad spanning prev->next with perpendicular side offset.
  var ends  = array<f32, 6>(0.0, 1.0, 1.0, 0.0, 1.0, 0.0);
  var sides = array<f32, 6>(-1.0, -1.0, 1.0, -1.0, 1.0, 1.0);
  let isEnd = ends[vid] > 0.5;
  let side = sides[vid];

  let chosen = select(ap, an, isEnd);
  let z = select(clipPrev.z, clipNext.z, isEnd);
  let w = select(clipPrev.w, clipNext.w, isEnd);

  let p = chosen + perp * side * HALF_THICK;
  let ndc = vec2<f32>(p.x / aspect, p.y);
  out.pos = vec4<f32>(ndc * w, z, w);
  out.edge = side;
  out.worldPos = select(prev, next, isEnd);
  out.axial = ends[vid];
  out.shape = 0.0;
  return out;
}

// Distance fog: matches planet/clouds/atmosphere exp-squared falloff so the
// trajectory fades into the background haze instead of staying crisp white
// in front of distant nebulae and stars.
const FOG_DENSITY : f32 = 0.030;

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let wf = frame.misc.z;
  if (wf > 0.5) {
    // Wireframe debug: 4 quad edges + diagonal of each segment's two
    // triangles, drawn in cyan to match the planet wireframe. The arrowhead
    // is filled solid in the same cyan.
    let edgeD = 1.0 - abs(in.edge);
    let axialD = min(in.axial, 1.0 - in.axial);
    let diagD = abs(in.axial - 0.5 * (in.edge + 1.0));
    let aaE = fwidth(edgeD);
    let aaA = fwidth(axialD);
    let aaD = fwidth(diagD);
    let covE = 1.0 - smoothstep(0.0, 1.5 * aaE, edgeD);
    let covA = 1.0 - smoothstep(0.0, 1.5 * aaA, axialD);
    let covD = 1.0 - smoothstep(0.0, 1.5 * aaD, diagD);
    let ribbonCov = max(covE, max(covA, covD));
    let a = select(ribbonCov, 1.0, in.shape > 0.5);
    return vec4<f32>(vec3<f32>(0.25, 1.0, 0.85) * a, a);
  }
  let aa = fwidth(in.edge);
  let cov = 1.0 - smoothstep(1.0 - aa, 1.0, abs(in.edge));
  let d = distance(in.worldPos, frame.cameraPos.xyz);
  let s = d * FOG_DENSITY;
  let fogA = exp(-s * s);
  // Ribbon fades with edge AA; the arrowhead fills solid (MSAA handles edges).
  let ribbonA = 0.85 * cov * fogA;
  let arrowA = 0.95 * fogA;
  let a = select(ribbonA, arrowA, in.shape > 0.5);
  return vec4<f32>(vec3<f32>(0.75) * a, a);
}
