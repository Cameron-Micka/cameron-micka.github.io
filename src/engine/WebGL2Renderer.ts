import type { FrameState, PlanetInstance, RenderStats, SceneRenderer } from './types';
import { createSphere, interleave, trianglesToLineIndices } from './geometry';
import { mat4 } from './math/mat4';
import { quat, type Quat } from './math/quat';
import { vec3 } from './math/vec3';
import { mulberry32 } from './math/rng';
import { poiMarkerDistance, poiFocusFade } from './Scene';

// Lower-fidelity mirror of the WebGPU experience: procedural planets, a nebula
// backdrop, additive star + POI points. No HDR/bloom post — rendered directly.
const MOON_ROCK_LOW: [number, number, number] = [0.22, 0.23, 0.24];
const MOON_ROCK_MID: [number, number, number] = [0.44, 0.43, 0.41];
const MOON_ROCK_HIGH: [number, number, number] = [0.64, 0.62, 0.58];

const NEBULA_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID == 2) ? 3.0 : -1.0, (gl_VertexID == 1) ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 1.0, 1.0);
}`;

// Volumetric nebula backdrop — ray-marches a screen-space 3D fbm density
// field for billowing warm-core / cool-edge clouds. Inspired by
// https://www.shadertoy.com/view/wX2Bzy.
const NEBULA_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform float uTime;
uniform float uAspect;
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
  vec2 uv=vec2((vUv.x-0.5)*uAspect,vUv.y-0.48);
  float tt=uTime;
  // Two slightly different speeds let the field both drift sideways and
  // evolve in depth so the clouds look alive without distracting motion.
  float time=tt*0.08;
  vec2 drift=vec2(tt*0.012,tt*-0.006);
  vec3 ro=vec3(0.0,0.0,-1.4);
  vec3 rd=normalize(vec3(uv.x,uv.y,1.2));
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
    float n=fbm3(p*1.05+vec3(drift.x,drift.y,time));
    float dens=smoothstep(0.46,0.78,n);
    float rad=length(p.xy);
    float coreFade=exp(-rad*0.60);
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
  float bgRad=length(uv);
  vec3 bg=mix(deep,cool*0.55,smoothstep(0.0,1.4,bgRad));
  col+=bg*(1.0-alpha);
  float vig=1.0-0.35*smoothstep(0.6,1.4,length(uv));
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
  // (roughness 0.12, F0 0.02 for IOR ~1.33); land = rough dielectric.
  vec3 albedo=base;
  float metallic=0.0;
  float roughness=mix(0.92,0.12,waterMask);
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
  vec3 direct=(kD*albedo/PI+specular)*sunRadiance*NdL*shadow;
  vec3 ambient=albedo*0.01;
  vec3 col=ambient+direct;
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
out vec4 frag;
// 3x5 bitmap glyphs for 1..9 packed row-major into 15 bits (bit row*3+col).
int digitBits(int d){
  if(d==1)return 29850;
  if(d==2)return 29671;
  if(d==3)return 31207;
  if(d==4)return 18925;
  if(d==5)return 31183;
  if(d==6)return 31695;
  if(d==7)return 9383;
  if(d==8)return 31727;
  if(d==9)return 31215;
  return 0;
}
float digitMask(vec2 uv,int d){
  // gl_PointCoord origin is upper-left, so uv.y=-1 is the top of the marker.
  float halfW=0.20;float halfH=0.30;
  float cx=(uv.x+halfW)/(halfW*2.0)*3.0;
  float cy=(uv.y+halfH)/(halfH*2.0)*5.0;
  if(cx<0.0||cx>=3.0||cy<0.0||cy>=5.0)return 0.0;
  int col=int(floor(cx));int row=int(floor(cy));
  int bits=digitBits(d);
  int mask=1<<(row*3+col);
  return ((bits&mask)!=0)?1.0:0.0;
}
void main(){
  vec2 uv=gl_PointCoord*2.0-1.0;
  float d=length(uv);
  if(vAttr.z>0.5){
    float radius=0.85;
    float aa=fwidth(d);
    float outline=(1.0-smoothstep(aa,aa+aa,abs(d-radius)))*vAttr.y;
    float glyph=digitMask(uv,int(vDigit+0.5))*vAttr.y;
    float a=max(outline,glyph);
    frag=vec4(vec3(a),a);
  }else{
    float core=pow(smoothstep(1.0,0.0,d),4.0)*vAttr.x;
    frag=vec4(mix(vec3(0.7,0.8,1.0),vColor,0.5)*core*1.6,core);
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
}`;

