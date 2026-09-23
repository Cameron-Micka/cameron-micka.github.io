#version 300 es
precision highp float;

layout(std140) uniform GltfFrameUniforms {
  mat4 uViewProjection;
  vec4 uCameraExposure;
  vec4 uKeyDirection;
  vec4 uKeyColor;
  vec4 uFillDirection;
  vec4 uFillColor;
  vec4 uAmbientSky;
  vec4 uAmbientGround;
  vec4 uOutput;
  vec4 uFog;
};

layout(std140) uniform GltfMaterialUniforms {
  vec4 uBaseColor;
  vec4 uEmissiveMetallic;
  vec4 uSurface;
  vec4 uFlags;
  vec4 uTexCoords0;
  vec4 uTexCoords1;
};

uniform sampler2D uBaseColorTexture;
uniform sampler2D uMetallicRoughnessTexture;
uniform sampler2D uNormalTexture;
uniform sampler2D uOcclusionTexture;
uniform sampler2D uEmissiveTexture;

in vec3 vWorld;
in vec3 vNormal;
in vec4 vTangent;
in vec2 vUv0;
in vec2 vUv1;
in vec4 vColor;
layout(location = 0) out vec4 outColor;

const float PI = 3.141592653589793;

vec3 normalizeOr(vec3 value, vec3 fallback) {
  float lengthSquared = dot(value, value);
  return lengthSquared > 1e-20 ? value * inversesqrt(lengthSquared) : fallback;
}

vec2 slotUv(float setIndex) {
  return mix(vUv0, vUv1, setIndex);
}

vec3 fresnelSchlick(float cosine, vec3 f0) {
  float x = clamp(1.0 - cosine, 0.0, 1.0);
  float x2 = x * x;
  return f0 + (vec3(1.0) - f0) * x2 * x2 * x;
}

vec3 directLight(
  vec3 normal,
  vec3 view,
  vec3 light,
  vec3 radiance,
  vec3 baseColor,
  float metallic,
  float roughness,
  vec3 f0
) {
  float noL = max(dot(normal, light), 0.0);
  float noV = max(dot(normal, view), 1e-4);
  vec3 halfway = normalizeOr(view + light, normal);
  float noH = max(dot(normal, halfway), 0.0);
  float voH = max(dot(view, halfway), 0.0);
  float alpha = roughness * roughness;
  float alpha2 = alpha * alpha;
  float denominator = noH * noH * (alpha2 - 1.0) + 1.0;
  float distribution = alpha2 / max(PI * denominator * denominator, 1e-12);
  float smithV = noL * sqrt(noV * noV * (1.0 - alpha2) + alpha2);
  float smithL = noV * sqrt(noL * noL * (1.0 - alpha2) + alpha2);
  float visibility = 0.5 / max(smithV + smithL, 1e-6);
  vec3 fresnel = fresnelSchlick(voH, f0);
  vec3 diffuse = (vec3(1.0) - fresnel) * (1.0 - metallic) * baseColor / PI;
  return (diffuse + distribution * visibility * fresnel) * radiance * noL;
}

vec3 hemisphere(vec3 direction) {
  return mix(uAmbientGround.rgb, uAmbientSky.rgb, direction.y * 0.5 + 0.5);
}

vec3 aces(vec3 color) {
  return clamp(
    (color * (2.51 * color + 0.03)) /
    (color * (2.43 * color + 0.59) + 0.14),
    0.0,
    1.0
  );
}

vec3 linearToSrgb(vec3 color) {
  vec3 low = color * 12.92;
  vec3 high = 1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055;
  return mix(high, low, lessThanEqual(color, vec3(0.0031308)));
}

vec3 outputColor(vec3 color) {
  if (uOutput.x > 0.5) {
    color = aces(max(color, vec3(0.0)) * uCameraExposure.w);
    // LDR scene output leaves encoding to the host; sRGB targets encode it.
    if (uOutput.y < 0.5) color = linearToSrgb(color);
  }
  return color;
}

void main() {
  // sRGB texture storage decodes RGB before filtering; alpha and all three
  // data textures stay linear. Vertex colors and factors are already linear.
  vec4 base = texture(uBaseColorTexture, slotUv(uTexCoords0.x)) * uBaseColor * vColor;
  vec4 metalRough = texture(uMetallicRoughnessTexture, slotUv(uTexCoords0.y));
  vec3 normalSample = texture(uNormalTexture, slotUv(uTexCoords0.z)).xyz * 2.0 - 1.0;
  float occlusion = texture(uOcclusionTexture, slotUv(uTexCoords0.w)).r;
  vec3 emissive = texture(uEmissiveTexture, slotUv(uTexCoords1.x)).rgb * uEmissiveMetallic.rgb;

  if (uFlags.x > 0.5 && uFlags.x < 1.5 && base.a < uSurface.w) discard;
  float alpha = uFlags.x > 1.5 ? clamp(base.a, 0.0, 1.0) : 1.0;
  if (uOutput.z > 0.5) {
    outColor = vec4(outputColor(mix(vec3(0.25, 0.8, 1.0), base.rgb, 0.25)), alpha);
    return;
  }

  vec3 normal = normalizeOr(vNormal, vec3(0.0, 1.0, 0.0));
  if (uFlags.y > 0.5) {
    vec3 axis = abs(normal.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 fallbackTangent = normalizeOr(cross(axis, normal), vec3(1.0, 0.0, 0.0));
    vec3 tangent = normalizeOr(vTangent.xyz - normal * dot(normal, vTangent.xyz), fallbackTangent);
    vec3 bitangent = cross(normal, tangent) * (vTangent.w < 0.0 ? -1.0 : 1.0);
    normalSample.xy *= uSurface.y;
    normal = normalizeOr(mat3(tangent, bitangent, normal) * normalSample, normal);
  }
  if (uFlags.z > 0.5 && !gl_FrontFacing) normal = -normal;

  vec3 view = normalizeOr(uCameraExposure.xyz - vWorld, normal);
  float metallic = clamp(uEmissiveMetallic.w * metalRough.b, 0.0, 1.0);
  float roughness = clamp(uSurface.x * metalRough.g, 0.045, 1.0);
  vec3 f0 = mix(vec3(0.04), base.rgb, metallic);
  vec3 color = directLight(normal, view, uKeyDirection.xyz, uKeyColor.rgb, base.rgb, metallic, roughness, f0);
  color += directLight(normal, view, uFillDirection.xyz, uFillColor.rgb, base.rgb, metallic, roughness, f0);

  // Deliberately lightweight hemispheric ambient, not prefiltered IBL.
  vec3 ambientDiffuse = hemisphere(normal) * base.rgb * (1.0 - metallic) * (vec3(1.0) - f0);
  vec3 ambientSpecular = hemisphere(reflect(-view, normal)) *
    fresnelSchlick(max(dot(normal, view), 0.0), f0) * (1.0 - 0.5 * roughness);
  color += (ambientDiffuse + ambientSpecular) * mix(1.0, occlusion, uSurface.z);
  color += emissive;
  float fogDistance = distance(vWorld, uCameraExposure.xyz) * uFog.w;
  color = mix(color, uFog.rgb, 1.0 - exp(-fogDistance * fogDistance));
  outColor = vec4(outputColor(color), alpha);
}
