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
};

@vertex
fn vs(
  @location(0) corner : vec2<f32>,   // unit quad -1..1
  @location(1) center : vec3<f32>,   // POI world position
  @location(2) attribs : vec4<f32>,  // x=size y=dim z=accentR w=accentG
  @location(3) accentB : f32,        // accentB
  @location(4) digit : f32,          // 1..9 = Arabic numeral icon, 0 = none
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
  // Subtle pulse travelling around the circumference: a narrow highlight that
  // sweeps the ring, brightening it slightly and bulging the radius by a hair.
  // Just enough motion to read as "tappable" without being distracting. The
  // digit offsets the phase so neighbouring markers don't pulse in lockstep.
  let ang = atan2(in.uv.y, in.uv.x);
  var delta = ang - (frame.misc.x * 1.1 + in.digit * 0.7);
  delta = delta - 6.2831853 * floor(delta / 6.2831853 + 0.5);
  let pulse = exp(-delta * delta * 8.0);
  let radius = 0.85 + 0.02 * pulse;
  let dx = dpdx(d);
  let dy = dpdy(d);
  let aa = length(vec2<f32>(dx, dy));
  // Thin ring: pure AA-only smoothstep from peak (at d=radius) out to
  // 1.5*aa. No solid core, so the line stays roughly 1.5px wide regardless
  // of marker size.
  let outline = (1.0 - smoothstep(0.0, 1.5 * aa, abs(d - radius))) * in.dim * (1.0 + 0.9 * pulse);
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
  return vec4<f32>(UI_ACCENT * alpha, alpha);
}
