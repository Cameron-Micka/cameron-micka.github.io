import type { FrameState, LoadProgressFn, PlanetInstance, RenderStats, SceneRenderer } from './types';
import { createSphere, createRingGeometry, interleave, trianglesToLineIndices, selectSphereLod, SPHERE_LODS_WEBGL2 } from './geometry';
import { mat4 } from './math/mat4';
import { quat, type Quat } from './math/quat';
import { vec3 } from './math/vec3';
import { mulberry32 } from './math/rng';
import { poiMarkerDistance, poiFocusFade } from './Scene';
import { computeSunFlare } from './lensFlare';
import { paintYield } from './paintYield';

// Lower-fidelity mirror of the WebGPU experience: procedural planets, a nebula
// backdrop, additive star + POI points. No HDR/bloom post — rendered directly.
// Must match CLOUD_SHELL_SCALE in clouds.wgsl / planet.wgsl / PLANET_FRAG /
// CLOUDS_FRAG: cloud-shadow projection in the planet shader assumes the
// shell sits exactly here in unit-sphere local space.
const CLOUD_SHELL_SCALE_WEBGL2 = 1.006;

const NEBULA_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID == 2) ? 3.0 : -1.0, (gl_VertexID == 1) ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 1.0, 1.0);
}`;

// Volumetric nebula backdrop — ray-marches a 3D fbm density field along the
// WORLD-space view ray (unprojected per-pixel from uInvViewProj) so the
// nebula stays locked to the world as the camera rotates / translates.
// Inspired by https://www.shadertoy.com/view/wX2Bzy.
const NEBULA_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform float uTime;
uniform mat4 uInvViewProj;
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float hash3(vec3 p){vec3 q=fract(p*0.3183099+vec3(0.1,0.2,0.3));q*=17.0;return fract(q.x*q.y*q.z*(q.x+q.y+q.z));}
float vnoise3(vec3 x){
  vec3 i=floor(x),f=fract(x);vec3 u=f*f*(3.0-2.0*f);
  float n000=hash3(i),n100=hash3(i+vec3(1,0,0)),n010=hash3(i+vec3(0,1,0)),n110=hash3(i+vec3(1,1,0));
  float n001=hash3(i+vec3(0,0,1)),n101=hash3(i+vec3(1,0,1)),n011=hash3(i+vec3(0,1,1)),n111=hash3(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z);
}
float fbm3(vec3 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*vnoise3(p);p*=2.03;a*=.5;}return v;}
void main(){
  vec2 ndc=vec2(vUv.x*2.0-1.0,vUv.y*2.0-1.0);
  vec4 nearH=uInvViewProj*vec4(ndc,0.0,1.0);
  vec4 farH=uInvViewProj*vec4(ndc,1.0,1.0);
  vec3 dirW=normalize(farH.xyz/farH.w-nearH.xyz/nearH.w);
  // Anchor warm core to a fixed world-space direction so it doesn't drift
  // with the lens.
  vec3 coreDir=normalize(vec3(0.0,0.20,-1.0));
  float rad=length(dirW-coreDir);
  float tt=uTime;
  float time=tt*0.08;
  vec3 drift=vec3(tt*0.012,tt*-0.006,time);
  // Skybox-style march: origin at world 0, direction = world view ray.
  vec3 ro=vec3(0.0);
  vec3 rd=dirW;
  vec3 warm=vec3(0.55,0.30,0.10);
  vec3 glow=vec3(0.70,0.42,0.16);
  vec3 cool=vec3(0.04,0.06,0.14);
  vec3 deep=vec3(0.008,0.014,0.035);
  float jitter=hash21(gl_FragCoord.xy)*0.10;
  float t=0.45+jitter;
  vec3 col=vec3(0.0);
  float alpha=0.0;
  for(int i=0;i<24;i++){
    vec3 p=ro+rd*t;
    float n=fbm3(p*1.05+drift);
    float dens=smoothstep(0.46,0.78,n);
    float coreFade=exp(-rad*1.10);
    float density=dens*(0.35+0.95*coreFade);
    float warmth=coreFade*(0.35+0.65*smoothstep(0.5,0.85,n));
    vec3 samp=mix(cool,warm,clamp(warmth,0.0,1.0));
    samp=mix(samp,glow,smoothstep(0.72,1.0,n)*coreFade*0.65);
    float inc=density*0.14;
    col+=samp*inc*(1.0-alpha);
    alpha+=inc*(1.0-alpha);
    if(alpha>0.97) break;
    t+=0.10+t*0.020;
  }
  vec3 bg=mix(deep,cool*0.55,smoothstep(0.0,1.4,rad));
  col+=bg*(1.0-alpha);
  float vig=1.0-0.35*smoothstep(0.6,1.4,rad);
  frag=vec4(col*vig,1.0);
}`;

