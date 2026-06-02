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
uniform float uSeed;uniform float uFocus;
float hash3(vec3 p){vec3 q=fract(p*0.3183099+vec3(0.1,0.2,0.3));q*=17.0;return fract(q.x*q.y*q.z*(q.x+q.y+q.z));}
float vnoise(vec3 x){
  vec3 i=floor(x),f=fract(x);vec3 u=f*f*(3.0-2.0*f);
  float n000=hash3(i),n100=hash3(i+vec3(1,0,0)),n010=hash3(i+vec3(0,1,0)),n110=hash3(i+vec3(1,1,0));
  float n001=hash3(i+vec3(0,0,1)),n101=hash3(i+vec3(1,0,1)),n011=hash3(i+vec3(0,1,1)),n111=hash3(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z);
}
float fbm(vec3 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*vnoise(p);p*=2.03;a*=.5;}return v;}
vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
void main(){
  vec3 n=normalize(vNrm);
  vec3 viewDir=normalize(uCamera-vWorld);
  float ndl=clamp(dot(n,normalize(uLight)),0.0,1.0);
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
  vec3 base=mix(uLow,uMid,smoothstep(0.25,0.55,h));
  base=mix(base,uHigh,smoothstep(0.6,0.85,h));
  // q magnitude darkens "trench" pockets, r magnitude brightens "highland"
  // streaks. Subtle so the authored palette still drives planet identity.
  float qLen=clamp(length(q)*0.55,0.0,1.0);
  float rLen=clamp(length(r)*0.55,0.0,1.0);
  base=mix(base,uLow*0.55,qLen*0.22);
  base=mix(base,uHigh*1.15,rLen*0.20);
  vec3 col=base*(0.12+0.95*ndl);
  col+=uHigh*rim*(0.6+0.8*ndl);
  vec3 hlf=normalize(normalize(uLight)+viewDir);
  col+=vec3(pow(clamp(dot(n,hlf),0.0,1.0),32.0)*0.25*ndl);
  col*=(0.85+0.3*uFocus);
  frag=vec4(aces(col),1.0);
}`;

const POINT_VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aAttr; // x size, y phase/dim, z tintR/accentG, w tintB/accentB
layout(location=2) in vec3 aColor;
uniform mat4 uViewProj;
uniform float uTime;
uniform float uMode; // 0 star, 1 poi
out vec4 vAttr;
out vec3 vColor;
void main(){
  vec4 clip=uViewProj*vec4(aPos,1.0);
  gl_Position=clip;
  float twinkle=(uMode<0.5)?(0.6+0.4*sin(uTime*2.0+aAttr.y*6.28)):1.0;
  gl_PointSize=clamp(aAttr.x/max(clip.w,0.001),1.0,64.0);
  vAttr=vec4(twinkle,aAttr.y,uMode,aAttr.x);
  vColor=aColor;
}`;

const POINT_FRAG = `#version 300 es
precision highp float;
in vec4 vAttr;in vec3 vColor;
out vec4 frag;
void main(){
  vec2 uv=gl_PointCoord*2.0-1.0;
  float d=length(uv);
  if(vAttr.z>0.5){
    float radius=0.85;
    float aa=fwidth(d);
    float a=(1.0-smoothstep(aa,aa+aa,abs(d-radius)))*vAttr.y;
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
vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
vec2 raySphere(vec3 ro,vec3 rd,vec3 ce,float ra){
  vec3 oc=ro-ce;float b=dot(oc,rd);float c=dot(oc,oc)-ra*ra;float h=b*b-c;
  if(h<0.0)return vec2(1.0,-1.0);
  float s=sqrt(h);return vec2(-b-s,-b+s);
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
    float sunAmt=smoothstep(-0.1,0.35,dot(normalize(up),sun));
    dayGlow+=density*sunAmt*dt;ambient+=density*dt;
  }
  dayGlow/=thickness;ambient/=thickness;
  vec3 atmoColor=mix(uColor,vec3(0.45,0.62,1.0),0.5);
  float intensity=uIntensity*(0.85+0.3*uFocus);
  vec3 col=atmoColor*(dayGlow*1.5+ambient*0.12)*intensity;
  float mie=pow(max(dot(rd,sun),0.0),8.0)*dayGlow*0.6;
  col+=atmoColor*mie*intensity;
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
      'uSeed', 'uFocus',
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
    gl.bindVertexArray(this.sphereVao);
    const idxType = this.sphereU32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    for (const p of frame.planets) {
      const vis = p.visibility;
      if (vis <= 0.02) continue;
      const er = p.radius * vis;
      this.drawSphere(p, p.center, er, p.orientation, p.paletteLow, p.paletteMid, p.paletteHigh, model, idxType);
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
      for (const poi of p.pois) {
        const dir = quat.rotateVec3(rot, poi.dir);
        const surfDir = quat.rotateVec3(rot, poi.surfaceDir);
        const inner = vec3.add(p.center, vec3.scale(surfDir, er));
        const outer = vec3.add(p.center, vec3.scale(dir, markerDist));
        const dim = fade;
        const sizePx = 90 * (0.7 + p.focus) * vis;
        pos.push(outer[0], outer[1], outer[2]);
        attr.push(sizePx, dim, 0, 0);
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
