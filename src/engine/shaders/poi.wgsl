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
  @location(4) count : f32,
  @location(5) halfThick : f32,
};

@vertex
fn vs(
  @location(0) corner : vec2<f32>,   // unit quad -1..1
  @location(1) center : vec3<f32>,   // POI world position
  @location(2) attribs : vec4<f32>,  // x=size y=dim z=accentR w=accentG
  @location(3) accentB : f32,        // accentB
  @location(4) ordinal : f32,        // one-based POI order for the shimmer
  @location(5) count : f32,          // number of POIs on this marker's planet
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
  out.count = count;
  out.halfThick = HALF_THICK / attribs.x;
  return out;
}

// One shimmer "slot" per POI: SHIMMER_SLOT seconds each, of which the first
// SHIMMER_SWEEP fraction is the highlight travelling a full turn around the
// pin head and the remainder is a short rest before the next marker takes over.
const SHIMMER_SLOT : f32 = 1.6;
const SHIMMER_SWEEP : f32 = 0.75;
// Overall strength of the highlight. Kept well under 1 so the sweep reads as a
// gentle hint rather than a flash that pulls focus off the planet.
const SHIMMER_GAIN : f32 = 0.5;
const TAU : f32 = 6.2831853;
const HALF_PI : f32 = 1.5707963;

fn shimmer(uv : vec2<f32>, ordinal : f32, count : f32) -> f32 {
  // frame.misc.y == 0 once the visitor has opened a POI this session.
  if (frame.misc.y < 0.5) {
    return 0.0;
  }
  let total = max(count, 1.0);
  let slots = max(frame.misc.x, 0.0) / SHIMMER_SLOT;
  let whole = floor(slots);
  // Index of the marker whose turn it is, cycling 0..total-1.
  // NOTE: 'active' is a WGSL reserved word, hence activeIdx.
  let activeIdx = whole - total * floor(whole / total);
  if (abs(activeIdx - (ordinal - 1.0)) > 0.5) {
    return 0.0;
  }
  let travel = fract(slots) / SHIMMER_SWEEP;
  if (travel > 1.0) {
    return 0.0;
  }
  // Fade the highlight in and out at the ends of its lap so it does not pop
  // into (or out of) existence at the start angle.
  let env = smoothstep(0.0, 0.12, travel) * (1.0 - smoothstep(0.88, 1.0, travel));
  let ang = atan2(uv.y, uv.x);
  var delta = ang - (HALF_PI + travel * TAU);
  delta = delta - TAU * floor(delta / TAU + 0.5);
  return exp(-delta * delta * 5.0) * env * SHIMMER_GAIN;
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
  let pulse = shimmer(in.uv, in.ordinal, in.count);
  let radius = 0.32 + 0.02 * pulse;
  let dx = dpdx(d);
  let dy = dpdy(d);
  let aa = max(length(vec2<f32>(dx, dy)), 1e-4);
  let ring = abs(d - (radius - in.halfThick));
  let alpha = (1.0 - smoothstep(in.halfThick - aa, in.halfThick + aa, ring)) * in.dim;
  let halo = (1.0 - smoothstep(0.0, 4.0 * aa, abs(d - radius))) * in.dim;
  let glow = halo * pulse;
  let rgb = UI_ACCENT * alpha
    + vec3<f32>(1.0, 0.95, 0.85) * glow * 1.6;
  return vec4<f32>(rgb, min(1.0, alpha + glow * 0.8));
}