const PLANET_VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vNrm;
out vec3 vLocal;
out vec3 vWorld;
void main(){
  vec4 world=uModel*vec4(aPos,1.0);
  vWorld=world.xyz;
  vNrm=normalize((uModel*vec4(aNrm,0.0)).xyz);
  vLocal=aPos;
  gl_Position=uViewProj*world;
}`;

const PLANET_FRAG = `#version 300 es
precision highp float;
in vec3 vNrm;in vec3 vLocal;in vec3 vWorld;
out vec4 frag;
uniform vec3 uCamera;uniform vec3 uLight;
uniform vec3 uLow;uniform vec3 uMid;uniform vec3 uHigh;
uniform float uSeed;uniform float uFocus;uniform float uOceans;
uniform float uCityLights;uniform float uFlow;uniform float uCraters;
uniform float uTime;uniform float uReducedMotion;
uniform float uCloudShadow; // 0 = clouds off, >0 = shadow strength multiplier
uniform mat4 uModel;
uniform int uShadowCount;uniform vec4 uShadowSpheres[8];
float hash3(vec3 p){vec3 q=fract(p*0.3183099+vec3(0.1,0.2,0.3));q*=17.0;return fract(q.x*q.y*q.z*(q.x+q.y+q.z));}
float vnoise(vec3 x){
  vec3 i=floor(x),f=fract(x);vec3 u=f*f*(3.0-2.0*f);
  float n000=hash3(i),n100=hash3(i+vec3(1,0,0)),n010=hash3(i+vec3(0,1,0)),n110=hash3(i+vec3(1,1,0));
  float n001=hash3(i+vec3(0,0,1)),n101=hash3(i+vec3(1,0,1)),n011=hash3(i+vec3(0,1,1)),n111=hash3(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z);
}
float fbm(vec3 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*vnoise(p);p*=2.03;a*=.5;}return v;}
// Low-frequency fBm for continent-scale land/sea distribution. 3 octaves so
// the result is smooth at sub-continent scale and gives big coherent
// landmasses instead of fragmenting with the fine surface noise.
float continentFbm(vec3 p){float v=0.,a=.6;for(int i=0;i<3;i++){v+=a*vnoise(p);p*=2.0;a*=.5;}return v;}
// Ridged fBm for mountain chains. 2 octaves only — high-frequency octaves
// break up the linearity, so we keep just the dominant ridge structure to
// get continuous Andes/Himalaya-like scars instead of noisy peaks.
float ridgedFbm(vec3 p){float v=0.,a=.65;for(int i=0;i<2;i++){float n=vnoise(p);v+=a*(1.0-abs(n-0.5)*2.0);p*=2.1;a*=.5;}return v;}
vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
// --- Cook-Torrance PBR helpers (mirror of planet.wgsl) ---
const float PI=3.14159265359;
float dGGX(float NdH,float r){float a=r*r;float a2=a*a;float f=NdH*NdH*(a2-1.0)+1.0;return a2/(PI*f*f);}
float gSchlickGGX(float NdX,float r){float k=(r+1.0);k=(k*k)*0.125;return NdX/(NdX*(1.0-k)+k);}
float gSmith(float NdV,float NdL,float r){return gSchlickGGX(NdV,r)*gSchlickGGX(NdL,r);}
vec3 fSchlick(float c,vec3 F0){float f=pow(clamp(1.0-c,0.0,1.0),5.0);return F0+(vec3(1.0)-F0)*f;}
// Distance fog (shared across planet, atmosphere): exp-squared falloff.
// Density tuned for PLANET_SPACING=9 / VIEW_DISTANCE=8.5 so the focused
// planet stays crisp and planets two or three slots away noticeably fade.
const float FOG_DENSITY=0.018;
const vec3 FOG_COLOR=vec3(0.04,0.06,0.14);
float fogFactor(vec3 worldPos,vec3 camPos){
  float d=distance(worldPos,camPos);float s=d*FOG_DENSITY;return 1.0-exp(-s*s);
}
// Analytic spherical shadow (mirror of planet.wgsl). 1.0 unshadowed, 0.0
// fully shadowed. Fixed loop bound for driver robustness.
float shadowFactor(vec3 p,vec3 L){
  float s=1.0;
  for(int i=0;i<8;i++){
    if(i>=uShadowCount)break;
    vec4 sph=uShadowSpheres[i];
    vec3 d=sph.xyz-p;
    float t=dot(d,L);
    if(t<=0.0)continue;
    float c2=dot(d,d)-t*t;
    float R=sph.w;float R2=R*R;
    s*=smoothstep(R2,R2*1.10,c2);
  }
  return s;
}
// ---- cloud noise (must match clouds.wgsl / CLOUDS_FRAG exactly) ---------
// The same density function is sampled in CLOUDS_FRAG so the cloud shadow
// projected onto the surface here lines up with the rendered cloud puff.
float cHash3(vec3 p){vec3 q=fract(p*0.3183099+vec3(0.1,0.2,0.3));q*=17.0;return fract(q.x*q.y*q.z*(q.x+q.y+q.z));}
float cVnoise(vec3 x){
  vec3 i=floor(x),f=fract(x);vec3 u=f*f*(3.0-2.0*f);
  float n000=cHash3(i),n100=cHash3(i+vec3(1,0,0)),n010=cHash3(i+vec3(0,1,0)),n110=cHash3(i+vec3(1,1,0));
  float n001=cHash3(i+vec3(0,0,1)),n101=cHash3(i+vec3(1,0,1)),n011=cHash3(i+vec3(0,1,1)),n111=cHash3(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z);
}
float cFbm(vec3 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*cVnoise(p);p*=2.03;a*=.5;}return v;}
float cloudRotation(float time,float seedf,float reducedMotion){
  float baseSpeed=0.015;
  float jitter=fract(seedf*0.000371)*0.025;
  float dir=fract(seedf*0.0007)<0.30?-1.0:1.0;
  float mult=reducedMotion>0.5?0.10:1.0;
  return time*(baseSpeed+jitter)*dir*mult;
}
float cloudCoverage(float seedf){return 0.40+0.30*fract(seedf*0.00091);}
float cloudDensity(vec3 localDir,float time,float seedf,float reducedMotion){
  float rot=cloudRotation(time,seedf,reducedMotion);
  float cs=cos(rot),sn=sin(rot);
  vec3 rp=vec3(cs*localDir.x+sn*localDir.z,localDir.y,-sn*localDir.x+cs*localDir.z);
  vec3 seedShift=vec3(seedf*0.0017,seedf*0.0023,seedf*0.0029);
  vec3 p=rp*4.8+seedShift;
  // Domain warp (iq): two extra fbm samples form a warp vector, the final
  // sample re-evaluates the field at the warped position. Produces the
  // characteristic swirly, turbulent look that pure additive fbm lacks.
  float qx=cFbm(p);
  float qy=cFbm(p+vec3(5.2,1.3,2.8));
  float n=cFbm(p+0.85*vec3(qx-0.5,qy-0.5,(qx-qy)*0.7));
  float cov=cloudCoverage(seedf);
  float lo=0.62-cov*0.30;float hi=lo+0.14;
  return smoothstep(lo,hi,n);
}
// Cloud shadow on the planet surface. vLocal is the unit-sphere local pos;
// world light is converted to the planet's local rotation frame via the
// normalized model columns (uniform scale). Then we hit the (taller, see
// below) cloud shadow shell with the exact ray-sphere intersection and
// sample the same density the cloud shader rendered. Returns the multiplier
// on direct light (1.0 = unshadowed, [1-STRENGTH] = fully shadowed).
const float CLOUD_SHADOW_STRENGTH=1.0;
// Shadow-projection shell, intentionally taller than the rendered cloud shell
// (1.006) so the cast shadow is displaced toward the anti-solar side and
// clears the opaque puff instead of hiding directly beneath it. See the
// matching note in planet.wgsl.
const float CLOUD_SHADOW_SHELL=1.06;
float cloudShadow(vec3 vLocal,vec3 worldL,float time,float seedf,float reducedMotion,float enabled){
  if(enabled<0.001)return 1.0;
  vec3 r0=normalize(uModel[0].xyz);
  vec3 r1=normalize(uModel[1].xyz);
  vec3 r2=normalize(uModel[2].xyz);
  vec3 localL=vec3(dot(r0,worldL),dot(r1,worldL),dot(r2,worldL));
  vec3 vn=normalize(vLocal);
  float nL=dot(vn,localL);
  if(nL<=0.0)return 1.0;
  float R2m1=CLOUD_SHADOW_SHELL*CLOUD_SHADOW_SHELL-1.0;
  float t=-nL+sqrt(nL*nL+R2m1);
  vec3 cloudDir=normalize(vn+localL*t);
  float density=cloudDensity(cloudDir,time,seedf,reducedMotion);
  return 1.0-density*CLOUD_SHADOW_STRENGTH*enabled;
}
// Marbled land color + height from domain-warped fBm at noise-domain position
// sp. Factored out so the flow-field feature can sample two advected
// positions and cross-fade. local is the un-advected position used for
// region-scale biome tint. Mirror of surfaceMarble in planet.wgsl.
struct Surf{vec3 color;float height;};
Surf surfaceMarble(vec3 sp,vec3 local,float seed){
  vec3 q=vec3(fbm(sp),fbm(sp+vec3(5.2,1.3,2.8)),fbm(sp+vec3(7.1,4.4,6.9)));
  vec3 warpQ=sp+2.5*q;
  vec3 r=vec3(fbm(warpQ+vec3(1.7,9.2,3.5)),fbm(warpQ+vec3(8.3,2.8,4.1)),fbm(warpQ+vec3(4.7,7.7,1.9)));
  float h=clamp(fbm(sp+2.5*r),0.0,1.0);
  vec3 land=mix(uLow,uMid,smoothstep(0.25,0.55,h));
  land=mix(land,uHigh,smoothstep(0.6,0.85,h));
  float qLen=clamp(length(q)*0.55,0.0,1.0);
  float rLen=clamp(length(r)*0.55,0.0,1.0);
  land=mix(land,uLow*0.55,qLen*0.22);
  land=mix(land,uHigh*1.15,rLen*0.20);
  float biomeR=vnoise(local*0.55+vec3(11.3,3.7,5.1));
  float biomeG=vnoise(local*0.55+vec3(24.7,6.2,9.4));
  float biomeB=vnoise(local*0.55+vec3(37.1,8.9,2.6));
  vec3 biomeColor=mix(uLow,uHigh,vec3(biomeR,biomeG,biomeB));
  land=mix(land,biomeColor,0.18);
  float ridge=ridgedFbm(warpQ*0.5);
  float mountainMask=smoothstep(0.62,0.74,ridge)*smoothstep(0.42,0.62,h);
  vec3 mountainRock=mix(uMid*0.55,vec3(0.48,0.28,0.16),0.75);
  land=mix(land,mountainRock,mountainMask*0.85);
  float snowMask=smoothstep(0.78,0.95,h)*smoothstep(0.58,0.74,ridge);
  land=mix(land,vec3(0.94,0.95,0.97),snowMask*0.9);
  return Surf(land,h);
}
// Smooth unit tangent flow direction: low-frequency 3-channel noise vector
// projected onto the surface tangent plane. Mirror of flowDir in planet.wgsl.
vec3 flowDir(vec3 local,vec3 n,float seed){
  vec3 fp=local*1.5+vec3(seed*0.002,seed*0.0017,seed*0.0023);
  vec3 v=vec3(vnoise(fp)-0.5,vnoise(fp+vec3(13.1,7.7,2.3))-0.5,vnoise(fp+vec3(5.5,19.2,8.8))-0.5);
  v=v-n*dot(v,n);
  float l=length(v);
  if(l<1e-4)return vec3(0.0);
  return v/l;
}
// ---- meteorite impact craters (moons) — mirror of planet.wgsl -------------
// Worley-style field: only cells whose hash clears a threshold spawn a
// crater, so impacts read as scattered rather than a packed honeycomb. Each
// crater is a radial height profile (bowl, raised rim, ejecta apron); its
// radial derivative gives an analytic gradient that perturbs the shading
// normal so the relief is lit by the real sun direction.
struct Crater{float height;vec3 grad;};
// t = distance / crater radius. <0.55 floor, 0.55..1.0 inner wall up to the
// rim crest at t=1, then the ejecta apron decays out to t=1.6.
float craterProfile(float t){
  float bowl=smoothstep(1.0,0.55,t);
  float rim=smoothstep(0.62,0.98,t)*smoothstep(1.6,1.0,t);
  return rim*0.45-bowl;
}
const float CRATER_REACH=1.6;
const float CRATER_DT=0.04;
// Size range in cell units; the upper bound keeps the widest crater (plus
// edge wobble) inside the 3x3x3 neighborhood.
const float CRATER_MIN_R=0.10;
const float CRATER_MAX_R=0.52;
const float CRATER_WOBBLE=0.11;
Crater craterLayer(vec3 p,vec3 n,float freq,float threshold,float amp){
  vec3 q=p*freq;
  vec3 cellId=floor(q);
  vec3 sub=fract(q);
  float height=0.0;
  vec3 grad=vec3(0.0);
  // 3x3x3 neighborhood so craters straddling a cell wall are not clipped.
  for(int dx=-1;dx<=1;dx++){
    for(int dy=-1;dy<=1;dy++){
      for(int dz=-1;dz<=1;dz++){
        vec3 off=vec3(float(dx),float(dy),float(dz));
        float h=hash3(cellId+off);
        if(h<threshold)continue;
        vec3 center=off+vec3(fract(h*1.7),fract(h*7.3),fract(h*13.1));
        vec3 delta=sub-center;
        // Cubed hash biases sizes toward small pits with the odd wide basin.
        float hr=fract(h*23.7);
        float radius=mix(CRATER_MIN_R,CRATER_MAX_R,hr*hr*hr);
        float d=length(delta);
        // Value-noise radius modulation so rims are ragged, not perfect
        // circles; lobe size tracks the crater radius.
        float wob=vnoise((cellId+off+sub)*(1.6/radius)+vec3(h*31.0))-0.5;
        float rEff=radius*(1.0+CRATER_WOBBLE*2.0*wob);
        float t=d/rEff;
        if(t>CRATER_REACH)continue;
        // Depth scales with radius (constant depth-to-diameter ratio).
        height+=amp*radius*craterProfile(t);
        if(d>1e-4){
          float slope=(craterProfile(t+CRATER_DT)-craterProfile(t-CRATER_DT))/(2.0*CRATER_DT);
          grad+=(delta/d)*slope*amp*(radius/rEff)*freq;
        }
      }
    }
  }
  grad-=n*dot(grad,n);
  return Crater(height,grad);
}
void main(){
  vec3 n=normalize(vNrm);
  vec3 viewDir=normalize(uCamera-vWorld);
  vec3 lightDir=normalize(uLight);
  float rim=pow(1.0-clamp(dot(n,viewDir),0.0,1.0),3.0);
  vec3 sp=vLocal*2.2+vec3(uSeed*0.001);
  // Flow-field advection (after Emil Dziewanowski,
  // https://emildziewanowski.com/flowfields/): when uFlow is on, advect the
  // marbled surface detail along a tangent flow field, cross-fading two
  // half-cycle-offset samples so it streams without unbounded stretching.
  // Disabled under reduced motion.
  vec3 land;float h;
  if(uFlow>0.5){
    float speed=uReducedMotion>0.5?0.0:0.16;
    float mag=1.0;
    vec3 flow=flowDir(vLocal,n,uSeed);
    float t=uTime*speed;
    float ph0=fract(t);
    float ph1=fract(t+0.5);
    Surf s0=surfaceMarble(sp-flow*ph0*mag,vLocal,uSeed);
    Surf s1=surfaceMarble(sp-flow*ph1*mag,vLocal,uSeed);
    float w=abs(0.5-ph0)*2.0;
    land=mix(s0.color,s1.color,w);
    h=mix(s0.height,s1.height,w);
  }else{
    Surf s=surfaceMarble(sp,vLocal,uSeed);
    land=s.color;h=s.height;
  }
  // Oceans: low-frequency continent field clumps landmasses Earth-like.
  vec3 continentPos=vLocal*1.1+vec3(uSeed*0.0011);
  float continentH=continentFbm(continentPos);
  float oceanField=continentH*0.85+h*0.15;
  float waterLevel=0.55;
  float waterMask=uOceans*(1.0-smoothstep(waterLevel-0.03,waterLevel+0.03,oceanField));
  vec3 deepOcean=vec3(0.005,0.018,0.07);
  vec3 shallowOcean=vec3(0.42,0.82,0.80);
  float depth=smoothstep(waterLevel-0.10,waterLevel,oceanField);
  vec3 water=mix(deepOcean,shallowOcean,depth);
  vec3 base=mix(land,water,waterMask);
  // Polar ice caps: tighter to the poles, with internal breakup, shallow blue
  // ice tones, and directional crease darkening so the caps read less flat.
  // Two offset fbm passes form a domain-warp vector that distorts the edge
  // sampling position, producing wispy, tendril-like fronds at the boundary.
  // Mirror of planet.wgsl, including the uOceans gate: every ice term is
  // scaled by uOceans, so on a dry world the eight fbm calls below are pure
  // waste. uOceans is uniform across the draw, so the branch is coherent.
  vec3 localPos=normalize(vLocal);
  vec3 r0=normalize(uModel[0].xyz);
  vec3 r1=normalize(uModel[1].xyz);
  vec3 r2=normalize(uModel[2].xyz);
  vec3 localLightDir=normalize(vec3(dot(r0,lightDir),dot(r1,lightDir),dot(r2,lightDir)));
  float iceMask=0.0;
  if(uOceans>0.5){
  float lat=abs(localPos.y);
  vec3 iceWarpPos=localPos*3.8+vec3(uSeed*0.0019,uSeed*0.0023,uSeed*0.0017);
  float iceWarpA=fbm(iceWarpPos)-0.5;
  float iceWarpB=fbm(iceWarpPos+vec3(3.7,1.8,5.2))-0.5;
  vec3 iceWarpHiPos=localPos*11.0+vec3(uSeed*0.0026,uSeed*0.0034,uSeed*0.0022);
  float iceWarpHiA=fbm(iceWarpHiPos)-0.5;
  float iceWarpHiB=fbm(iceWarpHiPos+vec3(2.3,6.1,4.4))-0.5;
  vec3 iceWarpedPos=localPos+vec3(iceWarpA,iceWarpA*iceWarpB,iceWarpB)*0.34+vec3(iceWarpHiA,iceWarpHiA*iceWarpHiB,iceWarpHiB)*0.11;
  float iceNoise=fbm(iceWarpedPos*2.6+vec3(uSeed*0.0015,uSeed*0.0021,uSeed*0.0018));
  float iceEdgeFine=fbm(iceWarpedPos*6.4+vec3(uSeed*0.0024,uSeed*0.0033,uSeed*0.0029))-0.5;
  float iceEdge=0.87+(iceNoise-0.5)*0.26+iceEdgeFine*0.08;
  iceMask=uOceans*smoothstep(iceEdge-0.04,iceEdge+0.03,lat);
  vec3 iceDetailPos=localPos*8.0+vec3(uSeed*0.0031,uSeed*0.0027,uSeed*0.0037);
  float iceDetail=fbm(iceDetailPos);
  vec3 iceRidgePhase=vec3(4.2,1.7,8.4);
  float iceRidges=ridgedFbm(iceDetailPos*0.8+iceRidgePhase);
  float iceBlue=smoothstep(0.44,0.78,iceDetail)*smoothstep(0.12,0.7,iceMask);
  float iceCrease=smoothstep(0.34,0.72,iceRidges);
  float iceSelfShadow=1.0-iceCrease*smoothstep(0.0,0.75,dot(localPos,localLightDir))*0.28;
  vec3 iceColor=mix(vec3(0.88,0.93,0.98),vec3(0.48,0.70,0.92),iceBlue*0.85);
  base=mix(base,iceColor*iceSelfShadow,iceMask);
  }
  // Meteorite impact craters (moons). Two size classes — sparse large basins
  // plus a denser field of small pits. Bowls darken toward shadowed regolith,
  // rims and ejecta brighten with freshly excavated material, and the profile
  // gradient perturbs the shading normal so relief tracks the sun direction.
  vec3 shadeN=n;
  if(uCraters>0.5){
    // fwidth needs uniform control flow; uCraters is uniform per draw. The
    // per-layer cell footprint drives an LOD fade so the grid dissolves
    // instead of aliasing into sparkle once a cell nears pixel size.
    vec3 fwl=fwidth(localPos);
    float fp=max(fwl.x,max(fwl.y,fwl.z));
    vec3 cp=localPos+vec3(uSeed*0.0013,uSeed*0.0021,uSeed*0.0007);
    float bigFade=1.0-smoothstep(0.25,0.60,fp*5.5);
    float smallFade=1.0-smoothstep(0.25,0.60,fp*13.0);
    float craterH=0.0;
    vec3 craterG=vec3(0.0);
    if(bigFade>0.002){
      Crater big=craterLayer(cp,localPos,5.5,0.55,0.040*bigFade);
      craterH+=big.height;craterG+=big.grad;
    }
    if(smallFade>0.002){
      Crater small=craterLayer(cp+vec3(3.1,7.9,1.3),localPos,13.0,0.66,0.016*smallFade);
      craterH+=small.height;craterG+=small.grad;
    }
    // Soft, low-contrast masks so craters read as gentle regolith mottling.
    float floorMask=clamp(-craterH*22.0,0.0,1.0);
    float rimMask=clamp(craterH*38.0,0.0,1.0);
    base=mix(base,base*0.80,floorMask*0.45);
    base=mix(base,min(base*1.18+vec3(0.01),vec3(1.0)),rimMask*0.30);
    vec3 gradWorld=r0*craterG.x+r1*craterG.y+r2*craterG.z;
    shadeN=normalize(n-gradWorld);
  }
  // Cook-Torrance PBR direct lighting from key sun. Water = smooth dielectric
  // (roughness floor 0.35 to keep GGX highlight FWHM wider than a UV-sphere
  // triangle face, see planet.wgsl for the FWHM derivation); land = rough.
  vec3 albedo=base;
  float metallic=0.0;
  float roughness=mix(mix(0.92,0.35,waterMask),0.5,iceMask);
  vec3 F0base=mix(mix(vec3(0.04),vec3(0.02),waterMask),vec3(0.05,0.055,0.06),iceMask);
  vec3 F0=mix(F0base,albedo,metallic);
  vec3 L=lightDir;vec3 V=viewDir;vec3 H=normalize(L+V);
  float NdL=clamp(dot(shadeN,L),0.0,1.0);
  float NdV=max(dot(shadeN,V),1e-4);
  float NdH=clamp(dot(shadeN,H),0.0,1.0);
  float VdH=clamp(dot(V,H),0.0,1.0);
  float D=dGGX(NdH,roughness);
  float G=gSmith(NdV,NdL,roughness);
  vec3 F=fSchlick(VdH,F0);
  // Golden glitter on the water: tint the specular highlight toward warm gold
  // (only on water via waterMask) so the sun's reflection reads like a sunset
  // glint on the ocean rather than a neutral white spot. Land stays untinted.
  vec3 specTint=mix(vec3(1.0),vec3(1.0,0.78,0.42),waterMask);
  vec3 specular=(D*G)*F/max(4.0*NdV*NdL,1e-3)*specTint;
  vec3 kS=F;
  vec3 kD=(vec3(1.0)-kS)*(1.0-metallic);
  // Pre-multiply sun radiance by PI so diffuse simplifies to kD*albedo*NdL.
  vec3 sunRadiance=vec3(PI);
  float shadow=shadowFactor(vWorld,L);
  // Cloud shadow uses the same noise + rotation as CLOUDS_FRAG so the
  // shadow lands directly under the rendered puff (gated by uCloudShadow,
  // which the renderer sets to visibility when clouds are on, 0 otherwise).
  float cloudShadowMul=cloudShadow(vLocal,L,uTime,uSeed,uReducedMotion,uCloudShadow);
  vec3 direct=(kD*albedo/PI+specular)*sunRadiance*NdL*shadow*cloudShadowMul;
  float ambientShadowMul=0.10+0.90*cloudShadowMul;
  vec3 ambient=albedo*0.004*ambientShadowMul;
  vec3 col=ambient+direct;
  // City lights on the night side of land masses (planet-feature gated).
  // Population proxy: low-freq continent fbm + coastline boost. Lights are
  // a sparse hash-grid: each cell rolls a hash; populated cells emit one
  // sub-cell point with twinkle. Mirrors planet.wgsl.
  if(uCityLights>0.5){
    // Hoist cell coordinate + screen-space footprint outside the per-fragment
    // gates. fwidth requires uniform control flow; only uCityLights is
    // uniform per draw — night/land/presence checks vary per fragment.
    float cityScale=40.0;
    vec3 cityCoord=vLocal*cityScale+vec3(uSeed*0.013,uSeed*0.011,uSeed*0.017);
    vec3 fw=fwidth(cityCoord);
    float footprint=max(fw.x,max(fw.y,fw.z));
    // LOD fade: smoothly fade out when one fragment spans a sizable fraction
    // of a cell (prevents sparkling/aliasing at distance or for small planets).
    float lodFade=1.0-smoothstep(0.35,0.9,footprint);
    float nightFactor=smoothstep(0.18,-0.05,NdL);
    float landFactor=(1.0-waterMask)*(1.0-iceMask);
    if(nightFactor>0.001 && landFactor>0.05 && lodFade>0.001){
      float popNoise=continentFbm(vLocal*2.2+vec3(uSeed*0.0019));
      float popMask=smoothstep(0.42,0.72,popNoise);
      float coastBoost=smoothstep(0.07,0.0,abs(oceanField-0.60));
      float pop=clamp(max(popMask,coastBoost*0.75),0.0,1.0);
      // Two-layer placement: low-freq zone mask carves out a few clusters,
      // medium-freq hash grid plants individual lights inside those zones.
      // Squared falloff on the zone mask tightens cluster cores so lights
      // pool together instead of fading across the surrounding land.
      float zoneNoise=vnoise(vLocal*4.5+vec3(uSeed*0.0021,uSeed*0.0017,uSeed*0.0033));
      float zoneMask=smoothstep(0.66,0.80,zoneNoise);
      float cityPresence=zoneMask*zoneMask*(0.40+0.60*pop);
      if(cityPresence>0.01){
        vec3 cellId=floor(cityCoord);
        vec3 sub=fract(cityCoord);
        float threshold=mix(0.92,0.62,cityPresence);
        // Sample 3x3x3 neighborhood so lights near cell walls don't get
        // sliced off at the boundary (fixes the visible rectangular clips).
        float glowRadius=0.30;
        float bestGlow=0.0;
        for(int dx=-1;dx<=1;dx++){
          for(int dy=-1;dy<=1;dy++){
            for(int dz=-1;dz<=1;dz++){
              vec3 off=vec3(float(dx),float(dy),float(dz));
              float nh=hash3(cellId+off);
              if(nh>=threshold){
                vec3 dotPos=vec3(fract(nh*1.7),fract(nh*7.3),fract(nh*13.1));
                float dd=length(sub-(off+dotPos));
                bestGlow=max(bestGlow,smoothstep(glowRadius,0.0,dd));
              }
            }
          }
        }
        float cloudMask=mix(1.0,cloudShadowMul,0.7);
        float intensity=bestGlow*nightFactor*landFactor*cloudMask*lodFade;
        vec3 cityColor=vec3(1.0,0.72,0.32);
        col+=cityColor*intensity*4.0;
      }
    }
  }
  col+=uHigh*rim*NdL*0.55*shadow;
  col*=(0.85+0.3*uFocus);
  col=mix(col,FOG_COLOR,fogFactor(vWorld,uCamera));
  frag=vec4(aces(col),1.0);
}`;

const POINT_VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aAttr; // x size, y phase/dim, z digit (Arabic numeral, POIs only), w unused
layout(location=2) in vec3 aColor;
uniform mat4 uViewProj;
uniform float uTime;
uniform float uMode; // 0 star, 1 poi
uniform float uHeight; // viewport height in pixels (POI fixed-screen sizing)
out vec4 vAttr;
out vec3 vColor;
out float vDigit;
void main(){
  vec4 clip=uViewProj*vec4(aPos,1.0);
  gl_Position=clip;
  float twinkle=(uMode<0.5)?(0.6+0.4*sin(uTime*2.0+aAttr.y*6.28)):1.0;
  // Stars shrink with distance (aAttr.x is a pixel*depth factor); POI markers
  // are a fixed fraction of the viewport height like the WebGPU billboards
  // (aAttr.x is the NDC half-extent, so diameter = aAttr.x * viewport height),
  // independent of camera distance.
  float ps=(uMode<0.5)?(aAttr.x/max(clip.w,0.001)):(aAttr.x*uHeight);
  gl_PointSize=clamp(ps,1.0,256.0);
  vAttr=vec4(twinkle,aAttr.y,uMode,aAttr.x);
  vColor=aColor;
  vDigit=aAttr.z;
}`;

