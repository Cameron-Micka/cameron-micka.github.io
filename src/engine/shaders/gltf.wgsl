// Owned static glTF PBR. Uniform layouts and equations mirror gltf.*.glsl.
struct Frame {
  viewProjection: mat4x4<f32>,
  cameraExposure: vec4<f32>,
  keyDirection: vec4<f32>,
  keyColor: vec4<f32>,
  fillDirection: vec4<f32>,
  fillColor: vec4<f32>,
  ambientSky: vec4<f32>,
  ambientGround: vec4<f32>,
  outputConfig: vec4<f32>,
  fog: vec4<f32>,
};

struct Object {
  model: mat4x4<f32>,
  normalMatrix: mat4x4<f32>,
  transform: vec4<f32>,
};

struct Material {
  baseColor: vec4<f32>,
  emissiveMetallic: vec4<f32>,
  surface: vec4<f32>,
  flags: vec4<f32>,
  texCoords0: vec4<f32>,
  texCoords1: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> object: Object;
@group(2) @binding(0) var<uniform> material: Material;
@group(2) @binding(1) var baseColorTexture: texture_2d<f32>;
@group(2) @binding(2) var baseColorSampler: sampler;
@group(2) @binding(3) var metallicRoughnessTexture: texture_2d<f32>;
@group(2) @binding(4) var metallicRoughnessSampler: sampler;
@group(2) @binding(5) var normalTexture: texture_2d<f32>;
@group(2) @binding(6) var normalSampler: sampler;
@group(2) @binding(7) var occlusionTexture: texture_2d<f32>;
@group(2) @binding(8) var occlusionSampler: sampler;
@group(2) @binding(9) var emissiveTexture: texture_2d<f32>;
@group(2) @binding(10) var emissiveSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) tangent: vec4<f32>,
  @location(3) uv0: vec2<f32>,
  @location(4) uv1: vec2<f32>,
  @location(5) color: vec4<f32>,
};

const PI: f32 = 3.141592653589793;

fn normalizeOr(value: vec3<f32>, fallback: vec3<f32>) -> vec3<f32> {
  let lengthSquared = dot(value, value);
  if (lengthSquared > 1e-20) {
    return value * inverseSqrt(lengthSquared);
  }
  return fallback;
}

@vertex
fn vs(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) tangent: vec4<f32>,
  @location(3) uv0: vec2<f32>,
  @location(4) uv1: vec2<f32>,
  @location(5) color: vec4<f32>,
) -> VertexOutput {
  var out: VertexOutput;
  let world = object.model * vec4<f32>(position, 1.0);
  out.position = frame.viewProjection * world;
  out.world = world.xyz;
  out.normal = normalizeOr(
    (object.normalMatrix * vec4<f32>(normal, 0.0)).xyz,
    vec3<f32>(0.0, 1.0, 0.0),
  );
  out.tangent = vec4<f32>(
    normalizeOr((object.model * vec4<f32>(tangent.xyz, 0.0)).xyz, vec3<f32>(1.0, 0.0, 0.0)),
    tangent.w * object.transform.x,
  );
  out.uv0 = uv0;
  out.uv1 = uv1;
  out.color = color;
  return out;
}

fn slotUv(setIndex: f32, input: VertexOutput) -> vec2<f32> {
  return mix(input.uv0, input.uv1, setIndex);
}

fn fresnelSchlick(cosine: f32, f0: vec3<f32>) -> vec3<f32> {
  let x = clamp(1.0 - cosine, 0.0, 1.0);
  let x2 = x * x;
  return f0 + (vec3<f32>(1.0) - f0) * x2 * x2 * x;
}

fn directLight(
  normal: vec3<f32>,
  view: vec3<f32>,
  light: vec3<f32>,
  radiance: vec3<f32>,
  baseColor: vec3<f32>,
  metallic: f32,
  roughness: f32,
  f0: vec3<f32>,
) -> vec3<f32> {
  let noL = max(dot(normal, light), 0.0);
  let noV = max(dot(normal, view), 1e-4);
  let halfway = normalizeOr(view + light, normal);
  let noH = max(dot(normal, halfway), 0.0);
  let voH = max(dot(view, halfway), 0.0);
  let alpha = roughness * roughness;
  let alpha2 = alpha * alpha;
  let denominator = noH * noH * (alpha2 - 1.0) + 1.0;
  let distribution = alpha2 / max(PI * denominator * denominator, 1e-12);
  let smithV = noL * sqrt(noV * noV * (1.0 - alpha2) + alpha2);
  let smithL = noV * sqrt(noL * noL * (1.0 - alpha2) + alpha2);
  let visibility = 0.5 / max(smithV + smithL, 1e-6);
  let fresnel = fresnelSchlick(voH, f0);
  let diffuse = (vec3<f32>(1.0) - fresnel) * (1.0 - metallic) * baseColor / PI;
  return (diffuse + distribution * visibility * fresnel) * radiance * noL;
}

