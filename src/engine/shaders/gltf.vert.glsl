#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aTangent;
layout(location = 3) in vec2 aUv0;
layout(location = 4) in vec2 aUv1;
layout(location = 5) in vec4 aColor;

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

layout(std140) uniform GltfObjectUniforms {
  mat4 uModel;
  mat4 uNormalMatrix;
  vec4 uTransform;
};

out vec3 vWorld;
out vec3 vNormal;
out vec4 vTangent;
out vec2 vUv0;
out vec2 vUv1;
out vec4 vColor;

vec3 normalizeOr(vec3 value, vec3 fallback) {
  float lengthSquared = dot(value, value);
  return lengthSquared > 1e-20 ? value * inversesqrt(lengthSquared) : fallback;
}

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = normalizeOr(mat3(uNormalMatrix) * aNormal, vec3(0.0, 1.0, 0.0));
  vTangent = vec4(
    normalizeOr(mat3(uModel) * aTangent.xyz, vec3(1.0, 0.0, 0.0)),
    aTangent.w * uTransform.x
  );
  vUv0 = aUv0;
  vUv1 = aUv1;
  vColor = aColor;
  vec4 clip = uViewProjection * world;
  // The CPU camera uses WebGPU's [0, 1] depth on both backends.
  gl_Position = vec4(clip.xy, clip.z * 2.0 - clip.w, clip.w);
}