const POINT_FRAG = `#version 300 es
precision highp float;
in vec4 vAttr;in vec3 vColor;in float vDigit;
uniform float uWireframe;
out vec4 frag;
// Arabic numerals 0..9 rendered as a seven-segment union of line-segment SDFs
// in a normalized glyph-local box [-1,1]x[-1,1]. Each digit lights a subset of
// the seven segments; the fragment unions them by min-distance and masks the
// pixel by smoothstep of distance vs. stroke half-width, so digits render
// crisply without bitmap rasterization artifacts.
float segDist(vec2 p,vec2 a,vec2 b){
  vec2 pa=p-a;vec2 ba=b-a;
  float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.0,1.0);
  return length(pa-ba*h);
}
float digitDist(vec2 p,int d){
  // Seven-segment layout corners. x/y inset from the glyph box edges.
  float x=0.55;float y=0.9;
  vec2 tl=vec2(-x,y);vec2 tr=vec2(x,y);
  vec2 ml=vec2(-x,0.0);vec2 mr=vec2(x,0.0);
  vec2 bl=vec2(-x,-y);vec2 br=vec2(x,-y);
  // "1" reads better as a single centered stem than as a right-aligned pair.
  if(d==1){
    return segDist(p,vec2(0.0,y),vec2(0.0,-y));
  }
  float dm=1e9;
  // a (top)
  if(d==0||d==2||d==3||d==5||d==6||d==7||d==8||d==9){dm=min(dm,segDist(p,tl,tr));}
  // f (upper-left)
  if(d==0||d==4||d==5||d==6||d==8||d==9){dm=min(dm,segDist(p,tl,ml));}
  // b (upper-right)
  if(d==0||d==2||d==3||d==4||d==7||d==8||d==9){dm=min(dm,segDist(p,tr,mr));}
  // g (middle)
  if(d==2||d==3||d==4||d==5||d==6||d==8||d==9){dm=min(dm,segDist(p,ml,mr));}
  // e (lower-left)
  if(d==0||d==2||d==6||d==8){dm=min(dm,segDist(p,ml,bl));}
  // c (lower-right)
  if(d==0||d==3||d==4||d==5||d==6||d==7||d==8||d==9){dm=min(dm,segDist(p,mr,br));}
  // d (bottom)
  if(d==0||d==2||d==3||d==5||d==6||d==8||d==9){dm=min(dm,segDist(p,bl,br));}
  return dm;
}
void main(){
  vec2 uv=gl_PointCoord*2.0-1.0;
  float d=length(uv);
  if(vAttr.z>0.5){
    if(uWireframe>0.5){
      // Wireframe debug: render the underlying billboard quad as cyan
      // edges plus the diagonal that splits its two triangles (matches
      // WebGPU: shared edge runs (1,-1) -> (-1,1), i.e. uv.x+uv.y=0).
      float edgeDist=min(1.0-abs(uv.x),1.0-abs(uv.y));
      float diagDist=abs(uv.x+uv.y)*0.70710678;
      float lineDist=min(edgeDist,diagDist);
      float aaLine=length(vec2(dFdx(lineDist),dFdy(lineDist)));
      float a=(1.0-smoothstep(0.0,1.5*aaLine,lineDist))*vAttr.y;
      frag=vec4(vec3(0.25,1.0,0.85)*a,a);
      return;
    }
    float radius=0.85;
    // Isotropic AA: use the L2 norm of (dFdx, dFdy) instead of fwidth()
    // (which is L1 and gives a slightly wider band at the diagonals,
    // making the ring read as bulgier at corners than at cardinals).
    float aa=length(vec2(dFdx(d),dFdy(d)));
    // Thin ring: AA-only smoothstep from peak (d=radius) out to 1.5*aa.
    // No solid core so the line reads ~1.5px wide regardless of marker
    // size.
    float outline=(1.0-smoothstep(0.0,1.5*aa,abs(d-radius)))*vAttr.y;
    // Map marker uv into a normalized glyph-local box [-1,1]x[-1,1]. halfW/halfH
    // size the digit so it sits comfortably inside the ring at radius 0.85.
    // gl_PointCoord origin is upper-left, so we flip Y here to match the
    // glyph-local convention where +y = top.
    float halfW=0.28;float halfH=0.30;
    vec2 gp=vec2(uv.x/halfW,-uv.y/halfH);
    int dig=int(vDigit+0.5);
    float glyphDist=digitDist(gp,dig);
    // One screen pixel in glyph-local units (isotropic AA).
    vec2 dgx=dFdx(gp);vec2 dgy=dFdy(gp);
    float aaG=sqrt(dot(dgx,dgx)+dot(dgy,dgy))*0.5;
    float strokeW=0.16;
    float glyphAlpha=(1.0-smoothstep(strokeW-aaG,strokeW+aaG,glyphDist))*vAttr.y;
    float a=max(outline,glyphAlpha);
    // UI accent orange (--accent: #ff7a18) so markers match the interface.
    frag=vec4(vec3(1.0,0.478,0.094)*a,a);
  }else{
    if(uWireframe>0.5){
      // Wireframe debug: render the billboard quad as cyan edges + diagonal,
      // matching the planet wireframe style instead of a glowing point.
      float edgeDist=min(1.0-abs(uv.x),1.0-abs(uv.y));
      float diagDist=abs(uv.x+uv.y)*0.70710678;
      float lineDist=min(edgeDist,diagDist);
      float aaLine=length(vec2(dFdx(lineDist),dFdy(lineDist)));
      float a=1.0-smoothstep(0.0,1.5*aaLine,lineDist);
      frag=vec4(vec3(0.25,1.0,0.85)*a,a);
      return;
    }
    float core=pow(smoothstep(1.0,0.0,d),4.0)*vAttr.x;
    vec3 baseCol=mix(vec3(0.7,0.8,1.0),vColor,0.5);
    frag=vec4(baseCol*core*1.6,core);
  }
}`;

// Thick connector "lines" from planet surface to floating POI markers, drawn as
// camera-facing quads (GL line width is effectively 1px on most drivers). Built
// in aspect-corrected NDC for constant on-screen thickness, with screen-space
// derivative AA across the width. The outer end stops at the marker circle rim.
const LINE_VERT = `#version 300 es
layout(location=0) in vec3 aInner;
layout(location=1) in vec3 aOuter;
layout(location=2) in vec3 aParam; // x=side(-1/1) y=end(0 inner / 1 outer) z=pointSizePx
layout(location=3) in vec4 aColor;
uniform mat4 uViewProj;
uniform float uAspect;
uniform float uThick;  // half-thickness in aspect-corrected NDC
uniform float uHeight; // viewport height in pixels
out vec4 vColor;
out float vEdge;
out float vAxial;
void main(){
  vec2 ac=vec2(uAspect,1.0);
  vec4 ci=uViewProj*vec4(aInner,1.0);
  vec4 co=uViewProj*vec4(aOuter,1.0);
  vec2 ai=(ci.xy/ci.w)*ac;
  vec2 ao=(co.xy/co.w)*ac;
  vec2 dir=ao-ai;
  float len=length(dir);
  dir=len>1e-6?dir/len:vec2(0.0,1.0);
  vec2 perp=vec2(-dir.y,dir.x);
  // Marker point size matches the POINT shader's fixed-screen sizing (aParam.z
  // is the NDC half-extent); the rim sits at uv 0.85 so pull the connector end
  // back to it.
  float pointPx=clamp(aParam.z*uHeight,1.0,256.0);
  float circleR=0.85*pointPx/uHeight;
  ao=ao-dir*circleR;
  bool isOuter=aParam.y>0.5;
  vec2 chosen=isOuter?ao:ai;
  float z=isOuter?co.z:ci.z;
  float w=isOuter?co.w:ci.w;
  vec2 p=chosen+perp*aParam.x*uThick;
  vec2 ndc=vec2(p.x/uAspect,p.y);
  gl_Position=vec4(ndc*w,z,w);
  vColor=aColor;
  vEdge=aParam.x;
  vAxial=aParam.y;
}`;

const LINE_FRAG = `#version 300 es
precision highp float;
in vec4 vColor;
in float vEdge;
in float vAxial;
uniform float uWireframe;
out vec4 frag;
void main(){
  if(uWireframe>0.5){
    // Wireframe debug: 4 quad edges + diagonal (axial = 0.5*(edge+1)).
    float edgeD=1.0-abs(vEdge);
    float axialD=min(vAxial,1.0-vAxial);
    float diagD=abs(vAxial-0.5*(vEdge+1.0));
    float aaE=fwidth(edgeD);
    float aaA=fwidth(axialD);
    float aaD=fwidth(diagD);
    float covE=1.0-smoothstep(0.0,1.5*aaE,edgeD);
    float covA=1.0-smoothstep(0.0,1.5*aaA,axialD);
    float covD=1.0-smoothstep(0.0,1.5*aaD,diagD);
    float a=max(covE,max(covA,covD));
    frag=vec4(vec3(0.25,1.0,0.85)*a,a);
    return;
  }
  float aa=fwidth(vEdge);
  float cov=1.0-smoothstep(1.0-aa,1.0,abs(vEdge));
  float a=vColor.a*cov;
  // UI accent orange (--accent: #ff7a18) so connectors match the interface.
  vec3 base=vec3(1.0,0.478,0.094)+0.15;
  frag=vec4(base*a,a);
}`;

// Spacecraft trajectory ribbon. Camera-facing quad per polyline segment,
// instanced via prev/next world positions. Mirrors flight_path.wgsl.
const FLIGHT_VERT = `#version 300 es
layout(location=0) in vec3 aPrev;
layout(location=1) in vec3 aNext;
layout(location=2) in float aKind; // 0 = ribbon segment, 1 = arrowhead
layout(location=3) in float aArcPrev; // normalized arc length at prev
layout(location=4) in float aArcNext; // normalized arc length at next
uniform mat4 uViewProj;
uniform float uAspect;
uniform float uThick; // half-thickness in aspect-corrected NDC
out float vEdge;
out vec3 vWorld;
out float vAxial;
out float vShape; // 0 = ribbon, 1 = arrowhead
out float vArc; // normalized 0..1 distance along the whole path
const float ARROW_LEN = 0.024;
const float ARROW_HALF = 0.013;
void main(){
  int vid = gl_VertexID;
  vec2 ac = vec2(uAspect, 1.0);
  vec4 cp = uViewProj * vec4(aPrev, 1.0);
  vec4 cn = uViewProj * vec4(aNext, 1.0);
  vec2 ap = (cp.xy / cp.w) * ac;
  vec2 an = (cn.xy / cn.w) * ac;
  vec2 dir = an - ap;
  float len = length(dir);
  dir = len > 1e-6 ? dir / len : vec2(0.0, 1.0);
  vec2 perp = vec2(-dir.y, dir.x);
  if(aKind > 0.5){
    // Camera-facing triangle at the path start, pointing opposite travel direction.
    vec2 aoff[6] = vec2[6](
      -dir * ARROW_LEN, -perp * ARROW_HALF, perp * ARROW_HALF,
      -dir * ARROW_LEN, -dir * ARROW_LEN, -dir * ARROW_LEN);
    vec2 pa = ap + aoff[vid];
    vec2 ndcA = vec2(pa.x / uAspect, pa.y);
    gl_Position = vec4(ndcA * cp.w, cp.z, cp.w);
    vEdge = 0.0;
    vWorld = aPrev;
    vAxial = 1.0;
    vShape = 1.0;
    vArc = aArcPrev;
    return;
  }
  const float ends[6]  = float[6](0.0, 1.0, 1.0, 0.0, 1.0, 0.0);
  const float sides[6] = float[6](-1.0, -1.0, 1.0, -1.0, 1.0, 1.0);
  bool isEnd = ends[vid] > 0.5;
  float side = sides[vid];
  vec2 chosen = isEnd ? an : ap;
  float z = isEnd ? cn.z : cp.z;
  float w = isEnd ? cn.w : cp.w;
  vec2 p = chosen + perp * side * uThick;
  vec2 ndc = vec2(p.x / uAspect, p.y);
  gl_Position = vec4(ndc * w, z, w);
  vEdge = side;
  vWorld = isEnd ? aNext : aPrev;
  vAxial = ends[vid];
  vShape = 0.0;
  vArc = isEnd ? aArcNext : aArcPrev;
}`;

const FLIGHT_FRAG = `#version 300 es
precision highp float;
in float vEdge;
in vec3 vWorld;
in float vAxial;
in float vShape;
in float vArc;
uniform vec3 uCamera;
uniform float uWireframe;
uniform float uTime;
uniform float uReducedMotion;
out vec4 frag;
const float FOG_DENSITY=0.018;
// Traveling light pulse: half-length in normalized arc length, loops/second.
const float PULSE_LEN=0.012;
const float PULSE_SPEED=0.09;
void main(){
  if(uWireframe>0.5){
    // Wireframe debug: 4 quad edges + diagonal of each segment.
    float edgeD=1.0-abs(vEdge);
    float axialD=min(vAxial,1.0-vAxial);
    float diagD=abs(vAxial-0.5*(vEdge+1.0));
    float aaE=fwidth(edgeD);
    float aaA=fwidth(axialD);
    float aaD=fwidth(diagD);
    float covE=1.0-smoothstep(0.0,1.5*aaE,edgeD);
    float covA=1.0-smoothstep(0.0,1.5*aaA,axialD);
    float covD=1.0-smoothstep(0.0,1.5*aaD,diagD);
    float ribbonCov=max(covE,max(covA,covD));
    float a = vShape>0.5 ? 1.0 : ribbonCov;
    frag=vec4(vec3(0.25,1.0,0.85)*a,a);
    return;
  }
  float aa=fwidth(vEdge);
  float cov=1.0-smoothstep(1.0-aa,1.0,abs(vEdge));
  float d=distance(vWorld,uCamera);
  float s=d*FOG_DENSITY;
  float fogA=exp(-s*s);
  // Ribbon fades with edge AA; the arrowhead fills solid.
  float a = vShape>0.5 ? 0.95*fogA : 0.85*cov*fogA;
  // Traveling pulse sweeping end -> start; frozen for reduced motion.
  float head = uReducedMotion>0.5 ? 1.0 : 1.0-fract(uTime*PULSE_SPEED);
  float pulse = 1.0-smoothstep(0.0,PULSE_LEN,abs(vArc-head));
  float glow = vShape>0.5 ? 0.0 : pulse*fogA;
  vec3 rgb = vec3(0.75)*a + vec3(1.0,0.95,0.85)*glow*1.6;
  frag=vec4(rgb,min(1.0,a+glow*0.8));
}`;

const WIRE_FRAG = `#version 300 es
precision highp float;
out vec4 frag;
void main(){ frag=vec4(0.25,1.0,0.85,1.0); }`;

