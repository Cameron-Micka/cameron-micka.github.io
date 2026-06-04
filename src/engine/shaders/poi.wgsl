// Instanced point-of-interest markers. Billboarded glowing discs at each POI's
// world position. Backside POIs arrive pre-dimmed from the CPU. Additive.
struct Frame {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  keyLightDir : vec4<f32>,
  misc : vec4<f32>,
};
@group(0) @binding(0) var<uniform> frame : Frame;

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
  @location(4) digit : f32,          // 1..9 = numeral icon, 0 = none
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

// Roman numerals I..IX rendered as a union of line-segment SDFs in a
// normalized glyph-local box [-1,1]x[-1,1]. Each numeral lists its strokes;
// the fragment shader unions them by min-distance, then masks the marker
// pixel by smoothstep of (distance vs. stroke half-width). Variable-width
// numerals (VIII especially) fit cleanly without bitmap rasterization
// artifacts.
fn segDist(p : vec2<f32>, a : vec2<f32>, b : vec2<f32>) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

fn iStem(p : vec2<f32>, x : f32) -> f32 {
  // A capital-I stroke: the vertical body plus short horizontal serifs at
  // top and bottom so multi-I numerals (II, III, ...) read as Roman
  // numerals instead of pause-button bars.
  let body = segDist(p, vec2<f32>(x, -1.0), vec2<f32>(x, 1.0));
  let top = segDist(p, vec2<f32>(x - 0.2, 1.0), vec2<f32>(x + 0.2, 1.0));
  let bot = segDist(p, vec2<f32>(x - 0.2, -1.0), vec2<f32>(x + 0.2, -1.0));
  return min(body, min(top, bot));
}

fn romanDist(p : vec2<f32>, d : i32) -> f32 {
  var dm : f32 = 1e9;
  if (d == 1) {
    // I
    dm = min(dm, iStem(p, 0.0));
  } else if (d == 2) {
    // II
    dm = min(dm, iStem(p, -0.5));
    dm = min(dm, iStem(p, 0.5));
  } else if (d == 3) {
    // III
    dm = min(dm, iStem(p, -0.8));
    dm = min(dm, iStem(p, 0.0));
    dm = min(dm, iStem(p, 0.8));
  } else if (d == 4) {
    // IV: I on the left, V on the right.
    dm = min(dm, iStem(p, -0.6));
    dm = min(dm, segDist(p, vec2<f32>(-0.05, 1.0), vec2<f32>(0.3, -1.0)));
    dm = min(dm, segDist(p, vec2<f32>(0.65, 1.0), vec2<f32>(0.3, -1.0)));
  } else if (d == 5) {
    // V
    dm = min(dm, segDist(p, vec2<f32>(-0.6, 1.0), vec2<f32>(0.0, -1.0)));
    dm = min(dm, segDist(p, vec2<f32>(0.6, 1.0), vec2<f32>(0.0, -1.0)));
  } else if (d == 6) {
    // VI: V on the left, I on the right.
    dm = min(dm, segDist(p, vec2<f32>(-0.65, 1.0), vec2<f32>(-0.3, -1.0)));
    dm = min(dm, segDist(p, vec2<f32>(0.05, 1.0), vec2<f32>(-0.3, -1.0)));
    dm = min(dm, iStem(p, 0.6));
  } else if (d == 7) {
    // VII
    dm = min(dm, segDist(p, vec2<f32>(-0.75, 1.0), vec2<f32>(-0.45, -1.0)));
    dm = min(dm, segDist(p, vec2<f32>(-0.15, 1.0), vec2<f32>(-0.45, -1.0)));
    dm = min(dm, iStem(p, 0.25));
    dm = min(dm, iStem(p, 0.75));
  } else if (d == 8) {
    // VIII: a narrower V on the left to make room for III on the right.
    dm = min(dm, segDist(p, vec2<f32>(-0.85, 1.0), vec2<f32>(-0.6, -1.0)));
    dm = min(dm, segDist(p, vec2<f32>(-0.35, 1.0), vec2<f32>(-0.6, -1.0)));
    dm = min(dm, iStem(p, 0.0));
    dm = min(dm, iStem(p, 0.4));
    dm = min(dm, iStem(p, 0.8));
  } else if (d == 9) {
    // IX: I on the left, X on the right.
    dm = min(dm, iStem(p, -0.7));
    dm = min(dm, segDist(p, vec2<f32>(-0.2, 1.0), vec2<f32>(0.6, -1.0)));
    dm = min(dm, segDist(p, vec2<f32>(0.6, 1.0), vec2<f32>(-0.2, -1.0)));
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
  let radius = 0.85;
  let dx = dpdx(d);
  let dy = dpdy(d);
  let aa = length(vec2<f32>(dx, dy));
  // Thin ring: pure AA-only smoothstep from peak (at d=radius) out to
  // 1.5*aa. No solid core, so the line stays roughly 1.5px wide regardless
  // of marker size.
  let outline = (1.0 - smoothstep(0.0, 1.5 * aa, abs(d - radius))) * in.dim;
  let digit = i32(in.digit + 0.5);
  // Map marker uv into a normalized glyph-local box [-1,1]x[-1,1]. halfW is
  // wide enough to fit even VIII (the broadest numeral) without crowding
  // the ring at radius 0.85.
  let halfW = 0.28;
  let halfH = 0.30;
  let gp = vec2<f32>(in.uv.x / halfW, in.uv.y / halfH);
  let glyphDist = romanDist(gp, digit);
  // One screen pixel in glyph-local units (isotropic AA, same trick as the
  // ring). Stroke half-width is in the same units as the glyph definitions.
  let dgx = dpdx(gp);
  let dgy = dpdy(gp);
  let aaG = sqrt(dot(dgx, dgx) + dot(dgy, dgy)) * 0.5;
  let strokeW = 0.16;
  let glyphAlpha = (1.0 - smoothstep(strokeW - aaG, strokeW + aaG, glyphDist)) * in.dim;
  let alpha = max(outline, glyphAlpha);
  return vec4<f32>(vec3<f32>(alpha), alpha);
}
