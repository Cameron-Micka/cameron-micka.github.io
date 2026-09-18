// The scene's star. An analytic emissive sphere with granulation and dark
// sunspots (body vs/fs) over a camera-facing additive corona (corona vs/fs).
// Deliberately separate from the planet shader: no lighting, no fog — the sun
// is a light source, so it reads as self-illuminated regardless of distance.

struct Frame {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  keyLightDir : vec4<f32>,
  misc : vec4<f32>, // x=time, y=unused, z=wireframe, w=aspect
};

struct Obj {
  model : mat4x4<f32>,
  p0 : vec4<f32>, // x=radius, y=seed, z=time, w=kind
  palLow : vec4<f32>,
  palMid : vec4<f32>,
  palHigh : vec4<f32>,
  p1 : vec4<f32>, // xy=render-target size in pixels
  p2 : vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame : Frame;
@group(1) @binding(0) var<uniform> obj : Obj;

fn hash3(p : vec3<f32>) -> f32 {
  let q = fract(p * 0.3183099 + vec3<f32>(0.1, 0.2, 0.3));
  let r = q * 17.0;
  return fract(r.x * r.y * r.z * (r.x + r.y + r.z));
}

fn vnoise(x : vec3<f32>) -> f32 {
  let i = floor(x);
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash3(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash3(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash3(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash3(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash3(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash3(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash3(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash3(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  let nxy0 = mix(nx00, nx10, u.y);
  let nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
}

fn fbm(p : vec3<f32>) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 5; i = i + 1) {
    v = v + a * vnoise(q);
    q = q * 2.04;
    a = a * 0.5;
  }
  return v;
}

// 2D fBM via a slowly-drifting slice of the 3D field (z = time), used by the
// corona domain warp below.
fn fbm2(p : vec2<f32>, t : f32) -> f32 {
  return fbm(vec3<f32>(p, t));
}

// ---- Body ---------------------------------------------------------------

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) offset : vec3<f32>,
};

@vertex
fn vs(@location(0) corner : vec2<f32>) -> VSOut {
  var out : VSOut;
  let center = obj.model[3].xyz;
  let delta = center - frame.cameraPos.xyz;
  let distance = max(length(delta), 1e-5);
  let viewDir = delta / distance;
  var up0 = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(viewDir.y) > 0.98) { up0 = vec3<f32>(0.0, 0.0, 1.0); }
  let right = normalize(cross(up0, viewDir));
  let up = cross(viewDir, right);
  // The tangent cone meets the center plane outside the sphere's world radius.
  // Perspective interpolation also preserves the correct rays off axis.
  let ratio = obj.p0.x / distance;
  let discRadius = obj.p0.x / sqrt(max(1.0 - ratio * ratio, 1e-4));
  let rowX = vec3<f32>(frame.viewProj[0].x, frame.viewProj[1].x, frame.viewProj[2].x);
  let rowY = vec3<f32>(frame.viewProj[0].y, frame.viewProj[1].y, frame.viewProj[2].y);
  let focalPixels = min(length(rowX) * obj.p1.x, length(rowY) * obj.p1.y);
  // At least two pixels of padding, even for a tiny disc or a low-res target.
  let padding = 4.0 * (distance + discRadius) / max(focalPixels, 1.0);
  out.offset = (right * corner.x + up * corner.y) * (discRadius + padding);
  out.pos = frame.viewProj * vec4<f32>(center + out.offset, 1.0);
  return out;
}

// Smooth unit tangent flow direction (mirror of planet.wgsl flowDir): a
// low-frequency 3-channel noise vector projected onto the surface tangent
// plane gives a coherent swirling field the plasma detail is advected along.
fn flowDir(local : vec3<f32>, n : vec3<f32>, seed : f32) -> vec3<f32> {
  let fp = local * 1.5 + vec3<f32>(seed * 0.002, seed * 0.0017, seed * 0.0023);
  var v = vec3<f32>(
    vnoise(fp) - 0.5,
    vnoise(fp + vec3<f32>(13.1, 7.7, 2.3)) - 0.5,
    vnoise(fp + vec3<f32>(5.5, 19.2, 8.8)) - 0.5,
  );
  v = v - n * dot(v, n);
  let l = length(v);
  if (l < 1e-4) { return vec3<f32>(0.0); }
  return v / l;
}

// Surface plasma color at a (possibly flow-advected) sample position. Limb
// darkening is view-dependent and applied by the caller, not here.
fn sunShade(p : vec3<f32>) -> vec3<f32> {
  let gran = fbm(p * 7.0);
  let mottle = fbm(p * 2.3);
  let spotField = fbm(p * 1.7 + vec3<f32>(11.0, 0.0, -4.0));
  let penumbra = 1.0 - smoothstep(0.26, 0.36, spotField);
  let umbra = 1.0 - smoothstep(0.16, 0.26, spotField);
  let hot = vec3<f32>(1.0, 0.83, 0.55);
  let warm = vec3<f32>(1.0, 0.66, 0.30);
  var col = mix(warm, hot, gran * 0.6 + mottle * 0.4);
  col = mix(col, vec3<f32>(0.6, 0.28, 0.12), penumbra * 0.75);
  col = mix(col, vec3<f32>(0.32, 0.13, 0.05), umbra * 0.88);
  return col;
}

struct BodyOut {
  @location(0) color : vec4<f32>,
  @builtin(frag_depth) depth : f32,
};

@fragment
fn fs(in : VSOut) -> BodyOut {
  let center = obj.model[3].xyz;
  let radius = max(obj.p0.x, 1e-5);
  let oc = (frame.cameraPos.xyz - center) / radius;
  let ray = normalize(in.offset / radius - oc);
  // Squared impact distance avoids sqrt derivatives at the disc center and
  // cancellation in b*b-c for distant spheres. Evaluate before any discard.
  let impact = cross(oc, ray);
  let h = 1.0 - dot(impact, impact);
  let edgeWidth = max(fwidth(h), 1e-5);
  let coverage = smoothstep(-0.5 * edgeWidth, 0.5 * edgeWidth, h);
  if (coverage <= 0.0) { discard; }
  // Clamp only the reconstruction, not coverage; the outside half-pixel uses
  // the tangent normal/depth and cannot take sqrt of a negative discriminant.
  let worldNormal = normalize(cross(ray, impact) - ray * sqrt(max(h, 0.0)));
  let worldPos = center + worldNormal * radius;
  let clip = frame.viewProj * vec4<f32>(worldPos, 1.0);
  let depth = clip.z / clip.w;
  if (clip.w <= 0.0 || depth < 0.0 || depth > 1.0) { discard; }
  let seed = obj.p0.y;
  let n = vec3<f32>(
    dot(worldNormal, normalize(obj.model[0].xyz)),
    dot(worldNormal, normalize(obj.model[1].xyz)),
    dot(worldNormal, normalize(obj.model[2].xyz)),
  );
  let nb = n + vec3<f32>(seed * 0.013, 0.0, seed * 0.021);

  // Flow-field advection (same technique as the planet flowMap): the convective
  // plasma detail streams along a coherent tangent flow field. Two samples
  // offset by half a cycle are cross-faded with a triangle weight so the field
  // flows continuously without stretching unboundedly past a half cycle.
  let speed = 0.12;
  let mag = 0.22;
  let flow = flowDir(n, n, seed);
  let t = frame.misc.x * speed;
  let ph0 = fract(t);
  let ph1 = fract(t + 0.5);
  let c0 = sunShade(nb - flow * ph0 * mag);
  let c1 = sunShade(nb - flow * ph1 * mag);
  let w = abs(0.5 - ph0) * 2.0;
  var col = mix(c0, c1, w);

  // Limb darkening: the disc edge is dimmer than the center.
  let ndv = max(dot(worldNormal, -ray), 0.0);
  let limb = 0.55 + 0.45 * pow(ndv, 0.55);
  col = col * limb;

  var out : BodyOut;
  out.color = vec4<f32>(col * 2.2, coverage);
  out.depth = depth;
  return out;
}

// ---- Corona -------------------------------------------------------------

struct CoronaOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_corona(@location(0) corner : vec2<f32>) -> CoronaOut {
  var out : CoronaOut;
  let center = obj.model[3].xyz;
  // World-space camera-facing billboard. The sun's radius (obj.p0.x) is scaled
  // on the CPU by camera distance (see Engine.ts) so the whole sun — body and
  // corona alike — holds a constant on-screen size as the camera dollies.
  let coronaR = obj.p0.x * 1.5;
  var viewDir = normalize(center - frame.cameraPos.xyz);
  // Camera-facing basis; fall back to a Z-up reference when looking near-vertical
  // so the cross product never degenerates.
  var up0 = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(viewDir.y) > 0.98) {
    up0 = vec3<f32>(0.0, 0.0, 1.0);
  }
  let right = normalize(cross(up0, viewDir));
  let up = cross(viewDir, right);
  let wpos = center + (right * corner.x + up * corner.y) * coronaR;
  out.pos = frame.viewProj * vec4<f32>(wpos, 1.0);
  out.uv = corner;
  return out;
}

@fragment
fn fs_corona(in : CoronaOut) -> @location(0) vec4<f32> {
  if (frame.misc.z > 0.5) {
    discard;
  }
  let r = length(in.uv);
  if (r > 1.0) {
    discard;
  }
  let t = frame.misc.x;
  let ang = atan2(in.uv.y, in.uv.x + 1e-8);

  // Polar-anchored sample coordinate so the warp field rotates with the disc
  // and reads as energy streaming radially outward. Higher frequency = tighter
  // wisps.
  let sp = vec2<f32>(cos(ang), sin(ang)) * (r * 5.5);

  // Domain warping (iquilezles.org/articles/warp): fbm(p + 4r), r = fbm(p + 4q),
  // q = fbm(p). The intermediate vectors q and r are kept so the flare arms can
  // be advected through the turbulent field, giving them their liquid, wispy
  // curl instead of sitting as rigid spokes. Drifts slowly over time.
  let drift = t * 0.06;
  let q = vec2<f32>(
    fbm2(sp + vec2<f32>(0.0, 0.0), drift),
    fbm2(sp + vec2<f32>(5.2, 1.3), drift),
  );
  let rr = vec2<f32>(
    fbm2(sp + 4.0 * q + vec2<f32>(1.7, 9.2), drift),
    fbm2(sp + 4.0 * q + vec2<f32>(8.3, 2.8), drift),
  );
  let warp = fbm2(sp + 4.0 * rr, drift);

  // Distinct flare arms: a sharpened angular comb whose angle is bent by the
  // warp field so each arm curls and flows like liquid plasma. The low-frequency
  // term breaks the periodicity so arms vary in width and length.
  let armCount = 7.0;
  let wang = ang + (warp - 0.5) * 2.4 + (rr.x - 0.5) * 1.3;
  var arm = 0.5 + 0.5 * sin(armCount * wang);
  arm = pow(arm, 3.5);
  let armVary = 0.4 + 0.85 * fbm2(vec2<f32>(cos(ang), sin(ang)) * 1.6, drift * 0.7);

  // Brightness streamers along the arms.
  let streak = 0.35 + 0.85 * warp;
  let pulse = 0.85 + 0.15 * sin(t * 0.6);
  // Ragged outer edge: a per-direction noise pushes the fade radius in and out so
  // the corona dissolves into wisps of varying length instead of ending at a clean
  // circle. The warp term feeds in so the boundary churns and breaks up over time.
  let edgeN = fbm2(vec2<f32>(cos(ang), sin(ang)) * 3.5 + warp * 2.0, drift * 0.4);
  let edge = 0.58 + 0.37 * edgeN;
  let radial = 1.0 - smoothstep(edge - 0.5, edge, r);

  let glow = radial * (0.16 + 1.4 * arm * armVary) * streak * pulse * 1.3;
  // Hotter, whiter at the base of the arms; cooler, redder toward the tips.
  let col = mix(vec3<f32>(1.0, 0.92, 0.6), vec3<f32>(1.0, 0.42, 0.14), r) * glow;
  return vec4<f32>(col, glow);
}