// Final present pass: samples the resolved scene texture and applies the sRGB
// OETF (gamma ~2.2). The scene is rendered/tonemapped in linear space into an
// offscreen buffer; without this encode the canvas displays linear values as
// if sRGB, which looks much too dark. Mirrors the tail of composite.wgsl.
// Planetary ring: a flat annulus mesh oriented by uModel. Ported from
// ring.wgsl. Curved bands (angular sin modulation) + layered fBm + Cassini
// gaps; palette zones, planet-shadow dimming, forward-scatter, Kajiya-Kay
// anisotropic specular and distance fog. fwidth-based local AA band-limits the
// high-frequency bands/gaps/edges. Needs the ring VAO's uv attribute.
const RING_VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=2) in vec2 aUv;
uniform mat4 uViewProj;
uniform mat4 uModel;
out float vRadial;
out float vAngle;
out vec3 vWorld;
void main(){
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vRadial = aUv.x;
  vAngle = aUv.y * 6.2831853;
  gl_Position = uViewProj * world;
}`;
const RING_FRAG = `#version 300 es
precision highp float;
in float vRadial;
in float vAngle;
in vec3 vWorld;
out vec4 frag;
uniform mat4 uModel;
uniform vec3 uCamera;uniform vec3 uLight;
uniform float uTime;uniform float uSeed;uniform float uThin;uniform float uFocus;
uniform vec3 uLow;uniform vec3 uMid;uniform vec3 uHigh;
uniform int uShadowCount;uniform vec4 uShadowSpheres[8];
float hash2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise2(vec2 p){
  vec2 i=floor(p);vec2 f=fract(p);vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash2(i),hash2(i+vec2(1.0,0.0)),u.x),
             mix(hash2(i+vec2(0.0,1.0)),hash2(i+vec2(1.0,1.0)),u.x),u.y);
}
float fbm2(vec2 p){
  float v=0.0;float a=0.5;vec2 q=p;
  for(int i=0;i<4;i++){v+=a*vnoise2(q);q*=2.03;a*=0.5;}
  return v;
}
float shadowFactor(vec3 p,vec3 L){
  float s=1.0;
  for(int i=0;i<8;i++){
    if(i>=uShadowCount)break;
    vec4 sph=uShadowSpheres[i];
    vec3 d=sph.xyz-p;
    float t=dot(d,L);
    if(t<=0.0)continue;
    float c2=dot(d,d)-t*t;
    float R=sph.w;float R2=R*R;
    s*=smoothstep(R2,R2*1.10,c2);
  }
  return s;
}
float aaStep(float e0,float e1,float x,float w){
  if(e0<=e1)return smoothstep(e0-w,e1+w,x);
  return 1.0-smoothstep(e1-w,e0+w,x);
}
void main(){
  float radial=vRadial;
  float angle=vAngle;
  float time=uTime;
  float seed=uSeed;
  float h1=fract(sin(seed*0.937+1.0)*43758.5);
  float h2=fract(sin(seed*0.357+2.5)*21758.3);
  float h3=fract(sin(seed*0.713+5.7)*7853.7);
  float h4=fract(sin(seed*0.521+8.2)*51247.7);
  float bandFreqBroad=120.0+h1*120.0;
  float gap1Freq=5.0+h2*9.0;
  float gap2Freq=12.0+h3*11.0;
  float gap2Phase=h4*6.2831853;
  float innerBroad=0.02+h2*0.18;
  float outerBroad=0.82+h3*0.12;
  float isThin=uThin;
  float bandFreq=mix(bandFreqBroad,115.0,isThin);
  float innerStart=mix(innerBroad,0.62,isThin);
  float outerEnd=mix(outerBroad,0.72,isThin);
  float outerFadeStart=mix(1.0,outerEnd+0.06,isThin);
  float rw=fwidth(radial);
  float edge=aaStep(innerStart,innerStart+0.06,radial,rw)*
             aaStep(outerFadeStart,outerEnd,radial,rw);
  // Saturn macro structure: faint C ring, dense B ring, near-empty Cassini
  // Division, medium A ring with the narrow Encke gap. Mirror of ring.wgsl.
  float span=max(outerEnd-innerStart,1e-3);
  float t=clamp((radial-innerStart)/span,0.0,1.0);
  float tw=rw/span;
  float cEnd=0.24+h1*0.06;
  float bEnd=0.54+h2*0.05;
  float divEnd=bEnd+0.05+h3*0.03;
  float aEnd=0.96;
  float st=0.30;
  st=mix(st,1.00,aaStep(cEnd,cEnd+0.03,t,tw));
  st=mix(st,0.08,aaStep(bEnd,bEnd+0.012,t,tw));
  st=mix(st,0.72,aaStep(divEnd,divEnd+0.012,t,tw));
  st=mix(st,0.00,aaStep(aEnd,aEnd+0.02,t,tw));
  float encke=divEnd+(aEnd-divEnd)*(0.68+h4*0.10);
  float enckeSlot=clamp(aaStep(encke-0.012,encke-0.004,t,tw)-aaStep(encke+0.004,encke+0.012,t,tw),0.0,1.0);
  st*=1.0-0.85*enckeSlot;
  float structure=mix(st,1.0,isThin);
  float broadBands=0.5+0.5*cos(radial*bandFreq-0.25*sin(angle*7.0+time*0.03));
  // Fine Saturn-style sub-striations carved into the broad bands; faded out for
  // thin rings. Mirror of ring.wgsl.
  float fineBands=0.5+0.5*cos(radial*bandFreq*2.6+0.10*sin(angle*11.0));
  // Frequency-aware contrast attenuation (analytic AA): fade each band set to
  // its mean as its on-screen rate (freq/(2pi)*fwidth) approaches the Nyquist
  // limit so undersampled rings stop shimmering / moiré. Mirror of ring.wgsl.
  float invTwoPi=0.15915494;
  float broadAtt=1.0-smoothstep(0.20,0.45,bandFreq*rw*invTwoPi);
  float fineAtt=1.0-smoothstep(0.20,0.45,bandFreq*2.6*rw*invTwoPi);
  // Bias the faded far-field mean above 0.5 so attenuated rings stay solid
  // rather than washing out to half-translucent (mix to a constant adds no
  // frequency, so no aliasing returns). Mirror of ring.wgsl.
  float bandFar=0.8;
  float broadF=mix(bandFar,broadBands,broadAtt);
  float fineF=mix(bandFar,fineBands,fineAtt);
  float fineAmt=0.45*(1.0-isThin);
  float bands=broadF*(1.0-fineAmt+fineAmt*fineF);
  vec2 np=vec2(radial*22.0,angle*3.2);
  float n=fbm2(np)*0.65+fbm2(np*2.7+vec2(11.0,5.0))*0.35;
  float dv=bands*0.85+n*0.35;
  float density=aaStep(0.20,0.85,dv,fwidth(dv));
  float s1=0.5+0.5*sin(radial*gap1Freq+h2*6.28);
  float s2=0.5+0.5*sin(radial*gap2Freq+gap2Phase);
  float g1=aaStep(0.88,0.95,s1,fwidth(s1));
  float g2=aaStep(0.92,0.97,s2,fwidth(s2));
  float gap=clamp(g1+g2*0.7,0.0,1.0);
  float opaq=max(0.0,density-gap*0.85);
  float a=edge*structure*(0.18+0.55*opaq)*(0.5+0.5*uFocus);
  vec2 ang2=vec2(cos(angle),sin(angle));
  float zoneR=fbm2(vec2(radial*4.5,1.7+h1*6.28));
  float zoneA=fbm2(ang2*1.7+vec2(h4*5.0,radial*2.1));
  float palT=clamp(zoneR*1.05+zoneA*0.18-0.10,0.0,1.0);
  vec3 pal01=mix(uLow,uMid,smoothstep(0.0,0.55,palT));
  vec3 paletteCol=mix(pal01,uHigh,smoothstep(0.50,1.0,palT));
  float densityWarm=smoothstep(0.55,0.92,density);
  vec3 zonedCol=mix(paletteCol,uHigh,densityWarm*0.30);
  float chroma=vnoise2(ang2*7.3+vec2(radial*9.0,h2*5.0));
  vec3 chromaCol=mix(uLow,uHigh,chroma);
  vec3 variedCol=mix(zonedCol,chromaCol,0.07);
  vec2 grainP=vec2(radial*22.0,0.0)+ang2*8.5;
  float grain=vnoise2(grainP+vec2(33.0,17.0));
  float grainBright=0.85+0.30*(grain-0.5);
  float densityShade=mix(0.70,1.05,smoothstep(0.20,0.85,density));
  float structShade=0.72+0.38*structure;
  vec3 baseCol=variedCol*densityShade*structShade*grainBright;
  vec3 L=normalize(uLight);
  float shadow=shadowFactor(vWorld,L);
  vec3 V=normalize(uCamera-vWorld);
  float fwd=pow(max(dot(V,-L),0.0),3.0)*shadow;
  vec3 scatterTint=mix(uMid,uHigh,0.75);
  float scatterBoost=1.0+fwd*3.2;
  vec3 scatterCol=mix(vec3(1.0),scatterTint*1.7,fwd);
  vec3 col0=baseCol*mix(0.0,1.0,shadow)*scatterBoost*scatterCol;
  float cosA=cos(angle);
  float sinA=sin(angle);
  vec3 T=normalize((uModel*vec4(-sinA,0.0,cosA,0.0)).xyz);
  vec3 HV=L+V;
  float Hlen=max(length(HV),1e-4);
  vec3 H=HV/Hlen;
  float TdotH=dot(T,H);
  float sinTH=sqrt(max(0.0,1.0-TdotH*TdotH));
  float anisoBroad=pow(sinTH,18.0);
  float anisoTight=pow(sinTH,72.0);
  float aniso=anisoBroad*0.40+anisoTight*0.95;
  float anisoMask=(0.25+0.75*smoothstep(0.25,0.85,density))
                *(0.55+0.45*smoothstep(0.30,0.95,grain))
                *shadow;
  vec3 anisoCol=mix(uHigh,vec3(1.0),0.60)*1.35;
  vec3 col=col0+anisoCol*aniso*anisoMask;
  float alphaGain=1.0+fwd*(0.45+1.40*(1.0-smoothstep(0.45,0.92,density)));
  float aFinal=a*alphaGain;
  float dCam=distance(vWorld,uCamera);
  float sf=dCam*0.030;
  float fade=exp(-sf*sf);
  frag=vec4(col*aFinal*1.4*fade,aFinal*fade);
}`;
const PRESENT_VERT = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2((gl_VertexID == 2) ? 3.0 : -1.0, (gl_VertexID == 1) ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;
const PRESENT_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform vec3 uFlare;   // xy = sun screen uv, z = strength
uniform float uAspect; // width / height
uniform float uBarrel; // CRT lens curvature, 0 = flat
out vec4 frag;
// Deep-space lens flare (mu6k 4sX3Rs): chromatic ghost discs through screen
// centre and reflection halos. uv/pos centred + aspect.
vec3 lensflare(vec2 uv, vec2 pos){
  vec2 uvd=uv*length(uv);
  float f2=max(1.0/(1.0+32.0*pow(length(uvd+0.8*pos),2.0)),0.0)*0.25;
  float f22=max(1.0/(1.0+32.0*pow(length(uvd+0.85*pos),2.0)),0.0)*0.23;
  float f23=max(1.0/(1.0+32.0*pow(length(uvd+0.9*pos),2.0)),0.0)*0.21;
  vec2 uvx=mix(uv,uvd,-0.5);
  float f4=max(0.01-pow(length(uvx+0.4*pos),2.4),0.0)*6.0;
  float f42=max(0.01-pow(length(uvx+0.45*pos),2.4),0.0)*5.0;
  float f43=max(0.01-pow(length(uvx+0.5*pos),2.4),0.0)*3.0;
  uvx=mix(uv,uvd,-0.4);
  float f5=max(0.01-pow(length(uvx+0.2*pos),5.5),0.0)*2.0;
  float f52=max(0.01-pow(length(uvx+0.4*pos),5.5),0.0)*2.0;
  float f53=max(0.01-pow(length(uvx+0.6*pos),5.5),0.0)*2.0;
  uvx=mix(uv,uvd,-0.5);
  float f6=max(0.01-pow(length(uvx-0.3*pos),1.6),0.0)*6.0;
  float f62=max(0.01-pow(length(uvx-0.325*pos),1.6),0.0)*3.0;
  float f63=max(0.01-pow(length(uvx-0.35*pos),1.6),0.0)*5.0;
  vec3 c=vec3(0.0);
  c.r+=f2+f4+f5+f6;
  c.g+=f22+f42+f52+f62;
  c.b+=f23+f43+f53+f63;
  c=c*1.3-vec3(length(uvd)*0.05);
  return max(c,vec3(0.0));
}
vec3 sunFlare(vec2 uv){
  if(uFlare.z<=0.001) return vec3(0.0);
  vec2 cuv=(uv-0.5)*vec2(uAspect,1.0)*1.6;
  vec2 cpos=(uFlare.xy-0.5)*vec2(uAspect,1.0)*1.6;
  vec3 lf=lensflare(cuv,cpos)*vec3(1.4,1.2,1.0);
  return lf*uFlare.z*0.5;
}
// Crepuscular rays (GPU Gems 3 ch.13): radial march toward the sun, summing the
// bright part of the scene with exponential decay so planets carve ray gaps.
vec3 godRays(vec2 uv){
  if(uFlare.z<=0.001) return vec3(0.0);
  const int NUM=48;
  float density=0.6;
  float decay=0.96;
  float exposure=0.016;
  vec2 delta=(uv-uFlare.xy)*(density/float(NUM));
  vec2 coord=uv;
  float illum=1.0;
  float acc=0.0;
  for(int i=0;i<NUM;i++){
    coord-=delta;
    float lum=dot(texture(uScene,clamp(coord,0.001,0.999)).rgb,vec3(0.2126,0.7152,0.0722));
    float m=clamp((lum-0.85)*3.0,0.0,1.0);
    acc+=m*illum;
    illum*=decay;
  }
  return vec3(acc)*(exposure*uFlare.z)*vec3(1.0,0.92,0.78);
}
// CRT lens curvature: bow the sample coordinates outward with r^2, then divide
// by the corner factor (r^2 = 0.5) so the corners still land exactly on the
// frame edge and the warped image keeps filling the canvas.
vec2 barrel(vec2 uv){
  if(uBarrel<=0.0001) return uv;
  vec2 c=uv-0.5;
  float r2=dot(c,c);
  return 0.5 + c*((1.0+uBarrel*r2)/(1.0+uBarrel*0.5));
}
void main(){
  vec2 uv = barrel(vUv);
  vec3 c = texture(uScene, uv).rgb;
  c += sunFlare(uv);
  c += godRays(uv);
  frag = vec4(pow(c, vec3(1.0/2.2)), 1.0);
}`;

// Atmospheric scattering shell: marches the view ray through a sphere slightly
// larger than the planet, accumulating altitude-weighted, sun-lit density for a
// soft blue limb glow. Reuses PLANET_VERT (only uModel/uViewProj attributes).
const ATMOSPHERE_FRAG = `#version 300 es
precision highp float;
in vec3 vWorld;
out vec4 frag;
uniform vec3 uCamera;uniform vec3 uLight;
uniform vec3 uColor;uniform vec3 uCenter;
uniform float uInner;uniform float uOuter;uniform float uFocus;uniform float uIntensity;
uniform int uShadowCount;uniform vec4 uShadowSpheres[8];
vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
vec2 raySphere(vec3 ro,vec3 rd,vec3 ce,float ra){
  vec3 oc=ro-ce;float b=dot(oc,rd);float c=dot(oc,oc)-ra*ra;float h=b*b-c;
  if(h<0.0)return vec2(1.0,-1.0);
  float s=sqrt(h);return vec2(-b-s,-b+s);
}
// Analytic shadow with self-exclude (parent planet's own sphere is skipped so
// per-sample sunAmt isn't double-darkened). 1.0 unshadowed, 0.0 fully shadowed.
float shadowFactor(vec3 p,vec3 L,vec3 exclude){
  float s=1.0;
  for(int i=0;i<8;i++){
    if(i>=uShadowCount)break;
    vec4 sph=uShadowSpheres[i];
    if(distance(sph.xyz,exclude)<1e-3)continue;
    vec3 d=sph.xyz-p;
    float t=dot(d,L);
    if(t<=0.0)continue;
    float c2=dot(d,d)-t*t;
    float R=sph.w;float R2=R*R;
    s*=smoothstep(R2,R2*1.10,c2);
  }
  return s;
}
void main(){
  vec3 ro=uCamera;vec3 rd=normalize(vWorld-ro);vec3 sun=normalize(uLight);
  vec2 outer=raySphere(ro,rd,uCenter,uOuter);
  if(outer.y<=outer.x){frag=vec4(0.0);return;}
  float tNear=max(outer.x,0.0);float tFar=outer.y;
  vec2 inner=raySphere(ro,rd,uCenter,uInner);
  if(inner.x>0.0&&inner.x<inner.y)tFar=min(tFar,inner.x);
  if(tFar<=tNear){frag=vec4(0.0);return;}
  float thickness=max(uOuter-uInner,1e-4);
  const int STEPS=10;
  float dt=(tFar-tNear)/float(STEPS);
  float dayGlow=0.0;float ambient=0.0;
  for(int i=0;i<STEPS;i++){
    float t=tNear+(float(i)+0.5)*dt;
    vec3 pos=ro+rd*t;vec3 up=pos-uCenter;float r=length(up);
    float hgt=clamp((r-uInner)/thickness,0.0,1.0);
    float density=exp(-hgt*4.0);
    // Sun gate starts past the terminator so night-side samples contribute 0.
    float sunAmt=smoothstep(0.05,0.40,dot(normalize(up),sun));
    float shadow=shadowFactor(pos,sun,uCenter);
    dayGlow+=density*sunAmt*shadow*dt;ambient+=density*dt;
  }
  dayGlow/=thickness;ambient/=thickness;
  vec3 atmoColor=mix(uColor,vec3(0.45,0.62,1.0),0.5);
  float intensity=uIntensity*(0.85+0.3*uFocus);
  // Limb-sun gate (cubed) zeroes shell on night-side limb rays.
  float tLimb=max(0.0,-dot(ro-uCenter,rd));
  vec3 limbPos=ro+rd*tLimb;
  vec3 limbNormal=normalize(limbPos-uCenter);
  float limbSunRaw=smoothstep(0.10,0.40,dot(limbNormal,sun));
  float limbSun=limbSunRaw*limbSunRaw*limbSunRaw;
  vec3 col=atmoColor*dayGlow*0.55*intensity;
  float mie=pow(max(dot(rd,sun),0.0),8.0)*dayGlow*0.22;
  col+=atmoColor*mie*intensity;
  // Surface-aware limb gate: only apply limbSun to limb (miss) rays. Over
  // the planet's disk, per-sample sunAmt already smooths the terminator;
  // double-gating with cubed limbSun paints a sharp angular cut. Soft-blend
  // by chord length so the silhouette ring stays continuous.
  bool hitsPlanet=inner.x>0.0&&inner.x<inner.y;
  float innerSpan=max(inner.y-inner.x,0.0);
  float surfaceBlend=smoothstep(0.0,thickness*0.25,innerSpan);
  float limbBlend=hitsPlanet?surfaceBlend:0.0;
  float surfaceGate=mix(limbSun,1.0,limbBlend);
  col*=surfaceGate;
  // Distance fog (additive shell -> attenuate).
  float dist=distance(vWorld,ro);float fs=dist*0.030;
  col*=exp(-fs*fs);
  frag=vec4(aces(col),1.0);
}`;