const LINE_FRAG = `#version 300 es
precision highp float;
in vec4 vColor;
in float vEdge;
out vec4 frag;
void main(){
  float aa=fwidth(vEdge);
  float cov=1.0-smoothstep(1.0-aa,1.0,abs(vEdge));
  float a=vColor.a*cov;
  frag=vec4((vColor.rgb+0.15)*a,a);
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
  col*=limbSun;
  // Distance fog (additive shell -> attenuate).
  float dist=distance(vWorld,ro);float fs=dist*0.030;
  col*=exp(-fs*fs);
  frag=vec4(aces(col),1.0);
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

  private sphereVao!: WebGLVertexArrayObject;
  private sphereCount = 0;
  private sphereU32 = false;
  private sphereWireVao!: WebGLVertexArrayObject;
  private sphereLineCount = 0;
  private sphereLineU32 = false;

  private starVao!: WebGLVertexArrayObject;
  private starCount = 0;
  private poiVao!: WebGLVertexArrayObject;
  private poiPos!: WebGLBuffer;
  private poiAttr!: WebGLBuffer;
  private poiColor!: WebGLBuffer;
  private poiCount = 0;
  private poiLineVao!: WebGLVertexArrayObject;
  private poiLineBuf!: WebGLBuffer;
  private poiLineVerts = 0;

  private stats: RenderStats = { drawCalls: 0, triangles: 0, gpuMemoryMB: 0 };
  private deviceLostCb: (() => void) | null = null;

  // Scratch for uShadowSpheres[8] uploads (8 vec4 = 32 floats).
  private shadowScratch = new Float32Array(32);

  async init(canvas: HTMLCanvasElement): Promise<void> {
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

    this.nebula = this.makeProgram(NEBULA_VERT, NEBULA_FRAG, ['uTime', 'uAspect']);
    this.planet = this.makeProgram(PLANET_VERT, PLANET_FRAG, [
      'uViewProj', 'uModel', 'uCamera', 'uLight', 'uLow', 'uMid', 'uHigh',
      'uSeed', 'uFocus', 'uOceans',
      'uShadowCount', 'uShadowSpheres[0]',
    ]);
    this.point = this.makeProgram(POINT_VERT, POINT_FRAG, [
      'uViewProj', 'uTime', 'uMode',
    ]);
    this.line = this.makeProgram(LINE_VERT, LINE_FRAG, [
      'uViewProj', 'uAspect', 'uThick', 'uHeight',
    ]);
    this.wire = this.makeProgram(PLANET_VERT, WIRE_FRAG, ['uViewProj', 'uModel']);
    this.atmosphere = this.makeProgram(PLANET_VERT, ATMOSPHERE_FRAG, [
      'uViewProj', 'uModel', 'uCamera', 'uLight', 'uColor', 'uCenter',
      'uInner', 'uOuter', 'uFocus', 'uIntensity',
      'uShadowCount', 'uShadowSpheres[0]',
    ]);

    this.buildSphere();
    this.buildStars(2000);
    this.buildPoiBuffers();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
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
      const u = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const radius = 140 + rand() * 80;
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
    gl.uniform1f(this.nebula.uniforms.uAspect!, this.width / this.height);
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
    this.bindShadowUniforms(this.planet, frame);
    gl.bindVertexArray(this.sphereVao);
    const idxType = this.sphereU32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    for (const p of frame.planets) {
      const vis = p.visibility;
      if (vis <= 0.02) continue;
      const er = p.radius * vis;
      this.drawSphere(p, p.center, er, p.orientation, p.paletteLow, p.paletteMid, p.paletteHigh, p.oceans, model, idxType);
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
          model,
          idxType,
        );
      }
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
        gl.bindVertexArray(this.poiLineVao);
        gl.drawArrays(gl.TRIANGLES, 0, this.poiLineVerts);
        this.stats.drawCalls++;
      }
      gl.useProgram(this.point.prog);
      gl.uniformMatrix4fv(this.point.uniforms.uViewProj!, false, frame.viewProj);
      gl.uniform1f(this.point.uniforms.uTime!, frame.time);
      gl.uniform1f(this.point.uniforms.uMode!, 1);
      gl.bindVertexArray(this.poiVao);
      gl.drawArrays(gl.POINTS, 0, this.poiCount);
      gl.depthMask(true);
      this.stats.drawCalls++;
    }

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
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
    model: Float32Array,
    idxType: number,
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
