import type { FrameState, LoadProgressFn, PlanetInstance, RenderStats, SceneRenderer } from './types';
import { createSphere, interleave, trianglesToLineIndices } from './geometry';
import { mat4 } from './math/mat4';
import { quat, type Quat } from './math/quat';
import { vec3 } from './math/vec3';
import { mulberry32 } from './math/rng';
import { poiMarkerDistance, poiFocusFade } from './Scene';
import { paintYield } from './paintYield';

// Lower-fidelity mirror of the WebGPU experience: procedural planets, a nebula
// backdrop, additive star + POI points. No HDR/bloom post — rendered directly.
const MOON_ROCK_LOW: [number, number, number] = [0.22, 0.23, 0.24];
const MOON_ROCK_MID: [number, number, number] = [0.44, 0.43, 0.41];
const MOON_ROCK_HIGH: [number, number, number] = [0.64, 0.62, 0.58];
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
uniform float uCityLights;
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
const float FOG_DENSITY=0.030;
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
void main(){
  vec3 n=normalize(vNrm);
  vec3 viewDir=normalize(uCamera-vWorld);
  vec3 lightDir=normalize(uLight);
  float rim=pow(1.0-clamp(dot(n,viewDir),0.0,1.0),3.0);
  // Two-level fBm domain warping (after Inigo Quilez,
  // https://iquilezles.org/articles/warp/) — 3D so it samples cleanly on the
  // sphere surface. 2.5x warp magnitude bends the noise field strongly
  // through itself for the curling, marbled organic structure.
  vec3 sp=vLocal*2.2+vec3(uSeed*0.001);
  vec3 q=vec3(fbm(sp),fbm(sp+vec3(5.2,1.3,2.8)),fbm(sp+vec3(7.1,4.4,6.9)));
  vec3 warpQ=sp+2.5*q;
  vec3 r=vec3(fbm(warpQ+vec3(1.7,9.2,3.5)),fbm(warpQ+vec3(8.3,2.8,4.1)),fbm(warpQ+vec3(4.7,7.7,1.9)));
  float h=clamp(fbm(sp+2.5*r),0.0,1.0);
  vec3 land=mix(uLow,uMid,smoothstep(0.25,0.55,h));
  land=mix(land,uHigh,smoothstep(0.6,0.85,h));
  // q magnitude darkens "trench" pockets, r magnitude brightens "highland"
  // streaks. Subtle so the authored palette still drives planet identity.
  float qLen=clamp(length(q)*0.55,0.0,1.0);
  float rLen=clamp(length(r)*0.55,0.0,1.0);
  land=mix(land,uLow*0.55,qLen*0.22);
  land=mix(land,uHigh*1.15,rLen*0.20);
  // Biome variation: slow 3-channel noise tints continents with climate-zone
  // shifts so landmasses don't all look identical.
  float biomeR=vnoise(vLocal*0.55+vec3(11.3,3.7,5.1));
  float biomeG=vnoise(vLocal*0.55+vec3(24.7,6.2,9.4));
  float biomeB=vnoise(vLocal*0.55+vec3(37.1,8.9,2.6));
  vec3 biomeColor=mix(uLow,uHigh,vec3(biomeR,biomeG,biomeB));
  land=mix(land,biomeColor,0.18);
  // Mountain ranges: 2-octave ridged noise sampled at low freq for continuous
  // continental scars; tight ridge-spine threshold paints only the range
  // spine, not the surrounding foothills.
  float ridge=ridgedFbm(warpQ*0.5);
  float mountainMask=smoothstep(0.62,0.74,ridge)*smoothstep(0.42,0.62,h);
  vec3 mountainRock=mix(uMid*0.55,vec3(0.48,0.28,0.16),0.75);
  land=mix(land,mountainRock,mountainMask*0.85);
  float snowMask=smoothstep(0.78,0.95,h)*smoothstep(0.58,0.74,ridge);
  land=mix(land,vec3(0.94,0.95,0.97),snowMask*0.9);
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
  // Cook-Torrance PBR direct lighting from key sun. Water = smooth dielectric
  // (roughness floor 0.35 to keep GGX highlight FWHM wider than a UV-sphere
  // triangle face, see planet.wgsl for the FWHM derivation); land = rough.
  vec3 albedo=base;
  float metallic=0.0;
  float roughness=mix(0.92,0.35,waterMask);
  vec3 F0base=mix(vec3(0.04),vec3(0.02),waterMask);
  vec3 F0=mix(F0base,albedo,metallic);
  vec3 L=lightDir;vec3 V=viewDir;vec3 H=normalize(L+V);
  float NdL=clamp(dot(n,L),0.0,1.0);
  float NdV=max(dot(n,V),1e-4);
  float NdH=clamp(dot(n,H),0.0,1.0);
  float VdH=clamp(dot(V,H),0.0,1.0);
  float D=dGGX(NdH,roughness);
  float G=gSmith(NdV,NdL,roughness);
  vec3 F=fSchlick(VdH,F0);
  vec3 specular=(D*G)*F/max(4.0*NdV*NdL,1e-3);
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
  vec3 ambient=albedo*0.01*ambientShadowMul;
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
    float landFactor=1.0-waterMask;
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
layout(location=1) in vec4 aAttr; // x size, y phase/dim, z digit (POIs only), w unused
layout(location=2) in vec3 aColor;
uniform mat4 uViewProj;
uniform float uTime;
uniform float uMode; // 0 star, 1 poi
out vec4 vAttr;
out vec3 vColor;
out float vDigit;
void main(){
  vec4 clip=uViewProj*vec4(aPos,1.0);
  gl_Position=clip;
  float twinkle=(uMode<0.5)?(0.6+0.4*sin(uTime*2.0+aAttr.y*6.28)):1.0;
  gl_PointSize=clamp(aAttr.x/max(clip.w,0.001),1.0,64.0);
  vAttr=vec4(twinkle,aAttr.y,uMode,aAttr.x);
  vColor=aColor;
  vDigit=aAttr.z;
}`;

const POINT_FRAG = `#version 300 es
precision highp float;
in vec4 vAttr;in vec3 vColor;in float vDigit;
uniform float uWireframe;
out vec4 frag;
// Roman numerals I..IX rendered as a union of line-segment SDFs in a
// normalized glyph-local box [-1,1]x[-1,1]. Each numeral lists its strokes;
// the fragment unions them by min-distance and masks the pixel by
// smoothstep of distance vs. stroke half-width. Variable-width numerals
// (VIII especially) fit cleanly without bitmap rasterization artifacts.
float segDist(vec2 p,vec2 a,vec2 b){
  vec2 pa=p-a;vec2 ba=b-a;
  float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.0,1.0);
  return length(pa-ba*h);
}
float iStem(vec2 p,float x){
  // Capital-I stroke: vertical body plus short horizontal top + bottom
  // serifs so multi-I numerals don't read as pause-button bars.
  float body=segDist(p,vec2(x,-1.0),vec2(x,1.0));
  float top=segDist(p,vec2(x-0.2,1.0),vec2(x+0.2,1.0));
  float bot=segDist(p,vec2(x-0.2,-1.0),vec2(x+0.2,-1.0));
  return min(body,min(top,bot));
}
float romanDist(vec2 p,int d){
  float dm=1e9;
  if(d==1){
    dm=min(dm,iStem(p,0.0));
  }else if(d==2){
    dm=min(dm,iStem(p,-0.5));
    dm=min(dm,iStem(p,0.5));
  }else if(d==3){
    dm=min(dm,iStem(p,-0.8));
    dm=min(dm,iStem(p,0.0));
    dm=min(dm,iStem(p,0.8));
  }else if(d==4){
    dm=min(dm,iStem(p,-0.6));
    dm=min(dm,segDist(p,vec2(-0.05,1.0),vec2(0.3,-1.0)));
    dm=min(dm,segDist(p,vec2(0.65,1.0),vec2(0.3,-1.0)));
  }else if(d==5){
    dm=min(dm,segDist(p,vec2(-0.6,1.0),vec2(0.0,-1.0)));
    dm=min(dm,segDist(p,vec2(0.6,1.0),vec2(0.0,-1.0)));
  }else if(d==6){
    dm=min(dm,segDist(p,vec2(-0.65,1.0),vec2(-0.3,-1.0)));
    dm=min(dm,segDist(p,vec2(0.05,1.0),vec2(-0.3,-1.0)));
    dm=min(dm,iStem(p,0.6));
  }else if(d==7){
    dm=min(dm,segDist(p,vec2(-0.75,1.0),vec2(-0.45,-1.0)));
    dm=min(dm,segDist(p,vec2(-0.15,1.0),vec2(-0.45,-1.0)));
    dm=min(dm,iStem(p,0.25));
    dm=min(dm,iStem(p,0.75));
  }else if(d==8){
    dm=min(dm,segDist(p,vec2(-0.85,1.0),vec2(-0.6,-1.0)));
    dm=min(dm,segDist(p,vec2(-0.35,1.0),vec2(-0.6,-1.0)));
    dm=min(dm,iStem(p,0.0));
    dm=min(dm,iStem(p,0.4));
    dm=min(dm,iStem(p,0.8));
  }else if(d==9){
    dm=min(dm,iStem(p,-0.7));
    dm=min(dm,segDist(p,vec2(-0.2,1.0),vec2(0.6,-1.0)));
    dm=min(dm,segDist(p,vec2(0.6,1.0),vec2(-0.2,-1.0)));
  }
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
    // Map marker uv into a normalized glyph-local box [-1,1]x[-1,1]. halfW
    // is wide enough to fit even VIII (the broadest numeral) without
    // crowding the ring at radius 0.85. gl_PointCoord origin is upper-left,
    // so we flip Y here to match the glyph-local convention where +y = top.
    float halfW=0.28;float halfH=0.30;
    vec2 gp=vec2(uv.x/halfW,-uv.y/halfH);
    int dig=int(vDigit+0.5);
    float glyphDist=romanDist(gp,dig);
    // One screen pixel in glyph-local units (isotropic AA).
    vec2 dgx=dFdx(gp);vec2 dgy=dFdy(gp);
    float aaG=sqrt(dot(dgx,dgx)+dot(dgy,dgy))*0.5;
    float strokeW=0.16;
    float glyphAlpha=(1.0-smoothstep(strokeW-aaG,strokeW+aaG,glyphDist))*vAttr.y;
    float a=max(outline,glyphAlpha);
    frag=vec4(vec3(a),a);
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
  // Marker point size matches the POINT shader's clamp; rim sits at uv 0.85.
  float pointPx=clamp(aParam.z/max(co.w,0.001),1.0,64.0);
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
  vec3 base=vColor.rgb+0.15;
  frag=vec4(base*a,a);
}`;

// Spacecraft trajectory ribbon. Camera-facing quad per polyline segment,
// instanced via prev/next world positions. Mirrors flight_path.wgsl.
const FLIGHT_VERT = `#version 300 es
layout(location=0) in vec3 aPrev;
layout(location=1) in vec3 aNext;
layout(location=2) in float aKind; // 0 = ribbon segment, 1 = arrowhead
uniform mat4 uViewProj;
uniform float uAspect;
uniform float uThick; // half-thickness in aspect-corrected NDC
out float vEdge;
out vec3 vWorld;
out float vAxial;
out float vShape; // 0 = ribbon, 1 = arrowhead
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
}`;

const FLIGHT_FRAG = `#version 300 es
precision highp float;
in float vEdge;
in vec3 vWorld;
in float vAxial;
in float vShape;
uniform vec3 uCamera;
uniform float uWireframe;
out vec4 frag;
const float FOG_DENSITY=0.030;
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
  frag=vec4(vec3(1.0)*a,a);
}`;

const WIRE_FRAG = `#version 300 es
precision highp float;
out vec4 frag;
void main(){ frag=vec4(0.25,1.0,0.85,1.0); }`;

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
  vec3 col=albedo*(0.05+0.95*NdL)*selfShadow;
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
  float alpha=density*dayMask*edgeFade*uVisibility;
  // Distance fog attenuation on the alpha so far clouds don't punch holes
  // in the haze.
  float dist=distance(vWorld,uCamera);float sd=dist*0.030;
  alpha*=exp(-sd*sd);
  frag=vec4(col,alpha);
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
  private flight!: Program;

  private sphereVao!: WebGLVertexArrayObject;
  private sphereCount = 0;
  private sphereU32 = false;
  private sphereWireVao!: WebGLVertexArrayObject;
  private sphereLineCount = 0;
  private sphereLineU32 = false;

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
      'uSeed', 'uFocus', 'uOceans', 'uCityLights',
      'uTime', 'uReducedMotion', 'uCloudShadow',
      'uShadowCount', 'uShadowSpheres[0]',
    ]);
    this.point = this.makeProgram(POINT_VERT, POINT_FRAG, [
      'uViewProj', 'uTime', 'uMode', 'uWireframe',
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
    this.flight = this.makeProgram(FLIGHT_VERT, FLIGHT_FRAG, [
      'uViewProj', 'uAspect', 'uThick', 'uCamera', 'uWireframe',
    ]);

    await report(0.75, 'Building scene geometry…');
    this.buildSphere();
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

  private buildSphere(): void {
    const gl = this.gl;
    const geo = createSphere(40, 56);
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
    this.sphereVao = vao;
    this.sphereCount = geo.indexCount;
    this.sphereU32 = geo.indices instanceof Uint32Array;

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
    this.sphereWireVao = wireVao;
    this.sphereLineCount = lineIdx.length;
    this.sphereLineU32 = lineIdx instanceof Uint32Array;
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
  }

  render(frame: FrameState): void {
    const gl = this.gl;
    this.stats = { drawCalls: 0, triangles: 0, gpuMemoryMB: this.estimateMemoryMB() };
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
    if (frame.wireframe) {
      // Debug wireframe: planets and moons as edges.
      gl.depthMask(true);
      gl.useProgram(this.wire.prog);
      gl.uniformMatrix4fv(this.wire.uniforms.uViewProj!, false, frame.viewProj);
      gl.bindVertexArray(this.sphereWireVao);
      for (const p of frame.planets) {
        const vis = p.visibility;
        if (vis <= 0.02) continue;
        this.drawWire(p.center, p.radius * vis, p.orientation, model);
        for (const m of p.moons) {
          const orbit = m.orbitRadius * vis;
          const localOffset: [number, number, number] = [
            Math.cos(m.angle) * orbit,
            Math.sin(m.angle * 0.5) * orbit * 0.2,
            Math.sin(m.angle) * orbit,
          ];
          const wo = quat.rotateVec3(p.orientation, localOffset);
          const moonRot = quat.multiply(
            p.orientation,
            quat.fromAxisAngle([0, 1, 0], frame.time * 0.3),
          );
          this.drawWire(
            [p.center[0] + wo[0], p.center[1] + wo[1], p.center[2] + wo[2]],
            m.size * vis,
            moonRot,
            model,
          );
        }
      }
    } else {
    gl.useProgram(this.planet.prog);
    gl.uniformMatrix4fv(this.planet.uniforms.uViewProj!, false, frame.viewProj);
    gl.uniform3fv(this.planet.uniforms.uCamera!, frame.cameraPos);
    gl.uniform3fv(this.planet.uniforms.uLight!, frame.keyLightDir);
    gl.uniform1f(this.planet.uniforms.uReducedMotion!, frame.reducedMotion ? 1 : 0);
    this.bindShadowUniforms(this.planet, frame);
    gl.bindVertexArray(this.sphereVao);
    const idxType = this.sphereU32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
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
      this.drawSphere(p, p.center, er, p.orientation, p.paletteLow, p.paletteMid, p.paletteHigh, p.oceans, cloudShadow, model, idxType, p.cityLights);
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
        const moonRot = quat.multiply(
          p.orientation,
          quat.fromAxisAngle([0, 1, 0], frame.time * 0.3),
        );
        this.drawSphere(
          p,
          [p.center[0] + wo[0], p.center[1] + wo[1], p.center[2] + wo[2]],
          m.size * vis,
          moonRot,
          MOON_ROCK_LOW,
          MOON_ROCK_MID,
          MOON_ROCK_HIGH,
          false,
          0, // moons don't get cloud shadows
          model,
          idxType,
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
      gl.useProgram(this.clouds.prog);
      gl.uniformMatrix4fv(this.clouds.uniforms.uViewProj!, false, frame.viewProj);
      gl.uniform3fv(this.clouds.uniforms.uCamera!, frame.cameraPos);
      gl.uniform3fv(this.clouds.uniforms.uLight!, frame.keyLightDir);
      gl.uniform1f(this.clouds.uniforms.uReducedMotion!, frame.reducedMotion ? 1 : 0);
      this.bindShadowUniforms(this.clouds, frame);
      gl.bindVertexArray(this.sphereVao);
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
        gl.drawElements(gl.TRIANGLES, this.sphereCount, idxType, 0);
        this.stats.drawCalls++;
        this.stats.triangles += this.sphereCount / 3;
      }
      gl.disable(gl.CULL_FACE);
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
    gl.bindVertexArray(this.sphereVao);
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
      gl.drawElements(gl.TRIANGLES, this.sphereCount, idxType, 0);
      this.stats.drawCalls++;
    }
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
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
      gl.uniform1f(this.flight.uniforms.uThick!, 0.0032);
      gl.uniform3fv(this.flight.uniforms.uCamera!, frame.cameraPos);
      gl.uniform1f(this.flight.uniforms.uWireframe!, frame.wireframe ? 1 : 0);
      gl.bindVertexArray(this.flightVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.flightSegments + 1);
      gl.depthMask(true);
      this.stats.drawCalls++;
      this.stats.triangles += this.flightSegments * 2 + 1;
    }

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
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
    // One extra instance for the arrowhead at the end of the path.
    const data = new Float32Array((segments + 1) * 7);
    for (let i = 0; i < segments; i++) {
      const o = i * 7;
      data[o + 0] = path[i * 3 + 0]!;
      data[o + 1] = path[i * 3 + 1]!;
      data[o + 2] = path[i * 3 + 2]!;
      data[o + 3] = path[(i + 1) * 3 + 0]!;
      data[o + 4] = path[(i + 1) * 3 + 1]!;
      data[o + 5] = path[(i + 1) * 3 + 2]!;
      data[o + 6] = 0;
    }
    // Arrowhead: prev = first point (start), next = second point.
    const a = segments * 7;
    data[a + 0] = path[0]!;
    data[a + 1] = path[1]!;
    data[a + 2] = path[2]!;
    data[a + 3] = path[3]!;
    data[a + 4] = path[4]!;
    data[a + 5] = path[5]!;
    data[a + 6] = 1;
    if (this.flightBuf) gl.deleteBuffer(this.flightBuf);
    if (this.flightVao) gl.deleteVertexArray(this.flightVao);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = 7 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 24);
    gl.vertexAttribDivisor(2, 1);
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
    idxType: number,
    cityLights: boolean = false,
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
    gl.uniform1f(this.planet.uniforms.uCloudShadow!, cloudShadow);
    gl.drawElements(gl.TRIANGLES, this.sphereCount, idxType, 0);
    this.stats.drawCalls++;
    this.stats.triangles += this.sphereCount / 3;
  }

  // Draws the sphere mesh as wireframe edges with the active wire program.
  // Assumes the wire program and sphereWireVao are already bound.
  private drawWire(
    center: [number, number, number],
    radius: number,
    rotation: Quat,
    model: Float32Array,
  ): void {
    const gl = this.gl;
    mat4.fromRotationTranslationScale(model, rotation, center, radius);
    gl.uniformMatrix4fv(this.wire.uniforms.uModel!, false, model);
    gl.drawElements(
      gl.LINES,
      this.sphereLineCount,
      this.sphereLineU32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
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
        const sizePx = 90 * (0.7 + p.focus) * vis;
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
