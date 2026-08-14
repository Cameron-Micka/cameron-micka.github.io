// Instanced point-of-interest markers. Billboarded glowing discs at each POI's
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

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) accent : vec3<f32>,
  @location(2) dim : f32,
  @location(3) digit : f32,
  @location(4) count : f32,
};

@vertex
fn vs(
  @location(0) corner : vec2<f32>,   // unit quad -1..1
  @location(1) center : vec3<f32>,   // POI world position
  @location(2) attribs : vec4<f32>,  // x=size y=dim z=accentR w=accentG
  @location(3) accentB : f32,        // accentB
  @location(4) digit : f32,          // 1..9 = Arabic numeral icon, 0 = none
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
  out.digit = digit;
  out.count = count;
  return out;
}

// Arabic numerals 0..9 rendered as a seven-segment union of line-segment SDFs
// in a normalized glyph-local box [-1,1]x[-1,1]. Each digit lights a subset of
// the seven segments; the fragment shader unions them by min-distance, then
// masks the marker pixel by smoothstep of (distance vs. stroke half-width), so
// the digits render crisply without bitmap rasterization artifacts.
fn segDist(p : vec2<f32>, a : vec2<f32>, b : vec2<f32>) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

fn digitDist(p : vec2<f32>, d : i32) -> f32 {
  // Seven-segment layout corners. x/y inset from the glyph box edges.
  let x = 0.55;
  let y = 0.9;
  let tl = vec2<f32>(-x, y);
  let tr = vec2<f32>(x, y);
  let ml = vec2<f32>(-x, 0.0);
  let mr = vec2<f32>(x, 0.0);
  let bl = vec2<f32>(-x, -y);
  let br = vec2<f32>(x, -y);
  // "1" reads better as a single centered stem than as a right-aligned pair.
  if (d == 1) {
    return segDist(p, vec2<f32>(0.0, y), vec2<f32>(0.0, -y));
  }
  var dm : f32 = 1e9;
  // a (top)
  if (d == 0 || d == 2 || d == 3 || d == 5 || d == 6 || d == 7 || d == 8 || d == 9) {
    dm = min(dm, segDist(p, tl, tr));
  }
  // f (upper-left)
  if (d == 0 || d == 4 || d == 5 || d == 6 || d == 8 || d == 9) {
    dm = min(dm, segDist(p, tl, ml));
  }
  // b (upper-right)
  if (d == 0 || d == 2 || d == 3 || d == 4 || d == 7 || d == 8 || d == 9) {
    dm = min(dm, segDist(p, tr, mr));
  }
  // g (middle)
  if (d == 2 || d == 3 || d == 4 || d == 5 || d == 6 || d == 8 || d == 9) {
    dm = min(dm, segDist(p, ml, mr));
  }
  // e (lower-left)
  if (d == 0 || d == 2 || d == 6 || d == 8) {
    dm = min(dm, segDist(p, ml, bl));
  }
  // c (lower-right)
  if (d == 0 || d == 3 || d == 4 || d == 5 || d == 6 || d == 7 || d == 8 || d == 9) {
    dm = min(dm, segDist(p, mr, br));
  }
  // d (bottom)
  if (d == 0 || d == 2 || d == 3 || d == 5 || d == 6 || d == 8 || d == 9) {
    dm = min(dm, segDist(p, bl, br));
  }
  return dm;
}

// One shimmer "slot" per POI: SHIMMER_SLOT seconds each, of which the first
// SHIMMER_SWEEP fraction is the highlight travelling a full turn around the
// ring and the remainder is a short rest before the next marker takes over.
const SHIMMER_SLOT : f32 = 1.6;
const SHIMMER_SWEEP : f32 = 0.75;
const TAU : f32 = 6.2831853;
const HALF_PI : f32 = 1.5707963;

