// Procedural planet surface (also used for moons).
// Shared frame + per-object uniforms; value-noise fBm drives terrain color
// through three authored palette anchors. Atmosphere is a fresnel rim term.

struct Frame {
  viewProj : mat4x4<f32>,
  cameraPos : vec4<f32>,
  keyLightDir : vec4<f32>,
  misc : vec4<f32>, // x=time, y=reducedMotion, z=qualityScale, w=unused
};

struct Obj {
  model : mat4x4<f32>,
  p0 : vec4<f32>, // x=radius, y=seedf, z=time, w=kind
  palLow : vec4<f32>,
  palMid : vec4<f32>,
  palHigh : vec4<f32>,
  p1 : vec4<f32>, // x=focus, y=hasAtmosphere, z=rotationY, w=oceans flag
};

@group(0) @binding(0) var<uniform> frame : Frame;
@group(1) @binding(0) var<uniform> obj : Obj;

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
  for (var i = 0; i < 4; i = i + 1) {
    v = v + a * vnoise(q);
    q = q * 2.03;
    a = a * 0.5;
  }
  return v;
}

// Low-frequency fBm used for continent-scale land/sea distribution. Only 3
// octaves so the result is smooth at sub-continent scale, giving large
// coherent landmasses and open ocean basins rather than fragmented noise.
fn continentFbm(p : vec3<f32>) -> f32 {
  var v = 0.0;
  var a = 0.6;
  var q = p;
  for (var i = 0; i < 3; i = i + 1) {
    v = v + a * vnoise(q);
    q = q * 2.0;
    a = a * 0.5;
  }
  return v;
}

// Ridged fBm for mountain chains. `1 - |n - 0.5| * 2` per octave gives sharp
// linear ridges where the base noise crosses 0.5, like real orogenic belts.
// Only 2 octaves so the result reads as continuous scars rather than a
// noisy speckle field — the high-frequency octaves break up the linearity.
fn ridgedFbm(p : vec3<f32>) -> f32 {
  var v = 0.0;
  var a = 0.65;
  var q = p;
  for (var i = 0; i < 2; i = i + 1) {
    let n = vnoise(q);
    v = v + a * (1.0 - abs(n - 0.5) * 2.0);
    q = q * 2.1;
    a = a * 0.5;
  }
  return v;
}

// --- Cook-Torrance PBR helpers ---
// Standard real-time GGX BRDF (Walter et al. 2007 / Karis 2013). Lets land
// and water share one lighting path while their roughness/F0 alone shape the
// difference: smooth water -> tight Fresnel-driven glint, rough land -> matte.
const PI : f32 = 3.14159265359;

fn dGGX(NdH : f32, roughness : f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let f = (NdH * NdH) * (a2 - 1.0) + 1.0;
  return a2 / (PI * f * f);
}

fn gSchlickGGX(NdX : f32, roughness : f32) -> f32 {
  // k for direct (analytic) lighting = (r+1)^2 / 8
  let r = roughness + 1.0;
  let k = (r * r) * 0.125;
  return NdX / (NdX * (1.0 - k) + k);
}

fn gSmith(NdV : f32, NdL : f32, roughness : f32) -> f32 {
  return gSchlickGGX(NdV, roughness) * gSchlickGGX(NdL, roughness);
}

fn fSchlick(cosTheta : f32, F0 : vec3<f32>) -> vec3<f32> {
  let f = pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
  return F0 + (vec3<f32>(1.0) - F0) * f;
}

// Distance fog: exp-squared falloff (~"GL_EXP2") so near-camera fragments
// are essentially untouched and far fragments smoothly drown into the haze
// colour. Density tuned for PLANET_SPACING=9 / VIEW_DISTANCE=8.5 so the
// focused planet stays crisp and planets two or three slots away noticeably
// fade. Shared by planet/ring/atmosphere shaders.
const FOG_DENSITY : f32 = 0.030;
const FOG_COLOR : vec3<f32> = vec3<f32>(0.04, 0.06, 0.14);

