// Auroral shell. A sphere above the atmosphere is drawn additively and the
// camera-facing hemisphere ray-marches a thin auroral *volume* concentrated in
// an oval band around each pole. The curtain field uses nimitz's triangle-wave
// domain-warped noise and per-height sinusoidal palette (the Aurora technique
// from https://www.shadertoy.com/view/McSBDm). The march's height dimension is
// mapped to altitude within the shell, so curtains rise green at the base
// through cyan to violet/red at the top, glowing brightest on the night side
// and along the limb (where the slanted ray integrates more of the volume).

struct Frame {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  keyLightDir : vec4<f32>,
  misc : vec4<f32>, // x=time y=reducedMotion z=wireframe w=aspect
};

struct Obj {
  model : mat4x4<f32>,
  p0 : vec4<f32>, // x=planetRadius(world) y=outerRadius(world) z=unused w=kind
  palLow : vec4<f32>,
  palMid : vec4<f32>,
  palHigh : vec4<f32>,
  p1 : vec4<f32>, // x=focus y=intensity z,w=unused
};

@group(0) @binding(0) var<uniform> frame : Frame;
@group(1) @binding(0) var<uniform> obj : Obj;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) worldPos : vec3<f32>,
};

@vertex
fn vs(
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv : vec2<f32>,
) -> VSOut {
  var out : VSOut;
  let world = obj.model * vec4<f32>(position, 1.0);
  out.pos = frame.viewProj * world;
  out.worldPos = world.xyz;
  return out;
}

// Intersect a ray with a sphere. Returns (tNear, tFar); tNear > tFar on a miss.
fn raySphere(ro : vec3<f32>, rd : vec3<f32>, ce : vec3<f32>, ra : f32) -> vec2<f32> {
  let oc = ro - ce;
  let b = dot(oc, rd);
  let c = dot(oc, oc) - ra * ra;
  let h = b * b - c;
  if (h < 0.0) {
    return vec2<f32>(1.0, -1.0);
  }
  let s = sqrt(h);
  return vec2<f32>(-b - s, -b + s);
}

// --- nimitz triangle-wave noise (Aurora, shadertoy McSBDm) -----------------
const M2 = mat2x2<f32>(0.95534, 0.29552, -0.29552, 0.95534);

fn mm2(a : f32) -> mat2x2<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat2x2<f32>(c, s, -s, c);
}

fn tri(x : f32) -> f32 {
  return clamp(abs(fract(x) - 0.5), 0.01, 0.49);
}

fn tri2(p : vec2<f32>) -> vec2<f32> {
  return vec2<f32>(tri(p.x) + tri(p.y), tri(p.y + tri(p.x)));
}

// Domain-warped triangle noise. Five iterations fold the plane through a
// rotating triangle-wave field, accumulating thin filaments. Animated by
// rotating the per-iteration warp by `time * spd`.
fn triNoise2d(p0 : vec2<f32>, spd : f32, time : f32) -> f32 {
  var z = 1.8;
  var z2 = 2.5;
  var rz = 0.0;
  var p = p0 * mm2(p0.x * 0.06);
  var bp = p;
  for (var i = 0; i < 5; i = i + 1) {
    var dg = tri2(bp * 1.85) * 0.75;
    dg = dg * mm2(time * spd);
    p = p - dg / z2;
    bp = bp * 1.3;
    z2 = z2 * 0.45;
    z = z * 0.42;
    p = p * (1.21 + (rz - 1.0) * 0.02);
    rz = rz + tri(p.x + tri(p.y)) * z;
    p = -(p * M2);
  }
  return clamp(1.0 / pow(rz * 29.0, 1.3), 0.0, 0.55);
}

