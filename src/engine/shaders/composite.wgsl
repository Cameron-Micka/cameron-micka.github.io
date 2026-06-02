// Composite / post pass. Samples the HDR scene, adds a cheap multi-tap bloom,
// applies ACES tonemapping, chromatic aberration, vignette, and an optional
// gaussian blur used to freeze-blur the scene behind the POI modal.
struct Post {
  params : vec4<f32>,   // x=blur(0..1) y=vignette z=caAmount w=bloomStrength
  texel : vec4<f32>,    // xy = 1/resolution
};
@group(0) @binding(0) var<uniform> post : Post;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var sceneTex : texture_2d<f32>;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(3.0, 1.0),
  );
  var out : VSOut;
  let xy = p[vi];
  out.pos = vec4<f32>(xy, 0.0, 1.0);
  out.uv = vec2<f32>(xy.x, -xy.y) * 0.5 + vec2<f32>(0.5);
  return out;
}

fn aces(x : vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn sampleScene(uv : vec2<f32>) -> vec3<f32> {
  return textureSample(sceneTex, samp, clamp(uv, vec2<f32>(0.001), vec2<f32>(0.999))).rgb;
}

// Cheap bloom: threshold bright areas across a small disk of taps.
fn bloom(uv : vec2<f32>) -> vec3<f32> {
  var acc = vec3<f32>(0.0);
  let r = post.texel.xy * 3.0;
  for (var i = 0; i < 12; i = i + 1) {
    let ang = f32(i) * 0.5236;
    let o = vec2<f32>(cos(ang), sin(ang));
    let s = sampleScene(uv + o * r * 2.0);
    let bright = max(s - vec3<f32>(0.7), vec3<f32>(0.0));
    acc = acc + bright;
  }
  return acc / 12.0;
}

// Wide gaussian-ish blur for the frozen modal backdrop. Uses a 13x13 kernel
// at ~2.5-texel spacing so adjacent taps' bilinear footprints overlap. Wider
// or sparser kernels leave discrete bright "ghost dots" of every specular
// highlight in the source, since each tap samples the HDR scene directly.
// Sample offsets are nudged by 0.5 of a step so each tap lands between two
// texels and benefits from bilinear filtering.
fn blurScene(uv : vec2<f32>, amount : f32) -> vec3<f32> {
  var acc = vec3<f32>(0.0);
  var wsum = 0.0;
  let r = post.texel.xy * 2.5 * amount;
  for (var i = -6; i <= 6; i = i + 1) {
    for (var j = -6; j <= 6; j = j + 1) {
      let o = vec2<f32>(f32(i) + 0.5, f32(j) + 0.5);
      // sigma ~3.2 taps so the bell rolls off well inside the loop bounds.
      let w = exp(-dot(o, o) * 0.05);
      acc = acc + sampleScene(uv + o * r) * w;
      wsum = wsum + w;
    }
  }
  return acc / wsum;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let blurAmt = post.params.x;
  let caAmt = post.params.z;

  var scene : vec3<f32>;
  if (blurAmt > 0.001) {
    scene = blurScene(uv, blurAmt);
  } else {
    // Chromatic aberration: offset channels radially from center.
    let dir = uv - vec2<f32>(0.5);
    let ca = dir * caAmt;
    let rC = sampleScene(uv + ca).r;
    let gC = sampleScene(uv).g;
    let bC = sampleScene(uv - ca).b;
    scene = vec3<f32>(rC, gC, bC);
  }

  let col = scene + bloom(uv) * post.params.w;
  var mapped = aces(col);

  // Vignette.
  let d = distance(uv, vec2<f32>(0.5));
  let vig = 1.0 - post.params.y * smoothstep(0.35, 0.85, d);
  mapped = mapped * vig;

  // Dim the frozen backdrop a touch so the modal pops.
  mapped = mapped * (1.0 - 0.25 * blurAmt);

  return vec4<f32>(pow(mapped, vec3<f32>(1.0 / 2.2)), 1.0);
}
