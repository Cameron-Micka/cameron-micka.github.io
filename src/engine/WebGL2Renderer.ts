import type { FrameState, PlanetInstance, RenderStats, SceneRenderer } from './types';
import { createSphere, interleave } from './geometry';
import { mat4 } from './math/mat4';
import { quat, type Quat } from './math/quat';
import { vec3 } from './math/vec3';
import { mulberry32 } from './math/rng';
import { poiMarkerDistance, poiFocusFade } from './Scene';

// Lower-fidelity mirror of the WebGPU experience: procedural planets, a nebula
// backdrop, additive star + POI points. No HDR/bloom post — rendered directly.

const NEBULA_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID == 2) ? 3.0 : -1.0, (gl_VertexID == 1) ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 1.0, 1.0);
}`;

const NEBULA_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
float hash2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise2(vec2 p){
  vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash2(i),hash2(i+vec2(1,0)),u.x),mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),u.x),u.y);
}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise2(p);p*=2.03;a*=.5;}return v;}
void main(){
  vec2 uv=vUv;vec2 p=uv*3.0;
  float c=fbm(p+vec2(2.0,1.0));float c2=fbm(p*1.7-vec2(5.0,3.0));
  vec3 deep=vec3(0.012,0.016,0.035);
  vec3 col=deep;
  col=mix(col,vec3(0.10,0.06,0.22),smoothstep(0.45,0.85,c)*0.7);
  col=mix(col,vec3(0.04,0.12,0.30),smoothstep(0.5,0.95,c2)*0.5);
  float d=distance(uv,vec2(0.5,0.42));
  col+=vec3(0.10,0.14,0.22)*smoothstep(0.6,0.0,d)*0.5;
  float vig=1.0-0.5*smoothstep(0.35,0.9,distance(uv,vec2(0.5)));
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
uniform float uSeed;uniform float uFocus;uniform float uKind;uniform float uTime;
float hash3(vec3 p){vec3 q=fract(p*0.3183099+vec3(0.1,0.2,0.3));q*=17.0;return fract(q.x*q.y*q.z*(q.x+q.y+q.z));}
float vnoise(vec3 x){
  vec3 i=floor(x),f=fract(x);vec3 u=f*f*(3.0-2.0*f);
  float n000=hash3(i),n100=hash3(i+vec3(1,0,0)),n010=hash3(i+vec3(0,1,0)),n110=hash3(i+vec3(1,1,0));
  float n001=hash3(i+vec3(0,0,1)),n101=hash3(i+vec3(1,0,1)),n011=hash3(i+vec3(0,1,1)),n111=hash3(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z);
}
float fbm(vec3 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*vnoise(p);p*=2.02;a*=.5;}return v;}
vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
void main(){
  vec3 n=normalize(vNrm);
  vec3 viewDir=normalize(uCamera-vWorld);
  float ndl=clamp(dot(n,normalize(uLight)),0.0,1.0);
  float rim=pow(1.0-clamp(dot(n,viewDir),0.0,1.0),3.0);
  if(uKind==1.0){
    float t=uTime*0.02;
    float c=fbm(vLocal*3.0+vec3(t,uSeed,-t));
    float cov=smoothstep(0.55,0.85,c);
    float lit=0.35+0.65*ndl;
    frag=vec4(aces(vec3(lit)),cov*0.5);return;
  }
  vec3 sp=vLocal*2.2;
  float h=clamp(fbm(sp+vec3(uSeed*0.001))+fbm(sp*4.0)*0.25,0.0,1.0);
  vec3 base=mix(uLow,uMid,smoothstep(0.25,0.55,h));
  base=mix(base,uHigh,smoothstep(0.6,0.85,h));
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

  private sphereVao!: WebGLVertexArrayObject;
  private sphereCount = 0;
  private sphereU32 = false;

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

    this.nebula = this.makeProgram(NEBULA_VERT, NEBULA_FRAG, []);
    this.planet = this.makeProgram(PLANET_VERT, PLANET_FRAG, [
      'uViewProj', 'uModel', 'uCamera', 'uLight', 'uLow', 'uMid', 'uHigh',
      'uSeed', 'uFocus', 'uKind', 'uTime',
    ]);
    this.point = this.makeProgram(POINT_VERT, POINT_FRAG, [
      'uViewProj', 'uTime', 'uMode',
    ]);
    this.line = this.makeProgram(LINE_VERT, LINE_FRAG, [
      'uViewProj', 'uAspect', 'uThick', 'uHeight',
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
    gl.useProgram(this.planet.prog);
    gl.uniformMatrix4fv(this.planet.uniforms.uViewProj!, false, frame.viewProj);
    gl.uniform3fv(this.planet.uniforms.uCamera!, frame.cameraPos);
    gl.uniform3fv(this.planet.uniforms.uLight!, frame.keyLightDir);
    gl.uniform1f(this.planet.uniforms.uTime!, frame.time);
    gl.bindVertexArray(this.sphereVao);
    const idxType = this.sphereU32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    const model = mat4.create();
    for (const p of frame.planets) {
      const vis = p.visibility;
      if (vis <= 0.02) continue;
      const er = p.radius * vis;
      this.drawSphere(p, p.center, er, p.orientation, 0, p.paletteLow, p.paletteMid, p.paletteHigh, model, idxType);
      for (const m of p.moons) {
        const orbit = m.orbitRadius * vis;
        const mx = p.center[0] + Math.cos(m.angle) * orbit;
        const mz = p.center[2] + Math.sin(m.angle) * orbit;
        const my = p.center[1] + Math.sin(m.angle * 0.5) * orbit * 0.2;
        this.drawSphere(p, [mx, my, mz], m.size * vis, quat.fromAxisAngle([0, 1, 0], frame.time * 0.3), 0, p.paletteMid, p.paletteLow, p.paletteHigh, model, idxType);
      }
    }

    // Clouds (alpha) — second pass over planets that have clouds.
    if (frame.quality.clouds) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const p of frame.planets) {
        if (!p.hasClouds) continue;
        if (p.visibility <= 0.02) continue;
        this.drawSphere(p, p.center, p.radius * p.visibility * 1.04, quat.multiply(p.orientation, quat.fromAxisAngle([0, 1, 0], frame.time * 0.03)), 1, p.paletteHigh, p.paletteHigh, p.paletteHigh, model, idxType);
      }
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
    kind: number,
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
    gl.uniform1f(this.planet.uniforms.uKind!, kind);
    gl.drawElements(gl.TRIANGLES, this.sphereCount, idxType, 0);
    this.stats.drawCalls++;
    this.stats.triangles += this.sphereCount / 3;
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