fn fogFactor(worldPos : vec3<f32>, cameraPos : vec3<f32>) -> f32 {
  let d = distance(worldPos, cameraPos);
  let s = d * FOG_DENSITY;
  return 1.0 - exp(-s * s);
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let seed = obj.p0.y;
  let n = normalize(in.nrm);
  let viewDir = normalize(frame.cameraPos.xyz - in.worldPos);
  let lightDir = normalize(frame.keyLightDir.xyz);
  let rim = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.0);

  // Two-level fBm domain warping (after Inigo Quilez,
  // https://iquilezles.org/articles/warp/) — extended to 3D so we can sample
  // it directly on the sphere surface and avoid UV seams. The 2.5× warp
  // magnitude bends the noise field strongly through itself, producing the
  // curling, marbled structure that reads as organic geology rather than
  // uniform fbm hiss.
  let basePos = in.localPos * (2.2 + seed * 0.0001) + vec3<f32>(seed * 0.001);
  let q = vec3<f32>(
    fbm(basePos),
    fbm(basePos + vec3<f32>(5.2, 1.3, 2.8)),
    fbm(basePos + vec3<f32>(7.1, 4.4, 6.9)),
  );
  let warpQ = basePos + 2.5 * q;
  let r = vec3<f32>(
    fbm(warpQ + vec3<f32>(1.7, 9.2, 3.5)),
    fbm(warpQ + vec3<f32>(8.3, 2.8, 4.1)),
    fbm(warpQ + vec3<f32>(4.7, 7.7, 1.9)),
  );
  let height = clamp(fbm(basePos + 2.5 * r), 0.0, 1.0);
  var land = mix(obj.palLow.rgb, obj.palMid.rgb, smoothstep(0.25, 0.55, height));
  land = mix(land, obj.palHigh.rgb, smoothstep(0.6, 0.85, height));
  // IQ-style color modulation from the warp magnitudes — q drives darker
  // "trench" pockets, r drives brighter "highland" streaks. Both are kept
  // subtle so the authored low/mid/high palette still defines the planet.
  let qLen = clamp(length(q) * 0.55, 0.0, 1.0);
  let rLen = clamp(length(r) * 0.55, 0.0, 1.0);
  land = mix(land, obj.palLow.rgb * 0.55, qLen * 0.22);
  land = mix(land, obj.palHigh.rgb * 1.15, rLen * 0.20);

  // Biome variation: a slow 3-channel noise reads as climate-zone tint
  // (warmer here, cooler there) so adjacent landmasses don't all look the
  // same. Sampled at very low frequency for region-scale color shifts.
  let biomeR = vnoise(in.localPos * 0.55 + vec3<f32>(11.3, 3.7, 5.1));
  let biomeG = vnoise(in.localPos * 0.55 + vec3<f32>(24.7, 6.2, 9.4));
  let biomeB = vnoise(in.localPos * 0.55 + vec3<f32>(37.1, 8.9, 2.6));
  let biomeTint = vec3<f32>(biomeR, biomeG, biomeB);
  // Tint toward a biome-mixed palette extreme so it stays palette-respecting.
  let biomeColor = mix(obj.palLow.rgb, obj.palHigh.rgb, biomeTint);
  land = mix(land, biomeColor, 0.18);

  // Mountain ranges: 2-octave ridged noise gives long continuous "scars"
  // (Andes/Himalaya-like) rather than splotchy peaks. Sampled at low
  // frequency on the warped domain so chains follow continental flow and a
  // tight ridge-spine threshold paints only the actual range, not foothills.
  let ridge = ridgedFbm(warpQ * 0.5);
  let mountainMask = smoothstep(0.62, 0.74, ridge) * smoothstep(0.42, 0.62, height);
  let mountainRock = mix(obj.palMid.rgb * 0.55, vec3<f32>(0.48, 0.28, 0.16), 0.75);
  land = mix(land, mountainRock, mountainMask * 0.85);
  let snowMask = smoothstep(0.78, 0.95, height) * smoothstep(0.58, 0.74, ridge);
  land = mix(land, vec3<f32>(0.94, 0.95, 0.97), snowMask * 0.9);

  // Oceans: a separate low-frequency "continent" field drives the land/sea
  // split so landmasses clump like Earth's continents instead of fragmenting
  // with the fine surface noise. A small amount of the fine `height` is mixed
  // in so coastlines stay naturally jagged rather than perfectly smooth.
  let oceans = obj.p1.w;
  let continentPos = in.localPos * 1.1 + vec3<f32>(seed * 0.0011);
  let continentH = continentFbm(continentPos);
  let oceanField = continentH * 0.85 + height * 0.15;
  let waterLevel = 0.55;
  let waterMask = oceans * (1.0 - smoothstep(waterLevel - 0.03, waterLevel + 0.03, oceanField));
  let deepOcean = vec3<f32>(0.005, 0.018, 0.07);
  let shallowOcean = vec3<f32>(0.42, 0.82, 0.80);
  // Concentrate the lightening in a narrow band just inside the shoreline so
  // most of the ocean stays dark and coasts get a visible turquoise rim.
  let depth = smoothstep(waterLevel - 0.10, waterLevel, oceanField);
  let water = mix(deepOcean, shallowOcean, depth);
  let base = mix(land, water, waterMask);

  // --- Cook-Torrance PBR direct lighting from the key sun ---
  // Per-pixel material: water is a smooth dielectric (low roughness, low F0
  // ~ water IOR 1.33 -> F0 0.02); land is a rough dielectric (high roughness,
  // F0 0.04). Both share a single lighting path so the glint shape and the
  // matte response come purely from the material parameters.
  let albedo = base;
  let metallic = 0.0;
  let roughness = mix(0.92, 0.12, waterMask);
  let F0base = mix(vec3<f32>(0.04), vec3<f32>(0.02), waterMask);
  let F0 = mix(F0base, albedo, metallic);

  let L = lightDir;
  let V = viewDir;
  let H = normalize(L + V);
  let NdL = clamp(dot(n, L), 0.0, 1.0);
  let NdV = max(dot(n, V), 1e-4);
  let NdH = clamp(dot(n, H), 0.0, 1.0);
  let VdH = clamp(dot(V, H), 0.0, 1.0);

  let D = dGGX(NdH, roughness);
  let G = gSmith(NdV, NdL, roughness);
  let F = fSchlick(VdH, F0);

  let specular = (D * G) * F / max(4.0 * NdV * NdL, 1e-3);
  let kS = F;
  let kD = (vec3<f32>(1.0) - kS) * (1.0 - metallic);

  // Sun radiance pre-multiplied by PI so that diffuse simplifies to
  // kD * albedo * NdL (matches the look of the previous Lambert-ish shader
  // at NdL=1) while the specular term retains its physical units.
  let sunRadiance = vec3<f32>(PI);
  let direct = (kD * albedo / PI + specular) * sunRadiance * NdL;

  // Very faint ambient so the unlit hemisphere reads as deep shadow without
  // being pitch black — surface noise stays just barely legible.
  let ambient = albedo * 0.01;
  var color = ambient + direct;

  let atmoStrength = obj.p1.y;
  // Multiplied by NdL (not (a + b*NdL)) so the rim fresnel fully zeroes on
  // the unlit side instead of leaving a faint constant glow there.
  let atmo = obj.palHigh.rgb * rim * NdL * 0.55 * atmoStrength;
  color = color + atmo;

  color = color * (0.85 + 0.3 * obj.p1.x);
  let f = fogFactor(in.worldPos, frame.cameraPos.xyz);
  color = mix(color, FOG_COLOR, f);
  return vec4<f32>(color, 1.0);
}