// Cloud shell (alpha-blended, drawn between the planet surface and the
// additive atmosphere). Mirrors clouds.wgsl. Uses PLANET_VERT to get vLocal,
// vWorld, vNrm. The cloud noise + rotation MUST match the planet shader's
// cloudShadow so the projected shadow lines up with the rendered puff.
const CLOUDS_FRAG = `#version 300 es
precision highp float;
in vec3 vNrm;in vec3 vLocal;in vec3 vWorld;
out vec4 frag;
uniform vec3 uCamera;uniform vec3 uLight;
uniform vec3 uTint;uniform vec3 uCenter;
uniform mat4 uModel;
uniform float uTime;uniform float uSeed;uniform float uVisibility;
uniform float uReducedMotion;
uniform int uShadowCount;uniform vec4 uShadowSpheres[8];
float cHash3(vec3 p){vec3 q=fract(p*0.3183099+vec3(0.1,0.2,0.3));q*=17.0;return fract(q.x*q.y*q.z*(q.x+q.y+q.z));}
float cVnoise(vec3 x){
  vec3 i=floor(x),f=fract(x);vec3 u=f*f*(3.0-2.0*f);
  float n000=cHash3(i),n100=cHash3(i+vec3(1,0,0)),n010=cHash3(i+vec3(0,1,0)),n110=cHash3(i+vec3(1,1,0));
  float n001=cHash3(i+vec3(0,0,1)),n101=cHash3(i+vec3(1,0,1)),n011=cHash3(i+vec3(0,1,1)),n111=cHash3(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z);
}
float cFbm(vec3 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*cVnoise(p);p*=2.03;a*=.5;}return v;}
float cloudRotation(float time,float seedf,float reducedMotion){
  float baseSpeed=0.015;
  float jitter=fract(seedf*0.000371)*0.025;
  float dir=fract(seedf*0.0007)<0.30?-1.0:1.0;
  float mult=reducedMotion>0.5?0.10:1.0;
  return time*(baseSpeed+jitter)*dir*mult;
}
float cloudCoverage(float seedf){return 0.40+0.30*fract(seedf*0.00091);}
float cloudDensity(vec3 localDir,float time,float seedf,float reducedMotion){
  float rot=cloudRotation(time,seedf,reducedMotion);
  float cs=cos(rot),sn=sin(rot);
  vec3 rp=vec3(cs*localDir.x+sn*localDir.z,localDir.y,-sn*localDir.x+cs*localDir.z);
  vec3 seedShift=vec3(seedf*0.0017,seedf*0.0023,seedf*0.0029);
  vec3 p=rp*4.8+seedShift;
  float qx=cFbm(p);
  float qy=cFbm(p+vec3(5.2,1.3,2.8));
  float n=cFbm(p+0.85*vec3(qx-0.5,qy-0.5,(qx-qy)*0.7));
  float cov=cloudCoverage(seedf);
  float lo=0.62-cov*0.30;float hi=lo+0.14;
  return smoothstep(lo,hi,n);
}
float cloudSelfShadow(vec3 localDir,vec3 worldSun,float time,float seedf,float reducedMotion){
  vec3 r0=normalize(uModel[0].xyz);
  vec3 r1=normalize(uModel[1].xyz);
  vec3 r2=normalize(uModel[2].xyz);
  vec3 localSun=normalize(vec3(dot(r0,worldSun),dot(r1,worldSun),dot(r2,worldSun)));
  float d1=cloudDensity(normalize(localDir+localSun*0.045),time,seedf,reducedMotion);
  float d2=cloudDensity(normalize(localDir+localSun*0.090),time,seedf,reducedMotion);
  float d3=cloudDensity(normalize(localDir+localSun*0.160),time,seedf,reducedMotion);
  float occ=clamp(0.55*d1+0.30*d2+0.15*d3,0.0,1.0);
  float grain=cFbm(localDir*14.0+vec3(seedf*0.011,seedf*0.013,seedf*0.017));
  float occDetail=clamp(occ*mix(0.75,1.20,grain),0.0,1.0);
  return 1.0-occDetail*0.70;
}
// ---- thunderstorms: localized, randomly-timed lightning flashes embedded in
// the cloud field. Mirrors clouds.wgsl exactly so both backends storm alike.
vec3 cHash3v(vec3 p){
  vec3 q=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));
  return fract(sin(q)*43758.5453);
}
float stormFlicker(float x){
  return exp(-x*20.0)+0.55*exp(-abs(x-0.05)*45.0)+0.30*exp(-abs(x-0.09)*70.0);
}
float cloudStorm(vec3 localDir,float time,float seedf,float density,float reducedMotion){
  if(reducedMotion>0.5)return 0.0;
  float freq=5.0;
  vec3 sOff=vec3(seedf*0.00061,seedf*0.00043,seedf*0.00077);
  vec3 p=localDir*freq+sOff;
  vec3 base=floor(p);
  float energy=0.0;
  for(int z=-1;z<=1;z++){
    for(int y=-1;y<=1;y++){
      for(int x=-1;x<=1;x++){
        vec3 cell=base+vec3(float(x),float(y),float(z));
        vec3 rnd=cHash3v(cell);
        if(rnd.x<0.86)continue; // ~14% of cells host a storm
        vec3 site=cell+cHash3v(cell+19.0);
        float d=length(p-site);
        float glow=exp(-d*d*8.0);
        if(glow<0.003)continue;
        float period=4.0+9.0*rnd.y;
        float tnorm=(time+rnd.z*period)/period;
        float xph=fract(tnorm);
        float cycAmp=smoothstep(0.25,1.0,cHash3v(cell+floor(tnorm)*1.37).x);
        energy+=glow*stormFlicker(xph)*cycAmp;
      }
    }
  }
  return min(energy*(0.15+0.85*density),3.0);
}
vec3 stormColor(float e){
  vec3 halo=vec3(0.34,0.30,1.00);
  vec3 core=vec3(0.78,0.88,1.00);
  float t=clamp(e,0.0,1.0);
  return mix(halo,core,t*t)*e*2.0;
}
void main(){
  vec3 n=normalize(vNrm);
  vec3 sun=normalize(uLight);
  vec3 viewDir=normalize(uCamera-vWorld);
  // Interpolated vLocal isn't exactly unit length across triangle interiors;
  // normalize so the noise lookup lines up with the shadow projection.
  vec3 localDir=normalize(vLocal);
  float density=cloudDensity(localDir,uTime,uSeed,uReducedMotion);
  float selfShadow=cloudSelfShadow(localDir,sun,uTime,uSeed,uReducedMotion);
  float NdL=clamp(dot(n,sun),0.0,1.0);
  vec3 albedo=mix(vec3(1.0),uTint,0.08);
  vec3 col=albedo*(0.02+0.98*NdL)*selfShadow;
  // Other-planet shadows (no self-exclude: parent surface is along L past
  // the cloud fragment).
  float s=1.0;
  for(int i=0;i<8;i++){
    if(i>=uShadowCount)break;
    vec4 sph=uShadowSpheres[i];
    if(distance(sph.xyz,uCenter)<1e-3)continue;
    vec3 d=sph.xyz-vWorld;
    float t=dot(d,sun);
    if(t<=0.0)continue;
    float c2=dot(d,d)-t*t;
    float R2=sph.w*sph.w;
    s*=smoothstep(R2,R2*1.10,c2);
  }
  col*=s;
  // Soft terminator on the cloud alpha so we don't see bright clouds on
  // the night-side hemisphere.
  float dayMask=smoothstep(-0.10,0.25,dot(n,sun));
  // Taper alpha at the silhouette so back-face culling doesn't make a hard
  // edge at the limb.
  float edgeFade=smoothstep(0.05,0.30,dot(n,viewDir));
  float baseA=density*dayMask*edgeFade*uVisibility;
  // Thunderstorm flashes: localized purple-blue lightning lighting cloud cells
  // from within. Brightest on the night side, faint on the day side; stormA
  // rises with the flash so the emissive survives the alpha blend where the
  // night-side cloud alpha is otherwise near zero.
  float storm=cloudStorm(localDir,uTime,uSeed,density,uReducedMotion);
  float nightBoost=mix(0.55,1.0,1.0-dayMask);
  col+=stormColor(storm)*nightBoost;
  float stormA=clamp(storm,0.0,1.0)*edgeFade*uVisibility;
  float alpha=max(baseA,stormA);
  // Distance fog attenuation on the alpha so far clouds don't punch holes
  // in the haze.
  float dist=distance(vWorld,uCamera);float sd=dist*0.030;
  alpha*=exp(-sd*sd);
  frag=vec4(col,alpha);
}`;

// Auroral shell (additive). Mirrors aurora.wgsl. Reuses PLANET_VERT for vWorld;
// ray-marches a thin auroral volume above the poles using nimitz triangle-wave
// noise + per-height palette (shadertoy McSBDm). Green base -> violet top,
// brightest on the night side and the limb.
const AURORA_FRAG = `#version 300 es
precision highp float;
in vec3 vWorld;
out vec4 frag;
uniform vec3 uCamera;uniform vec3 uLight;uniform vec3 uCenter;
uniform mat4 uModel;
uniform float uInner;uniform float uOuter;uniform float uFocus;uniform float uIntensity;
uniform float uTime;uniform float uReducedMotion;
const mat2 aM2=mat2(0.95534,0.29552,-0.29552,0.95534);
mat2 aMM2(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}
float aTri(float x){return clamp(abs(fract(x)-0.5),0.01,0.49);}
vec2 aTri2(vec2 p){return vec2(aTri(p.x)+aTri(p.y),aTri(p.y+aTri(p.x)));}
vec2 raySphere(vec3 ro,vec3 rd,vec3 ce,float ra){
  vec3 oc=ro-ce;float b=dot(oc,rd);float c=dot(oc,oc)-ra*ra;float h=b*b-c;
  if(h<0.0)return vec2(1.0,-1.0);
  float s=sqrt(h);return vec2(-b-s,-b+s);
}
// nimitz domain-warped triangle noise (Aurora).
float triNoise2d(vec2 p,float spd,float time){
  float z=1.8,z2=2.5,rz=0.0;
  p*=aMM2(p.x*0.06);
  vec2 bp=p;
  for(int i=0;i<5;i++){
    vec2 dg=aTri2(bp*1.85)*0.75;
    dg*=aMM2(time*spd);
    p-=dg/z2;
    bp*=1.3;z2*=0.45;z*=0.42;
    p*=1.21+(rz-1.0)*0.02;
    rz+=aTri(p.x+aTri(p.y))*z;
    p*=-aM2;
  }
  return clamp(1.0/pow(rz*29.0,1.3),0.0,0.55);
}
void main(){
  vec3 center=uCenter;
  // Planet body-frame basis (model rotation columns) so the aurora is locked to
  // the planet and rotates with it instead of sliding when dragged.
  vec3 bx=normalize(uModel[0].xyz);
  vec3 by=normalize(uModel[1].xyz);
  vec3 bz=normalize(uModel[2].xyz);
  float planetR=uInner;
  float outerR=uOuter;
  float innerA=planetR*1.005;
  vec3 ro=uCamera;
  vec3 rd=normalize(vWorld-ro);
  vec3 sun=normalize(uLight);
  vec2 outer=raySphere(ro,rd,center,outerR);
  if(outer.y<=outer.x){frag=vec4(0.0);return;}
  float tNear=max(outer.x,0.0);
  float tFar=outer.y;
  vec2 inner=raySphere(ro,rd,center,planetR);
  if(inner.x>0.0&&inner.x<inner.y)tFar=min(tFar,inner.x);
  if(tFar<=tNear){frag=vec4(0.0);return;}
  float motion=uReducedMotion>0.5?0.0:1.0;
  float at=uTime*motion*0.5;
  float curtainTop=innerA+(outerR-innerA)*0.25;
  float thickness=max(curtainTop-innerA,1e-4);
  const int STEPS=24;
  float dt=(tFar-tNear)/float(STEPS);
  vec3 col=vec3(0.0);
  vec3 avg=vec3(0.0);
  for(int i=0;i<STEPS;i++){
    float t=tNear+(float(i)+0.5)*dt;
    vec3 pos=ro+rd*t;
    vec3 rel=pos-center;
    float r=length(rel);
    if(r<innerA)continue;
    if(r>curtainTop)continue;
    vec3 dir=rel/r;
    vec3 ld=vec3(dot(bx,dir),dot(by,dir),dot(bz,dir));
    float lat=abs(ld.y);
    float band=smoothstep(0.42,0.60,lat)*(1.0-smoothstep(0.86,0.98,lat));
    float h=clamp((r-innerA)/thickness,0.0,1.0);
    vec2 pc=vec2(ld.x,ld.z);
    float coarse=triNoise2d(pc*1.4,0.025,at);
    float group=smoothstep(0.08,0.50,coarse);
    // Lateral wiggle: sway filaments side-to-side along the band as they rise so
    // each strand snakes and ripples like a real auroral curtain.
    vec2 radial=pc/max(length(pc),1e-3);
    vec2 tangent=vec2(-radial.y,radial.x);
    float wiggle=(sin(h*11.0+at*2.2+length(pc)*6.0)+0.5*sin(h*6.0-at*1.7+ld.y*8.0))*0.04;
    vec2 pcw=pc+vec2(coarse-0.275)*0.8+tangent*wiggle;
    float fil=triNoise2d(pcw*2.6,0.06,at);
    float strings=pow(clamp(fil*1.7,0.0,1.0),0.8);
    float rzt=strings*group*band;
    vec3 hue=sin(1.0-vec3(2.15,-0.5,1.2)+h*2.5)*0.5+0.5;
    vec3 samp=hue*rzt;
    avg=mix(avg,samp,0.5);
    float nightAmt=1.0-smoothstep(-0.2,0.3,dot(dir,sun));
    float nightFloor=mix(0.08,1.0,nightAmt);
    col+=avg*exp(-h*1.6)*nightFloor*(dt/thickness);
  }
  float intensity=uIntensity*(0.85+0.3*uFocus);
  col*=intensity*3.0;
  float dist=distance(vWorld,ro);float fs=dist*0.018;
  col*=exp(-fs*fs);
  frag=vec4(col,1.0);
}`;

// The scene's star — mirror of sun.wgsl. Reuses PLANET_VERT (gives vNrm/vLocal/
// vWorld). Emissive surface with granulation + dark sunspots + limb darkening;
// no lighting and no distance fog (it is a light source). The WebGL2 scene
// target is RGBA8, so the body is kept near/below 1.0 with clearly darker spots
// rather than relying on HDR bloom.
const SUN_FRAG = `#version 300 es
precision highp float;
in vec3 vNrm;in vec3 vLocal;in vec3 vWorld;
out vec4 frag;
uniform vec3 uCamera;uniform float uTime;uniform float uReducedMotion;uniform float uSeed;
float hash3(vec3 p){vec3 q=fract(p*0.3183099+vec3(0.1,0.2,0.3));q*=17.0;return fract(q.x*q.y*q.z*(q.x+q.y+q.z));}
float vnoise(vec3 x){
  vec3 i=floor(x),f=fract(x);vec3 u=f*f*(3.0-2.0*f);
  float n000=hash3(i),n100=hash3(i+vec3(1,0,0)),n010=hash3(i+vec3(0,1,0)),n110=hash3(i+vec3(1,1,0));
  float n001=hash3(i+vec3(0,0,1)),n101=hash3(i+vec3(1,0,1)),n011=hash3(i+vec3(0,1,1)),n111=hash3(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z);
}
float fbm(vec3 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*vnoise(p);p*=2.04;a*=.5;}return v;}
// Smooth unit tangent flow direction (mirror of planet flowDir).
vec3 flowDir(vec3 local,vec3 n,float seed){
  vec3 fp=local*1.5+vec3(seed*0.002,seed*0.0017,seed*0.0023);
  vec3 v=vec3(vnoise(fp)-0.5,vnoise(fp+vec3(13.1,7.7,2.3))-0.5,vnoise(fp+vec3(5.5,19.2,8.8))-0.5);
  v=v-n*dot(v,n);
  float l=length(v);
  if(l<1e-4){return vec3(0.0);}
  return v/l;
}
// Surface plasma color at a (possibly flow-advected) sample position.
vec3 sunShade(vec3 p){
  float gran=fbm(p*7.0);
  float mottle=fbm(p*2.3);
  float spotField=fbm(p*1.7+vec3(11.0,0.0,-4.0));
  float penumbra=1.0-smoothstep(0.26,0.36,spotField);
  float umbra=1.0-smoothstep(0.16,0.26,spotField);
  vec3 hot=vec3(1.0,0.83,0.55);
  vec3 warm=vec3(1.0,0.66,0.30);
  vec3 col=mix(warm,hot,gran*0.6+mottle*0.4);
  col=mix(col,vec3(0.6,0.28,0.12),penumbra*0.75);
  col=mix(col,vec3(0.32,0.13,0.05),umbra*0.88);
  return col;
}
void main(){
  vec3 n=normalize(vLocal);
  vec3 nb=n+vec3(uSeed*0.013,0.0,uSeed*0.021);
  // Flow-field advection: plasma detail streams along a tangent flow field,
  // cross-fading two half-cycle-offset samples. Frozen under reduced motion.
  float speed=mix(0.12,0.0,uReducedMotion);
  float mag=0.22;
  vec3 flow=flowDir(n,n,uSeed);
  float t=uTime*speed;
  float ph0=fract(t);
  float ph1=fract(t+0.5);
  vec3 c0=sunShade(nb-flow*ph0*mag);
  vec3 c1=sunShade(nb-flow*ph1*mag);
  float w=abs(0.5-ph0)*2.0;
  vec3 col=mix(c0,c1,w);
  vec3 V=normalize(uCamera-vWorld);
  float ndv=max(dot(normalize(vNrm),V),0.0);
  float limb=0.55+0.45*pow(ndv,0.55);
  col*=limb;
  frag=vec4(col*1.3,1.0);
}`;