fn shimmer(uv : vec2<f32>, digit : f32, count : f32) -> f32 {
  let total = max(count, 1.0);
  let slots = max(frame.misc.x, 0.0) / SHIMMER_SLOT;
  let whole = floor(slots);
  // Index of the marker whose turn it is, cycling 0..total-1.
  // NOTE: 'active' is a WGSL reserved word, hence activeIdx.
  let activeIdx = whole - total * floor(whole / total);
  if (abs(activeIdx - (digit - 1.0)) > 0.5) {
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
  return exp(-delta * delta * 5.0) * env;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let wf = frame.misc.z;
  if (wf > 0.5) {
    // Wireframe debug: render the underlying billboard quad as cyan edges
    // plus the diagonal that splits its two triangles (the shared edge
    // runs (1,-1) -> (-1,1), i.e. uv.x + uv.y = 0). Matches the planet
    // wireframe style instead of faking a circle.
    let edgeDist = min(1.0 - abs(in.uv.x), 1.0 - abs(in.uv.y));
    let diagDist = abs(in.uv.x + in.uv.y) * 0.70710678;
    let lineDist = min(edgeDist, diagDist);
    let aaLine = length(vec2<f32>(dpdx(lineDist), dpdy(lineDist)));
    let a = (1.0 - smoothstep(0.0, 1.5 * aaLine, lineDist)) * in.dim;
    return vec4<f32>(vec3<f32>(0.25, 1.0, 0.85) * a, a);
  }
  let d = length(in.uv);
  // Thin white circle outline with screen-space derivative anti-aliasing.
  // Use isotropic gradient magnitude (L2 of dFdx/dFdy) rather than fwidth()
  // (which is the L1 norm). Because d = length(uv) has unit gradient, this
  // keeps the AA band the same width in every direction; otherwise the ring
  // reads as slightly fatter at the diagonals than at the cardinals.
  // Shimmer: a narrow highlight that travels once around the circumference of
  // a single marker, brightening the ring and bulging its radius by a hair.
  // Markers take turns in POI order (digit 1, 2, 3, ...); when the last one
  // finishes the sequence restarts at the first, so only one marker ever
  // shimmers at a time and the eye is led through the POIs in order.
  let pulse = shimmer(in.uv, in.digit, in.count);
  let radius = 0.85 + 0.02 * pulse;
  let dx = dpdx(d);
  let dy = dpdy(d);
  let aa = length(vec2<f32>(dx, dy));
  // Thin ring: pure AA-only smoothstep from peak (at d=radius) out to
  // 1.5*aa. No solid core, so the line stays roughly 1.5px wide regardless
  // of marker size.
  let outline = (1.0 - smoothstep(0.0, 1.5 * aa, abs(d - radius))) * in.dim;
  // Bright warm highlight riding on top of the ring, matched to the flight
  // path's travelling pulse (same 1.0/0.95/0.85 tint and 1.6 gain) so both
  // effects read at the same intensity. Slightly wider than the ring line
  // itself so the glow is visible even on small markers. The POI pass is
  // additive into the HDR target, so letting the highlight push RGB past 1.0
  // is deliberate — that overshoot is what the bloom pass picks up.
  let halo = (1.0 - smoothstep(0.0, 4.0 * aa, abs(d - radius))) * in.dim;
  let glow = halo * pulse;
  let digit = i32(in.digit + 0.5);
  // Map marker uv into a normalized glyph-local box [-1,1]x[-1,1]. halfW/halfH
  // size the digit so it sits comfortably inside the ring at radius 0.85.
  let halfW = 0.28;
  let halfH = 0.30;
  let gp = vec2<f32>(in.uv.x / halfW, in.uv.y / halfH);
  let glyphDist = digitDist(gp, digit);
  // One screen pixel in glyph-local units (isotropic AA, same trick as the
  // ring). Stroke half-width is in the same units as the glyph definitions.
  let dgx = dpdx(gp);
  let dgy = dpdy(gp);
  let aaG = sqrt(dot(dgx, dgx) + dot(dgy, dgy)) * 0.5;
  let strokeW = 0.16;
  let glyphAlpha = (1.0 - smoothstep(strokeW - aaG, strokeW + aaG, glyphDist)) * in.dim;
  let alpha = max(outline, glyphAlpha);
  let rgb = UI_ACCENT * alpha + vec3<f32>(1.0, 0.95, 0.85) * glow * 1.6;
  return vec4<f32>(rgb, min(1.0, alpha + glow * 0.8));
}
