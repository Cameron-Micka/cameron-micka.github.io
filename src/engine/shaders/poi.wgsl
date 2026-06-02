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

// 3x5 bitmap glyphs for the digits 1..9 packed row-major into 15 bits per
// digit (bit `row*3 + col`, top-left = bit 0). 0 returns an empty glyph so
// POIs with no assigned numeral render as a plain outline.
fn digitBits(d : i32) -> u32 {
  switch (d) {
    case 1: { return 0x749Au; }
    case 2: { return 0x73E7u; }
    case 3: { return 0x79E7u; }
    case 4: { return 0x49EDu; }
    case 5: { return 0x79CFu; }
    case 6: { return 0x7BCFu; }
    case 7: { return 0x24A7u; }
    case 8: { return 0x7BEFu; }
    case 9: { return 0x79EFu; }
    default: { return 0u; }
  }
}

fn digitMask(uv : vec2<f32>, d : i32) -> f32 {
  // Glyph occupies roughly the central 60% wide x 90% tall of the marker,
  // leaving clearance from the outline ring at radius 0.85.
  let halfW = 0.28;
  let halfH = 0.42;
  // uv.y is screen-up (NDC convention); row 0 is at the top, so we invert y.
  let cx = (uv.x + halfW) / (halfW * 2.0) * 3.0;
  let cy = (halfH - uv.y) / (halfH * 2.0) * 5.0;
  if (cx < 0.0 || cx >= 3.0 || cy < 0.0 || cy >= 5.0) { return 0.0; }
  let col = i32(floor(cx));
  let row = i32(floor(cy));
  let bits = digitBits(d);
  let mask = 1u << u32(row * 3 + col);
  return select(0.0, 1.0, (bits & mask) != 0u);
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let d = length(in.uv);
  // Thin white circle outline with screen-space derivative anti-aliasing.
  let radius = 0.85;
  let aa = fwidth(d);
  let halfWidth = aa;
  let outline = (1.0 - smoothstep(halfWidth, halfWidth + aa, abs(d - radius))) * in.dim;
  // Numeric glyph at marker center. Combined with the outline by max so the
  // digit stays crisp without doubling brightness where they touch.
  let digit = i32(in.digit + 0.5);
  let glyph = digitMask(in.uv, digit) * in.dim;
  let alpha = max(outline, glyph);
  return vec4<f32>(vec3<f32>(alpha), alpha);
}