fn hemisphere(direction: vec3<f32>) -> vec3<f32> {
  return mix(frame.ambientGround.rgb, frame.ambientSky.rgb, direction.y * 0.5 + 0.5);
}

fn aces(color: vec3<f32>) -> vec3<f32> {
  return clamp(
    (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14),
    vec3<f32>(0.0),
    vec3<f32>(1.0),
  );
}

fn linearToSrgb(color: vec3<f32>) -> vec3<f32> {
  let low = color * 12.92;
  let high = 1.055 * pow(color, vec3<f32>(1.0 / 2.4)) - 0.055;
  return select(high, low, color <= vec3<f32>(0.0031308));
}

fn outputColor(input: vec3<f32>) -> vec3<f32> {
  var color = input;
  if (frame.outputConfig.x > 0.5) {
    color = aces(max(color, vec3<f32>(0.0)) * frame.cameraExposure.w);
    if (frame.outputConfig.y < 0.5) {
      color = linearToSrgb(color);
    }
  }
  return color;
}

@fragment
fn fs(input: VertexOutput, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4<f32> {
  // Sample before any nonuniform discard/return so implicit derivatives are
  // well-defined, including alpha-masked and wireframe rendering.
  let base = textureSample(baseColorTexture, baseColorSampler, slotUv(material.texCoords0.x, input)) *
    material.baseColor * input.color;
  let metalRough = textureSample(metallicRoughnessTexture, metallicRoughnessSampler, slotUv(material.texCoords0.y, input));
  var normalSample = textureSample(normalTexture, normalSampler, slotUv(material.texCoords0.z, input)).xyz * 2.0 - 1.0;
  let occlusion = textureSample(occlusionTexture, occlusionSampler, slotUv(material.texCoords0.w, input)).r;
  let emissive = textureSample(emissiveTexture, emissiveSampler, slotUv(material.texCoords1.x, input)).rgb *
    material.emissiveMetallic.rgb;

  if (material.flags.x > 0.5 && material.flags.x < 1.5 && base.a < material.surface.w) {
    discard;
  }
  let alpha = select(1.0, clamp(base.a, 0.0, 1.0), material.flags.x > 1.5);
  if (frame.outputConfig.z > 0.5) {
    return vec4<f32>(outputColor(vec3<f32>(1.0, 0.478, 0.094)), alpha);
  }

  var normal = normalizeOr(input.normal, vec3<f32>(0.0, 1.0, 0.0));
  if (material.flags.y > 0.5) {
    let axis = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(0.0, 0.0, 1.0), abs(normal.z) < 0.999);
    let fallbackTangent = normalizeOr(cross(axis, normal), vec3<f32>(1.0, 0.0, 0.0));
    let tangent = normalizeOr(input.tangent.xyz - normal * dot(normal, input.tangent.xyz), fallbackTangent);
    let bitangent = cross(normal, tangent) * select(1.0, -1.0, input.tangent.w < 0.0);
    normalSample = vec3<f32>(normalSample.xy * material.surface.y, normalSample.z);
    normal = normalizeOr(mat3x3<f32>(tangent, bitangent, normal) * normalSample, normal);
  }
  if (material.flags.z > 0.5 && !frontFacing) {
    normal = -normal;
  }

  let view = normalizeOr(frame.cameraExposure.xyz - input.world, normal);
  let metallic = clamp(material.emissiveMetallic.w * metalRough.b, 0.0, 1.0);
  let roughness = clamp(material.surface.x * metalRough.g, 0.045, 1.0);
  let f0 = mix(vec3<f32>(0.04), base.rgb, metallic);
  var color = directLight(normal, view, frame.keyDirection.xyz, frame.keyColor.rgb, base.rgb, metallic, roughness, f0);
  color += directLight(normal, view, frame.fillDirection.xyz, frame.fillColor.rgb, base.rgb, metallic, roughness, f0);

  // Hemispheric ambient is intentionally not a full IBL implementation.
  let ambientDiffuse = hemisphere(normal) * base.rgb * (1.0 - metallic) * (vec3<f32>(1.0) - f0);
  let ambientSpecular = hemisphere(reflect(-view, normal)) *
    fresnelSchlick(max(dot(normal, view), 0.0), f0) * (1.0 - 0.5 * roughness);
  color += (ambientDiffuse + ambientSpecular) * mix(1.0, occlusion, material.surface.z);
  color += emissive;
  let fogDistance = distance(input.world, frame.cameraExposure.xyz) * frame.fog.w;
  color = mix(color, frame.fog.rgb, 1.0 - exp(-fogDistance * fogDistance));
  return vec4<f32>(outputColor(color), alpha);
}