const STEPS : i32 = 24;

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let center = obj.model[3].xyz;
  let planetR = obj.p0.x;
  let outerR = obj.p0.y;
  let innerA = planetR * 1.005; // aurora volume starts just above the atmosphere

  // Planet body-frame basis (columns of the model rotation). Projecting the
  // sample direction onto these gives a local direction, so the aurora is
  // locked to the planet and rotates with it (any orientation, including spin
  // about the pole), instead of sliding when the planet is dragged.
  let bx = normalize(obj.model[0].xyz);
  let by = normalize(obj.model[1].xyz); // pole / local Y
  let bz = normalize(obj.model[2].xyz);

  let ro = frame.cameraPos.xyz;
  let rd = normalize(in.worldPos - ro);
  let sun = normalize(frame.keyLightDir.xyz);

  let outer = raySphere(ro, rd, center, outerR);
  if (outer.y <= outer.x) {
    return vec4<f32>(0.0);
  }
  var tNear = max(outer.x, 0.0);
  var tFar = outer.y;

  // The opaque planet truncates the column we can see through.
  let inner = raySphere(ro, rd, center, planetR);
  if (inner.x > 0.0 && inner.x < inner.y) {
    tFar = min(tFar, inner.x);
  }
  if (tFar <= tNear) {
    return vec4<f32>(0.0);
  }

  // Orthonormal basis spanning the plane perpendicular to the pole axis. The
  // noise is sampled on this plane so curtains are seamless around the pole.

  let motion = select(1.0, 0.0, frame.misc.y > 0.5);
  let at = frame.misc.x * motion;

  // Curtains rise radially from innerA; cap their top at half the shell
  // thickness so they read as shorter curtains.
  let curtainTop = innerA + (outerR - innerA) * 0.25;
  let thickness = max(curtainTop - innerA, 1e-4);
  let dt = (tFar - tNear) / f32(STEPS);
  var col = vec3<f32>(0.0);
  var avg = vec3<f32>(0.0);
  for (var i = 0; i < STEPS; i = i + 1) {
    let t = tNear + (f32(i) + 0.5) * dt;
    let pos = ro + rd * t;
    let rel = pos - center;
    let r = length(rel);
    if (r < innerA) {
      continue; // below the aurora volume (inside the atmosphere)
    }
    if (r > curtainTop) {
      continue; // above the (shortened) curtain top
    }
    let dir = rel / r;
    let ld = vec3<f32>(dot(bx, dir), dot(by, dir), dot(bz, dir)); // local direction

    // Auroral oval: a soft band around each pole.
    let lat = abs(ld.y);
    let band = smoothstep(0.42, 0.60, lat) * (1.0 - smoothstep(0.86, 0.98, lat));

    // Altitude within the shell drives both the curtain colour and a base->top
    // density falloff (curtains are densest near the base).
    let h = clamp((r - innerA) / thickness, 0.0, 1.0);

    // Curtains. A coarse triangle-noise field carves the band into discrete
    // clusters (gaps between curtains) and also warps the fine field so the
    // filaments read as separate writhing strands rather than a regular fan.
    let pc = vec2<f32>(ld.x, ld.z);
    let coarse = triNoise2d(pc * 1.4, 0.025, at);
    let group = smoothstep(0.08, 0.50, coarse);
    let pcw = pc + vec2<f32>(coarse - 0.275, coarse - 0.275) * 0.8;
    let fil = triNoise2d(pcw * 2.6, 0.06, at);
    let strings = pow(clamp(fil * 1.7, 0.0, 1.0), 0.8);
    let rzt = strings * group * band;

    // nimitz per-height palette: green (base) -> cyan -> violet/red (top).
    let hue = sin(1.0 - vec3<f32>(2.15, -0.5, 1.2) + h * 2.5) * 0.5 + 0.5;
    let samp = hue * rzt;
    avg = mix(avg, samp, 0.5);

    // Visible mainly on the night side; daylight washes the curtains out.
    let nightAmt = 1.0 - smoothstep(-0.2, 0.3, dot(dir, sun));
    let nightFloor = mix(0.08, 1.0, nightAmt);

    col = col + avg * exp(-h * 1.6) * nightFloor * (dt / thickness);
  }

  let intensity = obj.p1.y * (0.85 + 0.3 * obj.p1.x);
  col = col * intensity * 3.0;

  // Distance fog (matches the other additive shells: attenuate the glow).
  let dist = distance(in.worldPos, ro);
  let s = dist * 0.018;
  col = col * exp(-s * s);

  return vec4<f32>(col, 1.0);
}
