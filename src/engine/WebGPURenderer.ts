import type {
  FrameState,
  PlanetInstance,
  RenderStats,
  SceneRenderer,
} from './types';
import { createSphere, interleave, trianglesToLineIndices, type GeometryData } from './geometry';
import { mat4 } from './math/mat4';
import { quat } from './math/quat';
import { vec3 } from './math/vec3';
import { mulberry32 } from './math/rng';
import { poiMarkerDistance, poiFocusFade } from './Scene';

import planetWGSL from './shaders/planet.wgsl?raw';
import nebulaWGSL from './shaders/nebula.wgsl?raw';
import starfieldWGSL from './shaders/starfield.wgsl?raw';
import poiWGSL from './shaders/poi.wgsl?raw';
import poiLineWGSL from './shaders/poi_line.wgsl?raw';
import ringWGSL from './shaders/ring.wgsl?raw';
import compositeWGSL from './shaders/composite.wgsl?raw';
import wireframeWGSL from './shaders/wireframe.wgsl?raw';

const OBJ_STRIDE = 256; // bytes; >= minUniformBufferOffsetAlignment
const OBJ_FLOATS = OBJ_STRIDE / 4;
const MAX_OBJECTS = 64;
const HDR_FORMAT: GPUTextureFormat = 'rgba16float';

function createRingGeometry(inner = 1.35, outer = 2.1, segments = 96): GeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    positions.push(c * inner, 0, s * inner);
    normals.push(0, 1, 0);
    uvs.push(0, i / segments);
    positions.push(c * outer, 0, s * outer);
    normals.push(0, 1, 0);
    uvs.push(1, i / segments);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
    vertexCount: positions.length / 3,
    indexCount: indices.length,
  };
}

export class WebGPURenderer implements SceneRenderer {
  readonly backend = 'webgpu' as const;

  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private canvas!: HTMLCanvasElement;

  private width = 1;
  private height = 1;

  private hdrTex!: GPUTexture;
  private hdrView!: GPUTextureView;
  private msaaTex?: GPUTexture;
  private msaaView?: GPUTextureView;
  private depthTex!: GPUTexture;
  private depthView!: GPUTextureView;
  private sampleCount = 1;

  private sphere!: { vbuf: GPUBuffer; ibuf: GPUBuffer; count: number; u32: boolean };
  private ring!: { vbuf: GPUBuffer; ibuf: GPUBuffer; count: number };
  private sphereLines!: { ibuf: GPUBuffer; count: number; u32: boolean };
  private ringLines!: { ibuf: GPUBuffer; count: number };
  private quadBuf!: GPUBuffer;

  private frameUBO!: GPUBuffer;
  private objUBO!: GPUBuffer;
  private postUBO!: GPUBuffer;

  private starBuf!: GPUBuffer;
  private starCount = 0;
  private poiBuf!: GPUBuffer;
  private poiCapacity = 0;

  private frameBG!: GPUBindGroup;
  private objBG!: GPUBindGroup;
  private compositeBG!: GPUBindGroup;
  private sampler!: GPUSampler;

  private pipelines!: {
    nebula: GPURenderPipeline;
    planet: GPURenderPipeline;
    clouds: GPURenderPipeline;
    ring: GPURenderPipeline;
    star: GPURenderPipeline;
    poi: GPURenderPipeline;
    poiLine: GPURenderPipeline;
    composite: GPURenderPipeline;
    wireframe: GPURenderPipeline;
  };
  private frameLayout!: GPUBindGroupLayout;
  private objLayout!: GPUBindGroupLayout;
  private compositeLayout!: GPUBindGroupLayout;

  private objScratch = new Float32Array(OBJ_FLOATS * MAX_OBJECTS);
  private frameScratch = new Float32Array(64);
  private postScratch = new Float32Array(8);

  private stats: RenderStats = { drawCalls: 0, triangles: 0, gpuMemoryMB: 0 };
  private deviceLostCb: (() => void) | null = null;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (!navigator.gpu) throw new Error('WebGPU not available');
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    if (!adapter) throw new Error('No WebGPU adapter');
    const device = await adapter.requestDevice();
    this.device = device;
    this.canvas = canvas;

