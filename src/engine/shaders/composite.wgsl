// Final composite to the swapchain. All the expensive wide-kernel work (bloom,
// god rays, lens flare, modal freeze-blur) happens in postfx.wgsl at reduced
// resolution; this pass only samples the scene, adds that FX layer, applies
// chromatic aberration, tonemaps and vignettes. Keeping it to a handful of
// taps matters because it is the one pass that always runs at native
// resolution.
struct Post {
  params : vec4<f32>,   // x=blur(0..1) y=vignette z=caAmount w=bloomStrength
  texel : vec4<f32>,    // xy = 1/scene resolution, zw = 1/fx resolution
  flare : vec4<f32>,    // xy = sun screen uv, z = strength(0..1), w = aspect(w/h)
  misc : vec4<f32>,     // x = fx layer enabled (0/1), y = barrel amount
};
@group(0) @binding(0) var<uniform> post : Post;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var sceneTex : texture_2d<f32>;
@group(0) @binding(3) var fxTex : texture_2d<f32>;

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

// CRT lens curvature: bow the sample coordinates outward with r^2, then divide
// by the corner factor (r^2 = 0.5) so the corners still land exactly on the
// frame edge and the warped image keeps filling the canvas.
fn barrel(uv : vec2<f32>, amount : f32) -> vec2<f32> {
  if (amount <= 0.0001) {
    return uv;
  }
  let c = uv - vec2<f32>(0.5);
  let r2 = dot(c, c);
  return vec2<f32>(0.5) + c * ((1.0 + amount * r2) / (1.0 + amount * 0.5));
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let uv = barrel(in.uv, post.misc.y);
  let blurAmt = post.params.x;
  let caAmt = post.params.z;
  let fxOn = post.misc.x;

  var col : vec3<f32>;
  if (fxOn > 0.5 && blurAmt > 0.001) {
    // While the modal freeze-blur is active the FX layer carries the whole
    // (blurred) scene plus bloom/flare/rays, so nothing wide runs at native
    // resolution.
    col = textureSample(fxTex, samp, uv).rgb;
  } else {
    if (caAmt > 0.00001) {
      // Chromatic aberration: offset channels radially from center.
      let dir = uv - vec2<f32>(0.5);
      let ca = dir * caAmt;
      let rC = sampleScene(uv + ca).r;
      let gC = sampleScene(uv).g;
      let bC = sampleScene(uv - ca).b;
      col = vec3<f32>(rC, gC, bC);
    } else {
      col = sampleScene(uv);
    }
    if (fxOn > 0.5) {
      col = col + textureSample(fxTex, samp, uv).rgb;
    }
  }

  var mapped = aces(col);

  if (post.params.y > 0.001) {
    // Vignette.
    let d = distance(uv, vec2<f32>(0.5));
    let vig = 1.0 - post.params.y * smoothstep(0.35, 0.85, d);
    mapped = mapped * vig;
  }

  // Dim the frozen backdrop a touch so the modal pops.
  mapped = mapped * (1.0 - 0.25 * blurAmt);

  return vec4<f32>(pow(mapped, vec3<f32>(1.0 / 2.2)), 1.0);
}
