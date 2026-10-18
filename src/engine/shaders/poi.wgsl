// Instanced point-of-interest markers. Billboarded pin heads at each POI's
// world position. Backside POIs arrive pre-dimmed from the CPU. Additive.
struct Frame {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  keyLightDir : vec4<f32>,
  misc : vec4<f32>,
};
@group(0) @binding(0) var<uniform> frame : Frame;

// UI accent orange (--accent: #ff7a18) so the 3D markers match the interface.
const UI_ACCENT : vec3<f32> = vec3<f32>(1.0, 0.478, 0.094);
// Match the connector's HALF_THICK in poi_line.wgsl, then convert to billboard UV.
const HALF_THICK : f32 = 0.0035;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) accent : vec3<f32>,
  @location(2) dim : f32,
  @location(3) ordinal : f32,
  @location(4) highlight : f32,
  @location(5) halfThick : f32,
};

@vertex
fn vs(
  @location(0) corner : vec2<f32>,   // unit quad -1..1
  @location(1) center : vec3<f32>,   // POI world position
  @location(2) attribs : vec4<f32>,  // x=size y=dim z=accentR w=accentG
  @location(3) accentB : f32,        // accentB
  @location(4) ordinal : f32,        // one-based POI order for the shimmer
  @location(5) highlight : f32,      // 1 for career highlights, else 0
) -> VSOut {
  var out : VSOut;
  let clip = frame.viewProj * vec4<f32>(center, 1.0);
  // Aspect-correct the x offset (misc.w = width/height) so the billboard
  // stays a circle instead of stretching into an ellipse on resize.
  let aspect = frame.misc.w;
  let offset = vec2<f32>(corner.x / aspect, corner.y) * attribs.x * clip.w;
  out.pos = clip + vec4<f32>(offset, 0.0, 0.0);
  out.uv = corner;
  out.accent = vec3<f32>(attribs.z, attribs.w, accentB);
  out.dim = attribs.y;
  out.ordinal = ordinal;
  out.highlight = highlight;
  out.halfThick = HALF_THICK / attribs.x;
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let wf = frame.misc.z;
  if (wf > 0.5) {
    // Wireframe debug: render the underlying billboard quad as orange edges
    // plus the diagonal that splits its two triangles (the shared edge
    // runs (1,-1) -> (-1,1), i.e. uv.x + uv.y = 0). Matches the planet
    // wireframe style instead of faking a circle.
    let edgeDist = min(1.0 - abs(in.uv.x), 1.0 - abs(in.uv.y));
    let diagDist = abs(in.uv.x + in.uv.y) * 0.70710678;
    let lineDist = min(edgeDist, diagDist);
    let aaLine = length(vec2<f32>(dpdx(lineDist), dpdy(lineDist)));
    let a = (1.0 - smoothstep(0.0, 1.5 * aaLine, lineDist)) * in.dim;
    return vec4<f32>(vec3<f32>(1.0, 0.478, 0.094) * a, a);
  }
  let d = length(in.uv);
  let radius = 0.32;
  let dx = dpdx(d);
  let dy = dpdy(d);
  let aa = max(length(vec2<f32>(dx, dy)), 1e-4);
  let ring = abs(d - (radius - in.halfThick));
  let ringA = 1.0 - smoothstep(in.halfThick - aa, in.halfThick + aa, ring);
  // Career highlights add a center dot (a bullseye) sized to half the ring's
  // inner radius, so an even gap stays visible as the ring thickens.
  let dotR = 0.5 * (radius - 2.0 * in.halfThick);
  let dotA = (1.0 - smoothstep(dotR - aa, dotR + aa, d)) * in.highlight;
  let alpha = max(ringA, dotA) * in.dim;
  return vec4<f32>(UI_ACCENT * alpha, alpha);
}