// Camera-facing additive corona billboard — mirror of sun.wgsl corona.
const CORONA_VERT = `#version 300 es
layout(location=0) in vec2 aCorner;
uniform mat4 uViewProj;uniform vec3 uCamera;uniform vec3 uCenter;uniform float uRadius;
out vec2 vUv;
void main(){
  // World-space camera-facing billboard. uRadius is scaled on the CPU by camera
  // distance (Engine.ts) so the whole sun keeps a constant on-screen size.
  float coronaR=uRadius*1.5;
  vec3 viewDir=normalize(uCenter-uCamera);
  vec3 up0=vec3(0.0,1.0,0.0);
  if(abs(viewDir.y)>0.98){up0=vec3(0.0,0.0,1.0);}
  vec3 right=normalize(cross(up0,viewDir));
  vec3 up=cross(viewDir,right);
  vec3 wpos=uCenter+(right*aCorner.x+up*aCorner.y)*coronaR;
  vUv=aCorner;
  gl_Position=uViewProj*vec4(wpos,1.0);
}`;
const CORONA_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform float uTime;uniform float uReducedMotion;
float hash3(vec3 p){vec3 q=fract(p*0.3183099+vec3(0.1,0.2,0.3));q*=17.0;return fract(q.x*q.y*q.z*(q.x+q.y+q.z));}
float vnoise(vec3 x){
  vec3 i=floor(x),f=fract(x);vec3 u=f*f*(3.0-2.0*f);
  float n000=hash3(i),n100=hash3(i+vec3(1,0,0)),n010=hash3(i+vec3(0,1,0)),n110=hash3(i+vec3(1,1,0));
  float n001=hash3(i+vec3(0,0,1)),n101=hash3(i+vec3(1,0,1)),n011=hash3(i+vec3(0,1,1)),n111=hash3(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z);
}
float fbm(vec3 p){float v=0.0,a=0.5;vec3 q=p;for(int i=0;i<5;i++){v+=a*vnoise(q);q*=2.04;a*=0.5;}return v;}
float fbm2(vec2 p,float t){return fbm(vec3(p,t));}
void main(){
  float r=length(vUv);
  if(r>1.0){discard;}
  float t=uTime*mix(1.0,0.0,uReducedMotion);
  float ang=atan(vUv.y,vUv.x);
  // Polar-anchored sample coord; higher freq = tighter wisps.
  vec2 sp=vec2(cos(ang),sin(ang))*(r*5.5);
  // Domain warping (iquilezles.org/articles/warp): fbm(p+4r), r=fbm(p+4q), q=fbm(p).
  float drift=t*0.06;
  vec2 q=vec2(fbm2(sp,drift),fbm2(sp+vec2(5.2,1.3),drift));
  vec2 rr=vec2(fbm2(sp+4.0*q+vec2(1.7,9.2),drift),fbm2(sp+4.0*q+vec2(8.3,2.8),drift));
  float warp=fbm2(sp+4.0*rr,drift);
  // Distinct flare arms bent by the warp so they curl like liquid plasma.
  float wang=ang+(warp-0.5)*2.4+(rr.x-0.5)*1.3;
  float arm=pow(0.5+0.5*sin(7.0*wang),3.5);
  float armVary=0.4+0.85*fbm2(vec2(cos(ang),sin(ang))*1.6,drift*0.7);
  float streak=0.35+0.85*warp;
  float pulse=0.85+0.15*sin(t*0.6);
  // Ragged outer edge: per-direction noise pushes the fade radius in and out so
  // the corona dissolves into wisps of varying length instead of a clean circle.
  float edgeN=fbm2(vec2(cos(ang),sin(ang))*3.5+warp*2.0,drift*0.4);
  float edge=0.58+0.37*edgeN;
  float radial=smoothstep(edge,edge-0.5,r);
  float glow=radial*(0.16+1.4*arm*armVary)*streak*pulse*1.3;
  vec3 col=mix(vec3(1.0,0.92,0.6),vec3(1.0,0.42,0.14),r)*glow;
  frag=vec4(col,glow);
}`;

interface Program {
  prog: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}
export class WebGL2Renderer implements SceneRenderer {
  readonly backend = 'webgl2' as const;
  private gl!: WebGL2RenderingContext;
  private canvas!: HTMLCanvasElement;
  private width = 1;
  private height = 1;

  private nebula!: Program;
  private planet!: Program;
  private point!: Program;
  private line!: Program;
  private wire!: Program;
  private atmosphere!: Program;
  private clouds!: Program;
  private aurora!: Program;
  private ring!: Program;
  private flight!: Program;
  private sun!: Program;
  private corona!: Program;
  private present!: Program;

  // Offscreen scene target: the scene is rendered (and per-shader tonemapped)
  // in linear space into a multisampled buffer, resolved to a texture, then
  // presented to the canvas with the sRGB gamma encode. Mirrors the WebGPU
  // HDR-scene + composite split so both backends match in brightness.
  private msaaFbo: WebGLFramebuffer | null = null;
  private msaaColor: WebGLRenderbuffer | null = null;
  private msaaDepth: WebGLRenderbuffer | null = null;
  private resolveFbo: WebGLFramebuffer | null = null;
  private sceneTex: WebGLTexture | null = null;

  // Sphere meshes, one per LOD level (index 0 = finest). Each body selects a
  // level from its on-screen angular size so distant planets, moons and the
  // sun draw a coarser mesh while close-up bodies keep the original detail.
  private sphereLods: {
    vao: WebGLVertexArrayObject;
    count: number;
    u32: boolean;
    wireVao: WebGLVertexArrayObject;
    lineCount: number;
    lineU32: boolean;
  }[] = [];
  private coronaVao!: WebGLVertexArrayObject;
  private ringVao!: WebGLVertexArrayObject;
  private ringCount = 0;
  private ringU32 = false;

  private starVao!: WebGLVertexArrayObject;
  private starCount = 0;
  private satVao!: WebGLVertexArrayObject;
  private satPos!: WebGLBuffer;
  private satAttr!: WebGLBuffer;
  private satColor!: WebGLBuffer;
  private satCapacity = 0;
  // Per-frame scratch for satellite uploads. Sized lazily to the largest seen.
  private satScratchPos = new Float32Array(0);
  private satScratchAttr = new Float32Array(0);
  private satScratchColor = new Float32Array(0);
  private poiVao!: WebGLVertexArrayObject;
  private poiPos!: WebGLBuffer;
  private poiAttr!: WebGLBuffer;
  private poiColor!: WebGLBuffer;
  private poiCount = 0;
  private poiLineVao!: WebGLVertexArrayObject;
  private poiLineBuf!: WebGLBuffer;
  private poiLineVerts = 0;
  // Rocket trajectory ribbon: instanced quads, one per polyline segment.
  // Geometry is static (planet centers don't move), so buffer/VAO are
  // (re)built only when the polyline length changes.
  private flightVao: WebGLVertexArrayObject | null = null;
  private flightBuf: WebGLBuffer | null = null;
  private flightSegments = 0;
  private flightPoints = 0;

  private stats: RenderStats = { drawCalls: 0, triangles: 0, gpuMemoryMB: 0 };
  private deviceLostCb: (() => void) | null = null;

  // Scratch for uShadowSpheres[8] uploads (8 vec4 = 32 floats).
  private shadowScratch = new Float32Array(32);

  async init(canvas: HTMLCanvasElement, onProgress?: LoadProgressFn): Promise<void> {
    const report = async (frac: number, label: string): Promise<void> => {
      if (!onProgress) return;
      onProgress(frac, label);
      await paintYield();
    };

    await report(0.1, 'Initializing WebGL…');
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this.canvas = canvas;

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.deviceLostCb?.();
    });

    await report(0.35, 'Compiling shaders…');
    this.nebula = this.makeProgram(NEBULA_VERT, NEBULA_FRAG, ['uTime', 'uInvViewProj']);
    this.planet = this.makeProgram(PLANET_VERT, PLANET_FRAG, [
      'uViewProj', 'uModel', 'uCamera', 'uLight', 'uLow', 'uMid', 'uHigh',
      'uSeed', 'uFocus', 'uOceans', 'uCityLights', 'uFlow', 'uCraters',
      'uTime', 'uReducedMotion', 'uCloudShadow',
      'uShadowCount', 'uShadowSpheres[0]',
    ]);
    this.point = this.makeProgram(POINT_VERT, POINT_FRAG, [
      'uViewProj', 'uTime', 'uMode', 'uWireframe', 'uHeight',
    ]);
    this.line = this.makeProgram(LINE_VERT, LINE_FRAG, [
      'uViewProj', 'uAspect', 'uThick', 'uHeight', 'uWireframe',
    ]);
    this.wire = this.makeProgram(PLANET_VERT, WIRE_FRAG, ['uViewProj', 'uModel']);
    this.atmosphere = this.makeProgram(PLANET_VERT, ATMOSPHERE_FRAG, [
      'uViewProj', 'uModel', 'uCamera', 'uLight', 'uColor', 'uCenter',
      'uInner', 'uOuter', 'uFocus', 'uIntensity',
      'uShadowCount', 'uShadowSpheres[0]',
    ]);
    this.clouds = this.makeProgram(PLANET_VERT, CLOUDS_FRAG, [
      'uViewProj', 'uModel', 'uCamera', 'uLight', 'uTint', 'uCenter',
      'uTime', 'uSeed', 'uVisibility', 'uReducedMotion',
      'uShadowCount', 'uShadowSpheres[0]',
    ]);
    this.aurora = this.makeProgram(PLANET_VERT, AURORA_FRAG, [
      'uViewProj', 'uModel', 'uCamera', 'uLight', 'uCenter',
      'uInner', 'uOuter', 'uFocus', 'uIntensity', 'uTime', 'uReducedMotion',
    ]);
    this.ring = this.makeProgram(RING_VERT, RING_FRAG, [
      'uViewProj', 'uModel', 'uCamera', 'uLight', 'uLow', 'uMid', 'uHigh',
      'uTime', 'uSeed', 'uThin', 'uFocus',
      'uShadowCount', 'uShadowSpheres[0]',
    ]);
    this.flight = this.makeProgram(FLIGHT_VERT, FLIGHT_FRAG, [
      'uViewProj', 'uAspect', 'uThick', 'uCamera', 'uWireframe', 'uTime',
      'uReducedMotion',
    ]);
    this.sun = this.makeProgram(PLANET_VERT, SUN_FRAG, [
      'uViewProj', 'uModel', 'uCamera', 'uTime', 'uReducedMotion', 'uSeed',
    ]);
    this.corona = this.makeProgram(CORONA_VERT, CORONA_FRAG, [
      'uViewProj', 'uCamera', 'uCenter', 'uRadius', 'uTime', 'uReducedMotion',
    ]);
    this.present = this.makeProgram(PRESENT_VERT, PRESENT_FRAG, ['uScene', 'uFlare', 'uAspect', 'uBarrel']);

    await report(0.75, 'Building scene geometry…');
    this.buildSphere();
    this.buildCoronaQuad();
    await report(0.9, 'Generating starfield…');
    this.buildStars(2000);
    this.buildPoiBuffers();
    this.buildSatBuffers();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    await report(1, 'Entering the timeline…');
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      throw new Error('WebGL2 shader compile error: ' + log);
    }
    return sh;
  }

  private makeProgram(vs: string, fs: string, uniforms: string[]): Program {
    const gl = this.gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, this.compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('WebGL2 link error: ' + gl.getProgramInfoLog(prog));
    }
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniforms) u[name] = gl.getUniformLocation(prog, name);
    return { prog, uniforms: u };
  }

  private buildCoronaQuad(): void {
    const gl = this.gl;
    // Unit quad (two triangles) of vec2 corners for the camera-facing corona.
    const quad = new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
    this.coronaVao = vao;
  }

  private buildSphere(): void {
    const gl = this.gl;
    this.sphereLods = [];
    for (const [latBands, lonBands] of SPHERE_LODS_WEBGL2) {
      const geo = createSphere(latBands, lonBands);
      const data = interleave(geo);
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
      gl.bindVertexArray(null);

      // Wireframe VAO: same vertex buffer, edge (line-list) index buffer.
      const lineIdx = trianglesToLineIndices(geo.indices, geo.vertexCount);
      const wireVao = gl.createVertexArray()!;
      gl.bindVertexArray(wireVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      const lineIbo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineIbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineIdx, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.bindVertexArray(null);

      this.sphereLods.push({
        vao,
        count: geo.indexCount,
        u32: geo.indices instanceof Uint32Array,
        wireVao,
        lineCount: lineIdx.length,
        lineU32: lineIdx instanceof Uint32Array,
      });
    }

    // Ring annulus (flat, lies in XZ). Enables the uv attribute (location 2)
    // because the ring shader needs radial/angle from uv, unlike the sphere.
    const ringGeo = createRingGeometry(1.35, 2.1, 96);
    const ringData = interleave(ringGeo);
    const ringVao = gl.createVertexArray()!;
    gl.bindVertexArray(ringVao);
    const ringVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ringVbo);
    gl.bufferData(gl.ARRAY_BUFFER, ringData, gl.STATIC_DRAW);
    const ringIbo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ringIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ringGeo.indices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    gl.bindVertexArray(null);
    this.ringVao = ringVao;
    this.ringCount = ringGeo.indexCount;
    this.ringU32 = ringGeo.indices instanceof Uint32Array;
  }

  private buildStars(count: number): void {
    const gl = this.gl;
    const rand = mulberry32(1337);
    const pos = new Float32Array(count * 3);
    const attr = new Float32Array(count * 4);
    const color = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Random point on a shell. Kept reasonably close to the scene so
      // camera translation produces visible parallax (see WebGPURenderer).
      const u = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const radius = 55 + rand() * 110;
      pos.set(
        [Math.cos(theta) * r * radius, u * radius, Math.sin(theta) * r * radius],
        i * 3,
      );
      attr.set([20 + Math.pow(rand(), 3) * 120, rand(), 0, 0], i * 4);
      color.set([0.7 + rand() * 0.3, 0.8, 0.9 + rand() * 0.1], i * 3);
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    this.bindPointAttribs(pos, attr, color);
    gl.bindVertexArray(null);
    this.starVao = vao;
    this.starCount = count;
  }

  private bindPointAttribs(
    pos: Float32Array,
    attr: Float32Array,
    color: Float32Array,
  ): { pos: WebGLBuffer; attr: WebGLBuffer; color: WebGLBuffer } {
    const gl = this.gl;
    const pb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const ab = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, ab);
    gl.bufferData(gl.ARRAY_BUFFER, attr, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    const cb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, color, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    return { pos: pb, attr: ab, color: cb };
  }

  private buildPoiBuffers(): void {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const bufs = this.bindPointAttribs(
      new Float32Array(0),
      new Float32Array(0),
      new Float32Array(0),
    );
    gl.bindVertexArray(null);
    this.poiVao = vao;
    this.poiPos = bufs.pos;
    this.poiAttr = bufs.attr;
    this.poiColor = bufs.color;

    const lineVao = gl.createVertexArray()!;
    gl.bindVertexArray(lineVao);
    const lb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, lb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(0), gl.DYNAMIC_DRAW);
    const stride = 13 * 4; // inner3 + outer3 + param3 + color4
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 36);
    gl.bindVertexArray(null);
    this.poiLineVao = lineVao;
    this.poiLineBuf = lb;
  }

  // Allocates the satellite VAO with empty dynamic buffers. Per-frame data is
  // uploaded each render via bufferData (sized to actual satellite count, with
  // backing capacity tracked to skip reallocation when count fits).
  private buildSatBuffers(): void {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const bufs = this.bindPointAttribs(
      new Float32Array(0),
      new Float32Array(0),
      new Float32Array(0),
    );
    gl.bindVertexArray(null);
    this.satVao = vao;
    this.satPos = bufs.pos;
    this.satAttr = bufs.attr;
    this.satColor = bufs.color;
  }

  // Pack visible planets' satellites into the dynamic VAO buffers. Returns the
  // total satellite count uploaded. Satellites are world-locked (don't inherit
  // planet spin); positions are simply planet.center + orbital offset.
  private uploadSatellites(frame: FrameState): number {
    let count = 0;
    for (const p of frame.planets) {
      if (p.visibility <= 0.02) continue;
      count += p.satellites.length;
    }
    if (count === 0) return 0;
    if (count > this.satCapacity) {
      this.satScratchPos = new Float32Array(count * 3);
      this.satScratchAttr = new Float32Array(count * 4);
      this.satScratchColor = new Float32Array(count * 3);
      this.satCapacity = count;
    }
    const pos = this.satScratchPos;
    const attr = this.satScratchAttr;
    const color = this.satScratchColor;
    let n = 0;
    for (const p of frame.planets) {
      const vis = p.visibility;
      if (vis <= 0.02) continue;
      const fade = Math.min(1, Math.max(0, vis));
      for (let s = 0; s < p.satellites.length; s++) {
        const sat = p.satellites[s]!;
        pos[n * 3 + 0] = p.center[0] + sat.offset[0];
        pos[n * 3 + 1] = p.center[1] + sat.offset[1];
        pos[n * 3 + 2] = p.center[2] + sat.offset[2];
        // Pixel size: 22px baseline, scaled by visibility; phase for twinkle.
        attr[n * 4 + 0] = 22 * fade;
        attr[n * 4 + 1] = (p.seed * 0.137 + s * 0.731) % 1;
        attr[n * 4 + 2] = 0;
        attr[n * 4 + 3] = 0;
        color[n * 3 + 0] = 0.9;
        color[n * 3 + 1] = 0.95;
        color[n * 3 + 2] = 1.0;
        n++;
      }
    }
    const gl = this.gl;
    gl.bindVertexArray(this.satVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.satPos);
    gl.bufferData(gl.ARRAY_BUFFER, pos.subarray(0, n * 3), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.satAttr);
    gl.bufferData(gl.ARRAY_BUFFER, attr.subarray(0, n * 4), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.satColor);
    gl.bufferData(gl.ARRAY_BUFFER, color.subarray(0, n * 3), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    return n;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.gl.viewport(0, 0, this.width, this.height);
    this.ensureSceneTargets();
  }

  // (Re)create the offscreen MSAA color/depth renderbuffers and the resolve
  // texture at the current canvas size. Called on every resize.
  private ensureSceneTargets(): void {
    const gl = this.gl;
    const w = this.width;
    const h = this.height;
    if (this.msaaColor) gl.deleteRenderbuffer(this.msaaColor);
    if (this.msaaDepth) gl.deleteRenderbuffer(this.msaaDepth);
    if (this.msaaFbo) gl.deleteFramebuffer(this.msaaFbo);
    if (this.sceneTex) gl.deleteTexture(this.sceneTex);
    if (this.resolveFbo) gl.deleteFramebuffer(this.resolveFbo);

    const maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number;
    const samples = Math.min(4, maxSamples);

    const color = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, color);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
    const depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorageMultisample(
      gl.RENDERBUFFER,
      samples,
      gl.DEPTH_COMPONENT24,
      w,
      h,
    );
    const msaa = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaa);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const resolve = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, resolve);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.msaaFbo = msaa;
    this.msaaColor = color;
    this.msaaDepth = depth;
    this.resolveFbo = resolve;
    this.sceneTex = tex;
  }

  render(frame: FrameState): void {
    const gl = this.gl;
    this.stats = { drawCalls: 0, triangles: 0, gpuMemoryMB: this.estimateMemoryMB() };
    if (!this.msaaFbo) this.ensureSceneTargets();
    // Render the scene into the offscreen multisampled (linear) target; the
    // present pass below resolves it and applies the sRGB gamma encode.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Nebula (no depth).
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.nebula.prog);
    gl.uniform1f(this.nebula.uniforms.uTime!, frame.time);
    gl.uniformMatrix4fv(this.nebula.uniforms.uInvViewProj!, false, frame.invViewProj);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.drawCalls++;

    // Stars (additive points).
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    if (frame.quality.starCount > 0) {
      gl.useProgram(this.point.prog);
      gl.uniformMatrix4fv(this.point.uniforms.uViewProj!, false, frame.viewProj);
      gl.uniform1f(this.point.uniforms.uTime!, frame.time);
      gl.uniform1f(this.point.uniforms.uMode!, 0);
      gl.uniform1f(this.point.uniforms.uWireframe!, 0);
      gl.bindVertexArray(this.starVao);
      gl.drawArrays(gl.POINTS, 0, Math.min(this.starCount, frame.quality.starCount));
      this.stats.drawCalls++;
    }

    // Planets + moons (opaque).
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    const model = mat4.create();
    // Frustum-cull the sun (body + corona). Inflate the test radius to 1.6× so
    // the additive corona billboard (1.5× the body radius) isn't clipped a frame
    // early as the star slides off screen.
    const sunVisible = frame.frustum.intersectsSphere(
      frame.sun.center,
      frame.sun.radius * 1.6,
    );
    const sunLod = selectSphereLod(
      frame.sun.center,
      frame.sun.radius,
      frame.cameraPos,
    );
    if (frame.wireframe) {
      // Debug wireframe: planets and moons as edges.
      gl.depthMask(true);
      gl.useProgram(this.wire.prog);
      gl.uniformMatrix4fv(this.wire.uniforms.uViewProj!, false, frame.viewProj);
      // Sun body as wireframe (drawn separately from planets, like the filled
      // path below). Skipped when the sun is off screen.
      if (sunVisible) {
        this.drawWire(frame.sun.center, frame.sun.radius, [0, 0, 0, 1], model, sunLod);
      }
      for (const p of frame.planets) {
        const vis = p.visibility;
        if (vis <= 0.02) continue;
        this.drawWire(
          p.center,
          p.radius * vis,
          p.orientation,
          model,
          selectSphereLod(p.center, p.radius * vis, frame.cameraPos),
        );
        for (const m of p.moons) {
          const orbit = m.orbitRadius * vis;
          const localOffset: [number, number, number] = [
            Math.cos(m.angle) * orbit,
            Math.sin(m.angle * 0.5) * orbit * 0.2,
            Math.sin(m.angle) * orbit,
          ];
          const wo = quat.rotateVec3(p.orientation, localOffset);
          const moonCenter: [number, number, number] = [
            p.center[0] + wo[0],
            p.center[1] + wo[1],
            p.center[2] + wo[2],
          ];
          if (!frame.frustum.intersectsSphere(moonCenter, m.size * vis)) continue;
          const moonRot = quat.multiply(
            p.orientation,
            quat.fromAxisAngle([0, 1, 0], frame.moonTime * 0.3),
          );
          this.drawWire(
            moonCenter,
            m.size * vis,
            moonRot,
            model,
            selectSphereLod(moonCenter, m.size * vis, frame.cameraPos),
          );
        }
      }
    } else {
    // Sun body (opaque, emissive). Skipped entirely when the sun is outside the
    // view frustum; otherwise the near surface wins on depth, matching how
    // planets are drawn in this backend.
    if (sunVisible) {
    gl.depthMask(true);
    gl.useProgram(this.sun.prog);
    gl.uniformMatrix4fv(this.sun.uniforms.uViewProj!, false, frame.viewProj);
    gl.uniform3fv(this.sun.uniforms.uCamera!, frame.cameraPos);
    gl.uniform1f(this.sun.uniforms.uTime!, frame.time);
    gl.uniform1f(this.sun.uniforms.uReducedMotion!, frame.reducedMotion ? 1 : 0);
    gl.uniform1f(this.sun.uniforms.uSeed!, 1234);
    mat4.fromRotationTranslationScale(model, [0, 0, 0, 1], frame.sun.center, frame.sun.radius);
    gl.uniformMatrix4fv(this.sun.uniforms.uModel!, false, model);
    const sunMesh = this.sphereLods[sunLod]!;
    gl.bindVertexArray(sunMesh.vao);
    gl.drawElements(
      gl.TRIANGLES,
      sunMesh.count,
      sunMesh.u32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      0,
    );
    this.stats.drawCalls++;
    this.stats.triangles += sunMesh.count / 3;
    }

    gl.useProgram(this.planet.prog);
    gl.uniformMatrix4fv(this.planet.uniforms.uViewProj!, false, frame.viewProj);
    gl.uniform3fv(this.planet.uniforms.uCamera!, frame.cameraPos);
    gl.uniform3fv(this.planet.uniforms.uLight!, frame.keyLightDir);
    gl.uniform1f(this.planet.uniforms.uReducedMotion!, frame.reducedMotion ? 1 : 0);
    this.bindShadowUniforms(this.planet, frame);
    for (const p of frame.planets) {
      const vis = p.visibility;
      if (vis <= 0.02) continue;
      const er = p.radius * vis;
      // Cloud shadow strength fades with visibility so it tracks the cloud
      // shell's alpha; 0 when the toggle is off.
      const cloudShadow = p.clouds ? vis : 0;
      // Use per-planet cloud time so cloud-shadow sampling on the planet
      // body slows in lockstep with the cloud shell when the planet pauses.
      gl.uniform1f(this.planet.uniforms.uTime!, p.cloudTime);
      const planetLod = selectSphereLod(p.center, er, frame.cameraPos);
      this.drawSphere(p, p.center, er, p.orientation, p.paletteLow, p.paletteMid, p.paletteHigh, p.oceans, cloudShadow, model, planetLod, p.cityLights, p.flowMap);
      for (const m of p.moons) {
        const orbit = m.orbitRadius * vis;
        // Moon orbit offset lives in the planet's local frame; rotate it by
        // the planet's orientation so moons swing with the planet as it spins
        // or as the user drags it.
        const localOffset: [number, number, number] = [
          Math.cos(m.angle) * orbit,
          Math.sin(m.angle * 0.5) * orbit * 0.2,
          Math.sin(m.angle) * orbit,
        ];
        const wo = quat.rotateVec3(p.orientation, localOffset);
        const moonCenter: [number, number, number] = [
          p.center[0] + wo[0],
          p.center[1] + wo[1],
          p.center[2] + wo[2],
        ];
        // Per-moon frustum cull: skip moons whose own bounding sphere is fully
        // off screen even when the parent planet is visible.
        if (!frame.frustum.intersectsSphere(moonCenter, m.size * vis)) continue;
        const moonRot = quat.multiply(
          p.orientation,
          quat.fromAxisAngle([0, 1, 0], frame.moonTime * 0.3),
        );
        this.drawSphere(
          p,
          moonCenter,
          m.size * vis,
          moonRot,
          m.paletteLow as [number, number, number],
          m.paletteMid as [number, number, number],
          m.paletteHigh as [number, number, number],
          false,
          0, // moons don't get cloud shadows
          model,
          selectSphereLod(moonCenter, m.size * vis, frame.cameraPos),
          false,
          false, // moons don't flow
          true, // meteorite impact craters
        );
      }
    }

    // Satellite point sprites. Drawn after the opaque planet+moon pass so
    // the depth buffer (with planet/moon depths) correctly hides satellites
    // orbiting behind their planet. Reuses the POINT shader (uMode=0 makes
    // it look identical to a star) with additive blend and depth-test-only.
    const satCount = this.uploadSatellites(frame);
    if (satCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.useProgram(this.point.prog);
      gl.uniformMatrix4fv(this.point.uniforms.uViewProj!, false, frame.viewProj);
      gl.uniform1f(this.point.uniforms.uTime!, frame.time);
      gl.uniform1f(this.point.uniforms.uMode!, 0);
      gl.uniform1f(this.point.uniforms.uWireframe!, 0);
      gl.bindVertexArray(this.satVao);
      gl.drawArrays(gl.POINTS, 0, satCount);
      this.stats.drawCalls++;
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // Cloud shells (alpha-blended). Between the opaque planet and the
    // additive atmosphere so the haze still wraps around the limb above
    // the clouds. Same sphere mesh, scaled up by CLOUD_SHELL_SCALE.
    // Per-planet — only set up state if at least one visible planet has
    // clouds enabled in its company definition.
    const anyClouds = frame.planets.some((p) => p.clouds && p.visibility > 0.02);
    if (anyClouds) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );
      gl.depthMask(false);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      // The sphere mesh winds its outward faces clockwise (WebGPU declares the
      // planet pipeline frontFace='cw'); WebGL2 defaults to CCW, so without
      // this the BACK cull would remove the near/outer shell faces and leave
      // only the far faces, which depth-fail against the planet (clouds would
      // appear only as a thin silhouette rim).
      gl.frontFace(gl.CW);
      gl.useProgram(this.clouds.prog);
      gl.uniformMatrix4fv(this.clouds.uniforms.uViewProj!, false, frame.viewProj);
      gl.uniform3fv(this.clouds.uniforms.uCamera!, frame.cameraPos);
      gl.uniform3fv(this.clouds.uniforms.uLight!, frame.keyLightDir);
      gl.uniform1f(this.clouds.uniforms.uReducedMotion!, frame.reducedMotion ? 1 : 0);
      this.bindShadowUniforms(this.clouds, frame);
      for (const p of frame.planets) {
        if (!p.clouds) continue;
        const vis = p.visibility;
        if (vis <= 0.02) continue;
        const er = p.radius * vis;
        const cloudR = er * CLOUD_SHELL_SCALE_WEBGL2;
        mat4.fromRotationTranslationScale(model, p.orientation, p.center, cloudR);
        gl.uniformMatrix4fv(this.clouds.uniforms.uModel!, false, model);
        gl.uniform3fv(this.clouds.uniforms.uTint!, p.paletteHigh);
        gl.uniform3fv(this.clouds.uniforms.uCenter!, p.center);
        gl.uniform1f(this.clouds.uniforms.uSeed!, p.seed % 100000);
        gl.uniform1f(this.clouds.uniforms.uVisibility!, vis);
        // Per-planet cloud time so drift halts with the planet's spin.
        gl.uniform1f(this.clouds.uniforms.uTime!, p.cloudTime);
        const mesh = this.sphereLods[selectSphereLod(p.center, er, frame.cameraPos)]!;
        gl.bindVertexArray(mesh.vao);
        gl.drawElements(
          gl.TRIANGLES,
          mesh.count,
          mesh.u32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
          0,
        );
        this.stats.drawCalls++;
        this.stats.triangles += mesh.count / 3;
      }
      gl.disable(gl.CULL_FACE);
      gl.frontFace(gl.CCW);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // Atmospheric scattering shells (additive, camera-facing hemisphere only).
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.useProgram(this.atmosphere.prog);
    gl.uniformMatrix4fv(this.atmosphere.uniforms.uViewProj!, false, frame.viewProj);
    gl.uniform3fv(this.atmosphere.uniforms.uCamera!, frame.cameraPos);
    gl.uniform3fv(this.atmosphere.uniforms.uLight!, frame.keyLightDir);
    this.bindShadowUniforms(this.atmosphere, frame);
    for (const p of frame.planets) {
      const vis = p.visibility;
      if (vis <= 0.02) continue;
      const er = p.radius * vis;
      const outerR = er * 1.02;
      mat4.fromRotationTranslationScale(model, p.orientation, p.center, outerR);
      gl.uniformMatrix4fv(this.atmosphere.uniforms.uModel!, false, model);
      gl.uniform3fv(this.atmosphere.uniforms.uColor!, p.paletteHigh);
      gl.uniform3fv(this.atmosphere.uniforms.uCenter!, p.center);
      gl.uniform1f(this.atmosphere.uniforms.uInner!, er);
      gl.uniform1f(this.atmosphere.uniforms.uOuter!, outerR);
      gl.uniform1f(this.atmosphere.uniforms.uFocus!, p.focus);
      gl.uniform1f(this.atmosphere.uniforms.uIntensity!, 0.9 * vis);
      const mesh = this.sphereLods[selectSphereLod(p.center, er, frame.cameraPos)]!;
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(
        gl.TRIANGLES,
        mesh.count,
        mesh.u32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        0,
      );
      this.stats.drawCalls++;
    }
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);

    // Auroral shells (additive, camera-facing hemisphere only). Drawn after the
    // atmosphere so the curtains glow above the haze. Like clouds, the near
    // hemisphere must render (frontFace=CW + cull BACK) so the band sits on the
    // visible side and the planet occludes the far half.
    const anyAurora = frame.planets.some((p) => p.aurora && p.visibility > 0.02);
    if (anyAurora) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CW);
      gl.useProgram(this.aurora.prog);
      gl.uniformMatrix4fv(this.aurora.uniforms.uViewProj!, false, frame.viewProj);
      gl.uniform3fv(this.aurora.uniforms.uCamera!, frame.cameraPos);
      gl.uniform3fv(this.aurora.uniforms.uLight!, frame.keyLightDir);
      gl.uniform1f(this.aurora.uniforms.uTime!, frame.time);
      gl.uniform1f(this.aurora.uniforms.uReducedMotion!, frame.reducedMotion ? 1 : 0);
      for (const p of frame.planets) {
        if (!p.aurora) continue;
        const vis = p.visibility;
        if (vis <= 0.02) continue;
        const er = p.radius * vis;
        const auroraR = er * 1.22;
        mat4.fromRotationTranslationScale(model, p.orientation, p.center, auroraR);
        gl.uniformMatrix4fv(this.aurora.uniforms.uModel!, false, model);
        gl.uniform3fv(this.aurora.uniforms.uCenter!, p.center);
        gl.uniform1f(this.aurora.uniforms.uInner!, er);
        gl.uniform1f(this.aurora.uniforms.uOuter!, auroraR);
        gl.uniform1f(this.aurora.uniforms.uFocus!, p.focus);
        gl.uniform1f(this.aurora.uniforms.uIntensity!, vis);
        const mesh = this.sphereLods[selectSphereLod(p.center, er, frame.cameraPos)]!;
        gl.bindVertexArray(mesh.vao);
        gl.drawElements(
          gl.TRIANGLES,
          mesh.count,
          mesh.u32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
          0,
        );
        this.stats.drawCalls++;
      }
      gl.disable(gl.CULL_FACE);
      gl.frontFace(gl.CCW);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // Sun corona (additive billboard). Depth-tested so planets in front occlude
    // it and the sun body masks the disc; drawn before alpha rings so rings
    // composite over the glow. No depth write. Skipped when the sun is off
    // screen.
    if (sunVisible) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.useProgram(this.corona.prog);
    gl.uniformMatrix4fv(this.corona.uniforms.uViewProj!, false, frame.viewProj);
    gl.uniform3fv(this.corona.uniforms.uCamera!, frame.cameraPos);
    gl.uniform3fv(this.corona.uniforms.uCenter!, frame.sun.center);
    gl.uniform1f(this.corona.uniforms.uRadius!, frame.sun.radius);
    gl.uniform1f(this.corona.uniforms.uTime!, frame.time);
    gl.uniform1f(this.corona.uniforms.uReducedMotion!, frame.reducedMotion ? 1 : 0);
    gl.bindVertexArray(this.coronaVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.stats.drawCalls++;
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    }

    // Planetary rings (alpha-blended, double-sided, depth-test but no write).
    // Drawn after the atmosphere to match the WebGPU draw order. The ring tilt
    // is composed with the planet's orientation so rings stay locked to the
    // equator as the planet spins or is dragged.
    const anyRings = frame.planets.some((p) => p.hasRing && p.visibility > 0.02);
    if (anyRings) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(this.ring.prog);
      gl.uniformMatrix4fv(this.ring.uniforms.uViewProj!, false, frame.viewProj);
      gl.uniform3fv(this.ring.uniforms.uCamera!, frame.cameraPos);
      gl.uniform3fv(this.ring.uniforms.uLight!, frame.keyLightDir);
      gl.uniform1f(this.ring.uniforms.uTime!, frame.time);
      this.bindShadowUniforms(this.ring, frame);
      gl.bindVertexArray(this.ringVao);
      const ringIdxType = this.ringU32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      for (const p of frame.planets) {
        if (!p.hasRing) continue;
        const vis = p.visibility;
        if (vis <= 0.02) continue;
        const er = p.radius * vis;
        const ringRot = quat.multiply(
          p.orientation,
          quat.fromAxisAngle([1, 0, 0.2], p.ringTilt),
        );
        // Optional second ring on a different plane: rotate the primary ring
        // about a perpendicular axis so the two rings cross at an angle.
        const ringRots = p.secondRing
          ? [
              ringRot,
              quat.multiply(
                ringRot,
                quat.fromAxisAngle([0, 0, 1], p.secondRingTilt),
              ),
            ]
          : [ringRot];
        for (const [r, rr] of ringRots.entries()) {
          mat4.fromRotationTranslationScale(model, rr, p.center, er);
          gl.uniformMatrix4fv(this.ring.uniforms.uModel!, false, model);
          gl.uniform3fv(this.ring.uniforms.uLow!, p.paletteLow);
          gl.uniform3fv(this.ring.uniforms.uMid!, p.paletteMid);
          gl.uniform3fv(this.ring.uniforms.uHigh!, p.paletteHigh);
          gl.uniform1f(this.ring.uniforms.uSeed!, (p.seed + r * 7919) % 100000);
          gl.uniform1f(this.ring.uniforms.uThin!, p.thinRing ? 1 : 0);
          gl.uniform1f(this.ring.uniforms.uFocus!, p.focus);
          gl.drawElements(gl.TRIANGLES, this.ringCount, ringIdxType, 0);
          this.stats.drawCalls++;
          this.stats.triangles += this.ringCount / 3;
        }
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    }

    // POIs (additive points, depth-tested so planets occlude them).
    this.uploadPois(frame);
    if (this.poiCount > 0) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      // Connector lines first, markers on top.
      if (this.poiLineVerts > 0) {
        gl.useProgram(this.line.prog);
        gl.uniformMatrix4fv(this.line.uniforms.uViewProj!, false, frame.viewProj);
        gl.uniform1f(this.line.uniforms.uAspect!, this.width / this.height);
        gl.uniform1f(this.line.uniforms.uThick!, 0.0035);
        gl.uniform1f(this.line.uniforms.uHeight!, this.height);
        gl.uniform1f(this.line.uniforms.uWireframe!, frame.wireframe ? 1 : 0);
        gl.bindVertexArray(this.poiLineVao);
        gl.drawArrays(gl.TRIANGLES, 0, this.poiLineVerts);
        this.stats.drawCalls++;
      }
      gl.useProgram(this.point.prog);
      gl.uniformMatrix4fv(this.point.uniforms.uViewProj!, false, frame.viewProj);
      gl.uniform1f(this.point.uniforms.uTime!, frame.time);
      gl.uniform1f(this.point.uniforms.uMode!, 1);
      gl.uniform1f(this.point.uniforms.uHeight!, this.height);
      gl.uniform1f(this.point.uniforms.uWireframe!, frame.wireframe ? 1 : 0);
      gl.bindVertexArray(this.poiVao);
      gl.drawArrays(gl.POINTS, 0, this.poiCount);
      gl.depthMask(true);
      this.stats.drawCalls++;
    }

    // Rocket trajectory ribbon. Drawn after everything else in the scene
    // pass so it overlays clouds/atmosphere, with depth less-equal + no
    // depth write so opaque planet bodies still occlude segments behind
    // them. Alpha blend (not additive) so the line stays calm and doesn't
    // bloom-bleed when crossing bright atmospheres.
    this.uploadFlightPath(frame.flightPath);
    if (this.flightSegments > 0 && this.flightVao) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );
      gl.useProgram(this.flight.prog);
      gl.uniformMatrix4fv(this.flight.uniforms.uViewProj!, false, frame.viewProj);
      gl.uniform1f(this.flight.uniforms.uAspect!, this.width / this.height);
      gl.uniform1f(this.flight.uniforms.uThick!, 0.0045);
      gl.uniform3fv(this.flight.uniforms.uCamera!, frame.cameraPos);
      gl.uniform1f(this.flight.uniforms.uWireframe!, frame.wireframe ? 1 : 0);
      gl.uniform1f(this.flight.uniforms.uTime!, frame.time);
      gl.uniform1f(this.flight.uniforms.uReducedMotion!, frame.reducedMotion ? 1 : 0);
      gl.bindVertexArray(this.flightVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.flightSegments + 1);
      gl.depthMask(true);
      this.stats.drawCalls++;
      this.stats.triangles += this.flightSegments * 2 + 1;
    }

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    // Resolve the multisampled scene into the single-sample texture, then
    // present it to the canvas with the sRGB gamma encode (matches the
    // pow(1/2.2) tail of the WebGPU composite pass).
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFbo);
    gl.blitFramebuffer(
      0, 0, this.width, this.height,
      0, 0, this.width, this.height,
      gl.COLOR_BUFFER_BIT, gl.NEAREST,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.present.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(this.present.uniforms.uScene!, 0);
    const flare = computeSunFlare(frame);
    gl.uniform3f(this.present.uniforms.uFlare!, flare.u, flare.v, flare.strength);
    gl.uniform1f(this.present.uniforms.uAspect!, this.width / this.height);
    gl.uniform1f(this.present.uniforms.uBarrel!, frame.crtBarrel);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.drawCalls++;
  }

  // Build per-segment instance data (prev.xyz, next.xyz) from the trajectory
  // polyline. Only re-allocates the buffer/VAO when the polyline length
  // changes; in practice that happens once on first frame.
  private uploadFlightPath(path: Float32Array): void {
    const gl = this.gl;
    const points = path.length / 3;
    if (points < 2) {
      this.flightSegments = 0;
      return;
    }
    if (points === this.flightPoints && this.flightVao && this.flightBuf) {
      // Buffer still valid from a previous frame (e.g. user toggled the path
      // off and back on). Restore the segment count so the draw runs again.
      this.flightSegments = points - 1;
      return;
    }
    const segments = points - 1;
    // Cumulative arc length per point, normalized to 0..1, so the fragment
    // shader can place a pulse at a constant world-space speed along the path.
    const arc = new Float32Array(points);
    for (let i = 1; i < points; i++) {
      const dx = path[i * 3 + 0]! - path[(i - 1) * 3 + 0]!;
      const dy = path[i * 3 + 1]! - path[(i - 1) * 3 + 1]!;
      const dz = path[i * 3 + 2]! - path[(i - 1) * 3 + 2]!;
      arc[i] = arc[i - 1]! + Math.hypot(dx, dy, dz);
    }
    const total = arc[points - 1]! || 1;
    for (let i = 0; i < points; i++) arc[i] = arc[i]! / total;
    // One extra instance for the arrowhead at the end of the path.
    const data = new Float32Array((segments + 1) * 9);
    for (let i = 0; i < segments; i++) {
      const o = i * 9;
      data[o + 0] = path[i * 3 + 0]!;
      data[o + 1] = path[i * 3 + 1]!;
      data[o + 2] = path[i * 3 + 2]!;
      data[o + 3] = path[(i + 1) * 3 + 0]!;
      data[o + 4] = path[(i + 1) * 3 + 1]!;
      data[o + 5] = path[(i + 1) * 3 + 2]!;
      data[o + 6] = 0;
      data[o + 7] = arc[i]!;
      data[o + 8] = arc[i + 1]!;
    }
    // Arrowhead: prev = first point (start), next = second point.
    const a = segments * 9;
    data[a + 0] = path[0]!;
    data[a + 1] = path[1]!;
    data[a + 2] = path[2]!;
    data[a + 3] = path[3]!;
    data[a + 4] = path[4]!;
    data[a + 5] = path[5]!;
    data[a + 6] = 1;
    data[a + 7] = 0;
    data[a + 8] = arc[1]!;
    if (this.flightBuf) gl.deleteBuffer(this.flightBuf);
    if (this.flightVao) gl.deleteVertexArray(this.flightVao);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = 9 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 24);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 28);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 32);
    gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);
    this.flightVao = vao;
    this.flightBuf = buf;
    this.flightSegments = segments;
    this.flightPoints = points;
  }

  private drawSphere(
    p: PlanetInstance,
    center: [number, number, number],
    radius: number,
    rotation: Quat,
    low: [number, number, number],
    mid: [number, number, number],
    high: [number, number, number],
    oceans: boolean,
    cloudShadow: number,
    model: Float32Array,
    lod: number,
    cityLights: boolean = false,
    flow: boolean = false,
    craters: boolean = false,
  ): void {
    const gl = this.gl;
    mat4.fromRotationTranslationScale(model, rotation, center, radius);
    gl.uniformMatrix4fv(this.planet.uniforms.uModel!, false, model);
    gl.uniform3fv(this.planet.uniforms.uLow!, low);
    gl.uniform3fv(this.planet.uniforms.uMid!, mid);
    gl.uniform3fv(this.planet.uniforms.uHigh!, high);
    gl.uniform1f(this.planet.uniforms.uSeed!, p.seed % 100000);
    gl.uniform1f(this.planet.uniforms.uFocus!, p.focus);
    gl.uniform1f(this.planet.uniforms.uOceans!, oceans ? 1 : 0);
    gl.uniform1f(this.planet.uniforms.uCityLights!, cityLights ? 1 : 0);
    gl.uniform1f(this.planet.uniforms.uFlow!, flow ? 1 : 0);
    gl.uniform1f(this.planet.uniforms.uCraters!, craters ? 1 : 0);
    gl.uniform1f(this.planet.uniforms.uCloudShadow!, cloudShadow);
    const mesh = this.sphereLods[lod]!;
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(
      gl.TRIANGLES,
      mesh.count,
      mesh.u32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      0,
    );
    this.stats.drawCalls++;
    this.stats.triangles += mesh.count / 3;
  }

  // Draws the sphere mesh as wireframe edges with the active wire program at
  // the given LOD level. Binds the matching wireframe VAO itself.
  private drawWire(
    center: [number, number, number],
    radius: number,
    rotation: Quat,
    model: Float32Array,
    lod: number,
  ): void {
    const gl = this.gl;
    mat4.fromRotationTranslationScale(model, rotation, center, radius);
    gl.uniformMatrix4fv(this.wire.uniforms.uModel!, false, model);
    const mesh = this.sphereLods[lod]!;
    gl.bindVertexArray(mesh.wireVao);
    gl.drawElements(
      gl.LINES,
      mesh.lineCount,
      mesh.lineU32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      0,
    );
    this.stats.drawCalls++;
  }

  // Pack the frame's shadow casters into the scratch vec4[8] and upload them
  // to the currently bound program. Pass count = 0 (and skip the vec4 upload)
  // when the quality tier disables shadows or no casters are present.
  private bindShadowUniforms(prog: Program, frame: FrameState): void {
    const gl = this.gl;
    const cnt = Math.min(frame.shadowCasters.length, 8);
    gl.uniform1i(prog.uniforms.uShadowCount!, cnt);
    if (cnt === 0) return;
    const s = this.shadowScratch;
    for (let i = 0; i < cnt; i++) {
      const c = frame.shadowCasters[i]!;
      s[i * 4 + 0] = c.center[0];
      s[i * 4 + 1] = c.center[1];
      s[i * 4 + 2] = c.center[2];
      s[i * 4 + 3] = c.radius;
    }
    gl.uniform4fv(prog.uniforms['uShadowSpheres[0]']!, s, 0, cnt * 4);
  }

  private uploadPois(frame: FrameState): void {
    const pos: number[] = [];
    const attr: number[] = [];
    const color: number[] = [];
    const line: number[] = [];
    // 6 vertices per connector quad: (side, end) pairs forming two triangles.
    const ends = [0, 1, 1, 0, 1, 0];
    const sides = [-1, -1, 1, -1, 1, 1];
    for (const p of frame.planets) {
      const vis = p.visibility;
      if (vis <= 0.02) continue;
      // Only the focused ("current") planet shows its POIs.
      const fade = poiFocusFade(p.focus);
      if (fade <= 0.001) continue;
      const er = p.radius * vis;
      const markerDist = poiMarkerDistance(er);
      const rot = p.orientation;
      for (let i = 0; i < p.pois.length; i++) {
        const poi = p.pois[i]!;
        const dir = quat.rotateVec3(rot, poi.dir);
        const surfDir = quat.rotateVec3(rot, poi.surfaceDir);
        const inner = vec3.add(p.center, vec3.scale(surfDir, er));
        const outer = vec3.add(p.center, vec3.scale(dir, markerDist));
        const dim = fade;
        // NDC half-extent, matching the WebGPU POI billboard size so markers
        // are a fixed fraction of the viewport height regardless of distance.
        const sizePx = (0.027 + 0.021 * p.focus) * vis;
        pos.push(outer[0], outer[1], outer[2]);
        attr.push(sizePx, dim, i + 1, 0);
        color.push(poi.accent[0], poi.accent[1], poi.accent[2]);
        // Connector quad: surface vertex (faint) -> rim vertex (bright).
        const ar = poi.accent[0];
        const ag = poi.accent[1];
        const ab = poi.accent[2];
        for (let v = 0; v < 6; v++) {
          const isOuter = ends[v]! > 0.5;
          line.push(
            inner[0], inner[1], inner[2],
            outer[0], outer[1], outer[2],
            sides[v]!, ends[v]!, sizePx,
            ar, ag, ab, dim * (isOuter ? 0.9 : 0.25),
          );
        }
      }
    }
    this.poiCount = pos.length / 3;
    this.poiLineVerts = line.length / 13;
    if (this.poiCount === 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.poiPos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.poiAttr);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(attr), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.poiColor);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(color), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.poiLineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(line), gl.DYNAMIC_DRAW);
  }

  private estimateMemoryMB(): number {
    return (this.width * this.height * 4 + this.starCount * 40) / (1024 * 1024);
  }

  getStats(): RenderStats {
    return this.stats;
  }

  onDeviceLost(cb: () => void): void {
    this.deviceLostCb = cb;
  }

  destroy(): void {
    const ext = this.gl?.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}
