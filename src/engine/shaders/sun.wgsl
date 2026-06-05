// The scene's star. A bright, emissive sphere with granulation and dark
// sunspots (body vs/fs) plus a camera-facing additive corona (corona vs/fs).
// Deliberately separate from the planet shader: no lighting, no fog — the sun
// is a light source, so it reads as self-illuminated regardless of distance.

struct Frame {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  keyLightDir : vec4<f32>,
  misc : vec4<f32>, // x=time, y=reducedMotion, z=wireframe, w=aspect
};

struct Obj {
  model : mat4x4<f32>,
  p0 : vec4<f32>, // x=radius, y=seed, z=time, w=kind
  palLow : vec4<f32>,
  palMid : vec4<f32>,
  palHigh : vec4<f32>,
  p1 : vec4<f32>,
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
  @location(0) nrm : vec3<f32>,
  @location(1) localPos : vec3<f32>,
  @location(2) worldPos : vec3<f32>,
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
  out.nrm = normalize((obj.model * vec4<f32>(normal, 0.0)).xyz);
  out.localPos = position;
  out.worldPos = world.xyz;
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
  let hot = vec3<f32>(1.0, 0.98, 0.92);
  let warm = vec3<f32>(1.0, 0.85, 0.55);
  var col = mix(warm, hot, gran * 0.6 + mottle * 0.4);
  col = mix(col, vec3<f32>(0.6, 0.28, 0.12), penumbra * 0.75);
  col = mix(col, vec3<f32>(0.32, 0.13, 0.05), umbra * 0.88);
  return col;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let seed = obj.p0.y;
  let n = normalize(in.localPos);
  let nb = n + vec3<f32>(seed * 0.013, 0.0, seed * 0.021);

  // Flow-field advection (same technique as the planet flowMap): the convective
  // plasma detail streams along a coherent tangent flow field. Two samples
  // offset by half a cycle are cross-faded with a triangle weight so the field
  // flows continuously without stretching unboundedly past a half cycle.
  // Frozen under reduced motion.
  let rm = frame.misc.y;
  let speed = select(0.12, 0.0, rm > 0.5);
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
  let V = normalize(frame.cameraPos.xyz - in.worldPos);
  let ndv = max(dot(normalize(in.nrm), V), 0.0);
  let limb = 0.55 + 0.45 * pow(ndv, 0.55);
  col = col * limb;

  // Push above 1.0 for HDR bloom (WebGPU); clamps to white on WebGL2.
  return vec4<f32>(col * 2.2, 1.0);
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
  let t = frame.misc.x * select(1.0, 0.0, frame.misc.y > 0.5);
  let ang = atan2(in.uv.y, in.uv.x);

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
  let radial = smoothstep(edge, edge - 0.5, r);

  let glow = radial * (0.16 + 1.4 * arm * armVary) * streak * pulse * 1.3;
  // Hotter, whiter at the base of the arms; cooler, redder toward the tips.
  let col = mix(vec3<f32>(1.0, 0.92, 0.6), vec3<f32>(1.0, 0.42, 0.14), r) * glow;
  return vec4<f32>(col, glow);
}