    device.lost.then((info) => {
      if (info.reason !== 'destroyed') this.deviceLostCb?.();
    });

    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('No WebGPU canvas context');
    this.context = ctx;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format: this.format, alphaMode: 'opaque' });

    this.createGeometry();
    this.createUniforms();
    this.createPipelines(this.sampleCount);
    this.buildStars(8000);
  }

  private createGeometry(): void {
    const d = this.device;
    const sphereGeo = createSphere(48, 64);
    const sphereData = interleave(sphereGeo);
    const svb = d.createBuffer({
      size: sphereData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(svb, 0, sphereData);
    const sib = d.createBuffer({
      size: sphereGeo.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(sib, 0, sphereGeo.indices);
    this.sphere = {
      vbuf: svb,
      ibuf: sib,
      count: sphereGeo.indexCount,
      u32: sphereGeo.indices instanceof Uint32Array,
    };
    this.sphereLines = this.createLineIndexBuffer(sphereGeo);

    const ringGeo = createRingGeometry();
    const ringData = interleave(ringGeo);
    const rvb = d.createBuffer({
      size: ringData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(rvb, 0, ringData);
    const rib = d.createBuffer({
      size: ringGeo.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(rib, 0, ringGeo.indices);
    this.ring = { vbuf: rvb, ibuf: rib, count: ringGeo.indexCount };
    const ringLines = this.createLineIndexBuffer(ringGeo);
    this.ringLines = { ibuf: ringLines.ibuf, count: ringLines.count };

    // Unit quad (two triangles) for billboards.
    const quad = new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]);
    const qb = d.createBuffer({
      size: quad.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(qb, 0, quad);
    this.quadBuf = qb;
  }

  private createLineIndexBuffer(geo: GeometryData): {
    ibuf: GPUBuffer;
    count: number;
    u32: boolean;
  } {
    const d = this.device;
    const lines = trianglesToLineIndices(geo.indices, geo.vertexCount);
    const buf = d.createBuffer({
      size: lines.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(buf, 0, lines);
    return { ibuf: buf, count: lines.length, u32: lines instanceof Uint32Array };
  }

  private createUniforms(): void {
    const d = this.device;
    this.frameUBO = d.createBuffer({
      size: this.frameScratch.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.objUBO = d.createBuffer({
      size: OBJ_STRIDE * MAX_OBJECTS,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.postUBO = d.createBuffer({
      size: this.postScratch.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sampler = d.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  private createPipelines(sampleCount: number): void {
    const d = this.device;
    const multisample = { count: sampleCount };

    this.frameLayout = d.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
    this.objLayout = d.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', hasDynamicOffset: true },
        },
      ],
    });
    this.compositeLayout = d.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });

    this.frameBG = d.createBindGroup({
      layout: this.frameLayout,
      entries: [{ binding: 0, resource: { buffer: this.frameUBO } }],
    });
    this.objBG = d.createBindGroup({
      layout: this.objLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.objUBO, size: OBJ_STRIDE },
        },
      ],
    });

    const meshLayout: GPUVertexBufferLayout = {
      arrayStride: 8 * 4,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x2' },
      ],
    };

    const sceneObjPL = d.createPipelineLayout({
      bindGroupLayouts: [this.frameLayout, this.objLayout],
    });
    const sceneFramePL = d.createPipelineLayout({
      bindGroupLayouts: [this.frameLayout],
    });

    const planetMod = d.createShaderModule({ code: planetWGSL });
    const ringMod = d.createShaderModule({ code: ringWGSL });
    const nebulaMod = d.createShaderModule({ code: nebulaWGSL });
    const starMod = d.createShaderModule({ code: starfieldWGSL });
    const poiMod = d.createShaderModule({ code: poiWGSL });
    const poiLineMod = d.createShaderModule({ code: poiLineWGSL });
    const compositeMod = d.createShaderModule({ code: compositeWGSL });
    const wireframeMod = d.createShaderModule({ code: wireframeWGSL });

    const addBlend: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    };
    const alphaBlend: GPUBlendState = {
      color: {
        srcFactor: 'src-alpha',
        dstFactor: 'one-minus-src-alpha',
        operation: 'add',
      },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };

    const planet = d.createRenderPipeline({
      layout: sceneObjPL,
      vertex: { module: planetMod, entryPoint: 'vs', buffers: [meshLayout] },
      fragment: {
        module: planetMod,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
      multisample,
    });

    const clouds = d.createRenderPipeline({
      layout: sceneObjPL,
      vertex: { module: planetMod, entryPoint: 'vs', buffers: [meshLayout] },
      fragment: {
        module: planetMod,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT, blend: alphaBlend }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
      multisample,
    });

    const ring = d.createRenderPipeline({
      layout: sceneObjPL,
      vertex: { module: ringMod, entryPoint: 'vs', buffers: [meshLayout] },
      fragment: {
        module: ringMod,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT, blend: alphaBlend }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
      multisample,
    });

    const nebula = d.createRenderPipeline({
      layout: sceneFramePL,
      vertex: { module: nebulaMod, entryPoint: 'vs' },
      fragment: {
        module: nebulaMod,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
      multisample,
    });

    const starInstanceLayout: GPUVertexBufferLayout = {
      arrayStride: 7 * 4,
      stepMode: 'instance',
      attributes: [
        { shaderLocation: 1, offset: 0, format: 'float32x3' },
        { shaderLocation: 2, offset: 12, format: 'float32x4' },
      ],
    };
    const quadLayout: GPUVertexBufferLayout = {
      arrayStride: 2 * 4,
      attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
    };

    const star = d.createRenderPipeline({
      layout: sceneFramePL,
      vertex: {
        module: starMod,
        entryPoint: 'vs',
        buffers: [quadLayout, starInstanceLayout],
      },
      fragment: {
        module: starMod,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT, blend: addBlend }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
      multisample,
    });

    const poiInstanceLayout: GPUVertexBufferLayout = {
      arrayStride: 12 * 4,
      stepMode: 'instance',
      attributes: [
        { shaderLocation: 1, offset: 12, format: 'float32x3' }, // outer (marker)
        { shaderLocation: 2, offset: 24, format: 'float32x4' }, // size,dim,accentRG
        { shaderLocation: 3, offset: 40, format: 'float32' }, // accentB
      ],
    };

    const poi = d.createRenderPipeline({
      layout: sceneFramePL,
      vertex: {
        module: poiMod,
        entryPoint: 'vs',
        buffers: [quadLayout, poiInstanceLayout],
      },
      fragment: {
        module: poiMod,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT, blend: addBlend }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
      multisample,
    });

    const poiLineInstanceLayout: GPUVertexBufferLayout = {
      arrayStride: 12 * 4,
      stepMode: 'instance',
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, // inner (surface)
        { shaderLocation: 1, offset: 12, format: 'float32x3' }, // outer (marker)
        { shaderLocation: 2, offset: 24, format: 'float32x4' }, // size,dim,accentRG
        { shaderLocation: 3, offset: 40, format: 'float32' }, // accentB
      ],
    };

    const poiLine = d.createRenderPipeline({
      layout: sceneFramePL,
      vertex: {
        module: poiLineMod,
        entryPoint: 'vs',
        buffers: [poiLineInstanceLayout],
      },
      fragment: {
        module: poiLineMod,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT, blend: addBlend }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
      multisample,
    });

    const compositePL = d.createPipelineLayout({
      bindGroupLayouts: [this.compositeLayout],
    });
    const composite = d.createRenderPipeline({
      layout: compositePL,
      vertex: { module: compositeMod, entryPoint: 'vs' },
      fragment: {
        module: compositeMod,
        entryPoint: 'fs',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const wireframe = d.createRenderPipeline({
      layout: sceneObjPL,
      vertex: { module: wireframeMod, entryPoint: 'vs', buffers: [meshLayout] },
      fragment: {
        module: wireframeMod,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
      multisample,
    });

    this.pipelines = { nebula, planet, clouds, ring, star, poi, poiLine, composite, wireframe };
  }

  private buildStars(count: number): void {
    const d = this.device;
    const rand = mulberry32(1337);
    const data = new Float32Array(count * 7);
    for (let i = 0; i < count; i++) {
      // Random point on a large shell.
      const u = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const radius = 140 + rand() * 80;
      const x = Math.cos(theta) * r * radius;
      const y = u * radius;
      const z = Math.sin(theta) * r * radius;
      const size = 0.0009 + Math.pow(rand(), 3) * 0.0035;
      const phase = rand();
      const tintR = 0.7 + rand() * 0.3;
      const tintB = 0.8 + rand() * 0.2;
      data.set([x, y, z, size, phase, tintR, tintB], i * 7);
    }
    if (this.starBuf) this.starBuf.destroy();
    this.starBuf = d.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(this.starBuf, 0, data);
    this.starCount = count;
  }

  resize(width: number, height: number): void {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    this.hdrTex?.destroy();
    this.depthTex?.destroy();
    this.msaaTex?.destroy();
    this.msaaTex = undefined;
    this.msaaView = undefined;
    // hdrTex is always single-sampled: it is both the composite source and the
    // resolve target when MSAA is enabled.
    this.hdrTex = this.device.createTexture({
      size: [width, height],
      format: HDR_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.hdrView = this.hdrTex.createView();
    if (this.sampleCount > 1) {
      this.msaaTex = this.device.createTexture({
        size: [width, height],
        format: HDR_FORMAT,
        sampleCount: this.sampleCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.msaaView = this.msaaTex.createView();
    }
    this.depthTex = this.device.createTexture({
      size: [width, height],
      format: 'depth24plus',
      sampleCount: this.sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depthTex.createView();

    this.compositeBG = this.device.createBindGroup({
      layout: this.compositeLayout,
      entries: [
        { binding: 0, resource: { buffer: this.postUBO } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.hdrView },
      ],
    });
  }

  // MSAA sample count is baked into pipelines and render targets, so a tier
  // change rebuilds both. WebGPU only guarantees counts of 1 and 4, so anything
  // other than 4 is treated as off.
  private ensureSampleCount(count: number): void {
    const n = count === 4 ? 4 : 1;
    if (n === this.sampleCount) return;
    this.sampleCount = n;
    this.createPipelines(n);
    this.resize(this.width, this.height);
  }

  private writeObject(
    index: number,
    model: Float32Array,
    radius: number,
    seed: number,
    time: number,
    kind: number,
    low: [number, number, number],
    mid: [number, number, number],
    high: [number, number, number],
    focus: number,
    hasAtmo: number,
    rotationY: number,
  ): void {
    const base = index * OBJ_FLOATS;
    const s = this.objScratch;
    s.set(model, base);
    s[base + 16] = radius;
    s[base + 17] = seed;
    s[base + 18] = time;
    s[base + 19] = kind;
    s[base + 20] = low[0];
    s[base + 21] = low[1];
    s[base + 22] = low[2];
    s[base + 23] = 1;
    s[base + 24] = mid[0];
    s[base + 25] = mid[1];
    s[base + 26] = mid[2];
    s[base + 27] = 1;
    s[base + 28] = high[0];
    s[base + 29] = high[1];
    s[base + 30] = high[2];
    s[base + 31] = 1;
    s[base + 32] = focus;
    s[base + 33] = hasAtmo;
    s[base + 34] = rotationY;
    s[base + 35] = 0;
  }

  render(frame: FrameState): void {
    const d = this.device;
    this.stats = { drawCalls: 0, triangles: 0, gpuMemoryMB: 0 };

    this.ensureSampleCount(frame.quality.msaa);

    // Frame uniform.
    const f = this.frameScratch;
    f.set(frame.viewProj, 0);
    f[16] = frame.cameraPos[0];
    f[17] = frame.cameraPos[1];
    f[18] = frame.cameraPos[2];
    f[19] = 1;
    f[20] = frame.keyLightDir[0];
    f[21] = frame.keyLightDir[1];
    f[22] = frame.keyLightDir[2];
    f[23] = 0;
    f[24] = frame.time;
    f[25] = frame.reducedMotion ? 1 : 0;
    f[26] = 1;
    f[27] = this.width / this.height;
    d.queue.writeBuffer(this.frameUBO, 0, f, 0, 28);

    // Build per-object uniforms + collect POI billboards.
    const objects: { kind: number; index: number }[] = [];
    const poiData: number[] = [];
    let objIndex = 0;
    const model = mat4.create();

    for (const p of frame.planets) {
      if (objIndex >= MAX_OBJECTS - 4) break;
      const vis = p.visibility;
      if (vis <= 0.02) continue; // fully hidden — skip planet, POIs, moons
      const er = p.radius * vis;
      const rot = p.orientation;
      mat4.fromRotationTranslationScale(model, rot, p.center, er);
      this.writeObject(
        objIndex,
        model,
        p.radius,
        p.seed % 100000,
        frame.time,
        0,
        p.paletteLow,
        p.paletteMid,
        p.paletteHigh,
        p.focus,
        1,
        0,
      );
      objects.push({ kind: 0, index: objIndex });
      objIndex++;

      this.collectPois(p, poiData, er, vis);

      if (p.hasClouds && frame.quality.clouds) {
        mat4.fromRotationTranslationScale(
          model,
          quat.multiply(
            p.orientation,
            quat.fromAxisAngle([0, 1, 0], frame.time * 0.03),
          ),
          p.center,
          er * 1.04,
        );
        this.writeObject(
          objIndex,
          model,
          p.radius,
          p.seed % 100000,
          frame.time,
          1,
          p.paletteHigh,
          p.paletteHigh,
          p.paletteHigh,
          p.focus,
          0,
          0,
        );
        objects.push({ kind: 1, index: objIndex });
        objIndex++;
      }

      if (p.hasRing && objIndex < MAX_OBJECTS) {
        const ringRot = quat.fromAxisAngle([1, 0, 0.2], p.ringTilt);
        mat4.fromRotationTranslationScale(model, ringRot, p.center, er);
        this.writeObject(
          objIndex,
          model,
          p.radius,
          p.seed % 100000,
          frame.time,
          2,
          p.paletteLow,
          p.paletteMid,
          p.paletteHigh,
          p.focus,
          0,
          0,
        );
        objects.push({ kind: 2, index: objIndex });
        objIndex++;
      }

      for (const m of p.moons) {
        if (objIndex >= MAX_OBJECTS) break;
        const orbit = m.orbitRadius * vis;
        const mx = p.center[0] + Math.cos(m.angle) * orbit;
        const mz = p.center[2] + Math.sin(m.angle) * orbit;
        const my = p.center[1] + Math.sin(m.angle * 0.5) * orbit * 0.2;
        mat4.fromRotationTranslationScale(
          model,
          quat.fromAxisAngle([0, 1, 0], frame.time * 0.3),
          [mx, my, mz],
          m.size * vis,
        );
        this.writeObject(
          objIndex,
          model,
          m.size,
          (p.seed + 7) % 100000,
          frame.time,
          0,
          p.paletteMid,
          p.paletteLow,
          p.paletteHigh,
          p.focus,
          1,
          0,
        );
        objects.push({ kind: 3, index: objIndex });
        objIndex++;
      }
    }

    d.queue.writeBuffer(
      this.objUBO,
      0,
      this.objScratch,
      0,
      objIndex * OBJ_FLOATS,
    );
    this.uploadPois(poiData);

    // Post uniform.
    const post = this.postScratch;
    post[0] = frame.blur;
    post[1] = 0.55;
    post[2] = frame.quality.chromaticAberration ? 0.0035 : 0;
    post[3] = frame.quality.bloomMips > 0 ? 0.8 : 0;
    post[4] = 1 / this.width;
    post[5] = 1 / this.height;
    d.queue.writeBuffer(this.postUBO, 0, post);

    const encoder = d.createCommandEncoder();

    // Scene pass into HDR. With MSAA, render into the multisampled target and
    // resolve into the single-sampled hdrTex that the composite pass samples.
    const msaa = this.sampleCount > 1 && this.msaaView;
    const scenePass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: msaa ? this.msaaView! : this.hdrView,
          resolveTarget: msaa ? this.hdrView : undefined,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: msaa ? 'discard' : 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    // Nebula.
    scenePass.setPipeline(this.pipelines.nebula);
    scenePass.setBindGroup(0, this.frameBG);
    scenePass.draw(3);
    this.stats.drawCalls++;
    this.stats.triangles += 1;

    // Stars.
    if (frame.quality.starCount > 0 && this.starCount > 0) {
      const drawStars = Math.min(this.starCount, frame.quality.starCount);
      scenePass.setPipeline(this.pipelines.star);
      scenePass.setBindGroup(0, this.frameBG);
      scenePass.setVertexBuffer(0, this.quadBuf);
      scenePass.setVertexBuffer(1, this.starBuf);
      scenePass.draw(6, drawStars);
      this.stats.drawCalls++;
      this.stats.triangles += drawStars * 2;
    }

    if (frame.wireframe) {
      // Debug wireframe: draw every mesh as edges instead of filled surfaces.
      scenePass.setPipeline(this.pipelines.wireframe);
      scenePass.setVertexBuffer(0, this.sphere.vbuf);
      scenePass.setIndexBuffer(
        this.sphereLines.ibuf,
        this.sphereLines.u32 ? 'uint32' : 'uint16',
      );
      for (const o of objects) {
        if (o.kind === 2) continue; // rings use their own mesh below
        scenePass.setBindGroup(0, this.frameBG);
        scenePass.setBindGroup(1, this.objBG, [o.index * OBJ_STRIDE]);
        scenePass.drawIndexed(this.sphereLines.count);
        this.stats.drawCalls++;
      }
      let wireRingBound = false;
      for (const o of objects) {
        if (o.kind !== 2) continue;
        if (!wireRingBound) {
          scenePass.setVertexBuffer(0, this.ring.vbuf);
          scenePass.setIndexBuffer(this.ringLines.ibuf, 'uint16');
          wireRingBound = true;
        }
        scenePass.setBindGroup(0, this.frameBG);
        scenePass.setBindGroup(1, this.objBG, [o.index * OBJ_STRIDE]);
        scenePass.drawIndexed(this.ringLines.count);
        this.stats.drawCalls++;
      }
    } else {
      // Opaque planets + moons.
      scenePass.setVertexBuffer(0, this.sphere.vbuf);
      scenePass.setIndexBuffer(
        this.sphere.ibuf,
        this.sphere.u32 ? 'uint32' : 'uint16',
      );
      for (const o of objects) {
        if (o.kind !== 0 && o.kind !== 3) continue;
        scenePass.setPipeline(this.pipelines.planet);
        scenePass.setBindGroup(0, this.frameBG);
        scenePass.setBindGroup(1, this.objBG, [o.index * OBJ_STRIDE]);
        scenePass.drawIndexed(this.sphere.count);
        this.stats.drawCalls++;
        this.stats.triangles += this.sphere.count / 3;
      }

      // Clouds (alpha).
      for (const o of objects) {
        if (o.kind !== 1) continue;
        scenePass.setPipeline(this.pipelines.clouds);
        scenePass.setBindGroup(0, this.frameBG);
        scenePass.setBindGroup(1, this.objBG, [o.index * OBJ_STRIDE]);
        scenePass.drawIndexed(this.sphere.count);
        this.stats.drawCalls++;
        this.stats.triangles += this.sphere.count / 3;
      }

      // Rings (alpha).
      let ringBound = false;
      for (const o of objects) {
        if (o.kind !== 2) continue;
        if (!ringBound) {
          scenePass.setVertexBuffer(0, this.ring.vbuf);
          scenePass.setIndexBuffer(this.ring.ibuf, 'uint16');
          ringBound = true;
        }
        scenePass.setPipeline(this.pipelines.ring);
        scenePass.setBindGroup(0, this.frameBG);
        scenePass.setBindGroup(1, this.objBG, [o.index * OBJ_STRIDE]);
        scenePass.drawIndexed(this.ring.count);
        this.stats.drawCalls++;
        this.stats.triangles += this.ring.count / 3;
      }
    }

    // POI connector lines (additive), drawn under the markers.
    if (this.poiCount > 0) {
      scenePass.setPipeline(this.pipelines.poiLine);
      scenePass.setBindGroup(0, this.frameBG);
      scenePass.setVertexBuffer(0, this.poiBuf);
      scenePass.draw(6, this.poiCount);
      this.stats.drawCalls++;
      this.stats.triangles += this.poiCount * 2;
    }

    // POIs (additive billboards).
    if (this.poiCount > 0) {
      scenePass.setPipeline(this.pipelines.poi);
      scenePass.setBindGroup(0, this.frameBG);
      scenePass.setVertexBuffer(0, this.quadBuf);
      scenePass.setVertexBuffer(1, this.poiBuf);
      scenePass.draw(6, this.poiCount);
      this.stats.drawCalls++;
      this.stats.triangles += this.poiCount * 2;
    }

    scenePass.end();

    // Composite pass to swapchain.
    const view = this.context.getCurrentTexture().createView();
    const compositePass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    compositePass.setPipeline(this.pipelines.composite);
    compositePass.setBindGroup(0, this.compositeBG);
    compositePass.draw(3);
    this.stats.drawCalls++;
    compositePass.end();

    d.queue.submit([encoder.finish()]);

    this.stats.gpuMemoryMB = this.estimateMemoryMB();
  }

  private poiCount = 0;

  private collectPois(
    p: PlanetInstance,
    out: number[],
    effectiveRadius: number,
    vis: number,
  ): void {
    // Only the focused ("current") planet shows its POIs.
    const fade = poiFocusFade(p.focus);
    if (fade <= 0.001) return;
    const rot = p.orientation;
    const markerDist = poiMarkerDistance(effectiveRadius);
    for (const poi of p.pois) {
      const dir = quat.rotateVec3(rot, poi.dir);
      const surfDir = quat.rotateVec3(rot, poi.surfaceDir);
      const inner = vec3.add(p.center, vec3.scale(surfDir, effectiveRadius));
      const outer = vec3.add(p.center, vec3.scale(dir, markerDist));
      const dim = fade;
      const size = (0.038 + 0.03 * p.focus) * vis;
      out.push(
        inner[0],
        inner[1],
        inner[2],
        outer[0],
        outer[1],
        outer[2],
        size,
        dim,
        poi.accent[0],
        poi.accent[1],
        poi.accent[2],
        0,
      );
    }
  }

  private uploadPois(data: number[]): void {
    const count = data.length / 12;
    this.poiCount = count;
    if (count === 0) return;
    const arr = new Float32Array(data);
    if (count > this.poiCapacity) {
      this.poiBuf?.destroy();
      this.poiCapacity = Math.max(count, 32);
      this.poiBuf = this.device.createBuffer({
        size: this.poiCapacity * 12 * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    this.device.queue.writeBuffer(this.poiBuf, 0, arr);
  }

  private estimateMemoryMB(): number {
    const hdr = this.width * this.height * 8;
    const depth = this.width * this.height * 4 * this.sampleCount;
    const msaa = this.sampleCount > 1 ? hdr * this.sampleCount : 0;
    const stars = this.starCount * 7 * 4;
    return (hdr * 2 + msaa + depth + stars) / (1024 * 1024);
  }

  getStats(): RenderStats {
    return this.stats;
  }

  onDeviceLost(cb: () => void): void {
    this.deviceLostCb = cb;
  }

  destroy(): void {
    this.hdrTex?.destroy();
    this.msaaTex?.destroy();
    this.depthTex?.destroy();
    this.starBuf?.destroy();
    this.poiBuf?.destroy();
    this.device?.destroy();
  }
}
