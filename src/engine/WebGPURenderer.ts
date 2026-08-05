import type {
  FrameState,
  LoadProgressFn,
  PlanetInstance,
  RenderStats,
  SceneRenderer,
} from './types';
import {
  createSphere,
  createRingGeometry,
  interleave,
  trianglesToLineIndices,
  selectSphereLod,
  SPHERE_LODS,
  type GeometryData,
} from './geometry';
import { mat4 } from './math/mat4';
import { quat } from './math/quat';
import { vec3 } from './math/vec3';
import { mulberry32 } from './math/rng';
import { poiMarkerDistance, poiFocusFade } from './Scene';
import { computeSunFlare } from './lensFlare';
import { paintYield } from './paintYield';
import { QUALITY_PRESETS } from './QualityManager';

import planetWGSL from './shaders/planet.wgsl?raw';
import nebulaWGSL from './shaders/nebula.wgsl?raw';
import sunWGSL from './shaders/sun.wgsl?raw';
import starfieldWGSL from './shaders/starfield.wgsl?raw';
import poiWGSL from './shaders/poi.wgsl?raw';
import poiLineWGSL from './shaders/poi_line.wgsl?raw';
import flightPathWGSL from './shaders/flight_path.wgsl?raw';
import ringWGSL from './shaders/ring.wgsl?raw';
import compositeWGSL from './shaders/composite.wgsl?raw';
import backdropWGSL from './shaders/backdrop.wgsl?raw';
import postfxWGSL from './shaders/postfx.wgsl?raw';
import wireframeWGSL from './shaders/wireframe.wgsl?raw';
import atmosphereWGSL from './shaders/atmosphere.wgsl?raw';
import cloudsWGSL from './shaders/clouds.wgsl?raw';
import auroraWGSL from './shaders/aurora.wgsl?raw';

const OBJ_STRIDE = 256; // bytes; >= minUniformBufferOffsetAlignment
const OBJ_FLOATS = OBJ_STRIDE / 4;
const MAX_OBJECTS = 64;
const HDR_FORMAT: GPUTextureFormat = 'rgba16float';
// Must match CLOUD_SHELL_SCALE in clouds.wgsl and planet.wgsl: surface-point
// projection in the planet shader assumes the cloud shell sits at this radius
// (in unit-sphere local space) so the shadow lands exactly under the puff.
const CLOUD_SHELL_SCALE = 1.006;
// Per-planet satellite sprites cap. 6 planets * 7 sats = 42 worst case;
// rounded up for headroom. Buffer is sized once and reused across frames.
const MAX_SATELLITES = 64;
const SAT_FLOATS = 7;
const SAT_STRIDE = SAT_FLOATS * 4;

export class WebGPURenderer implements SceneRenderer {
  readonly backend = 'webgpu' as const;

  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private canvas!: HTMLCanvasElement;

  private width = 1;
  private height = 1;
  private dpr = 1;

  private hdrTex!: GPUTexture;
  private hdrView!: GPUTextureView;
  private msaaTex?: GPUTexture;
  private msaaView?: GPUTextureView;
  private depthTex!: GPUTexture;
  private depthView!: GPUTextureView;
  private sampleCount = 1;

  // Reduced-resolution target holding the nebula raymarch, upsampled into the
  // scene pass. Sized from CSS pixels so it doesn't scale with devicePixelRatio.
  private backdropTex!: GPUTexture;
  private backdropView!: GPUTextureView;
  private backdropW = 0;
  private backdropH = 0;
  // Reduced-resolution post chain: fxSrc holds a box-downsample of the scene,
  // fx holds bloom + god rays + lens flare (+ the blurred scene while a modal
  // is open). Both are sized from CSS pixels like the backdrop.
  private fxSrcTex!: GPUTexture;
  private fxSrcView!: GPUTextureView;
  private fxTex!: GPUTexture;
  private fxView!: GPUTextureView;
  private fxW = 0;
  private fxH = 0;
  private backdropScale = QUALITY_PRESETS.high.backdropScale;
  private postScale = QUALITY_PRESETS.high.postScale;

  // One sphere mesh per LOD level (index 0 = finest). Bodies pick a level from
  // their on-screen angular size, so distant planets/moons draw far fewer
  // triangles while close-up bodies keep the original tessellation.
  private sphereLods: {
    vbuf: GPUBuffer;
    ibuf: GPUBuffer;
    count: number;
    u32: boolean;
  }[] = [];
  private sphereLineLods: { ibuf: GPUBuffer; count: number; u32: boolean }[] = [];
  private ring!: { vbuf: GPUBuffer; ibuf: GPUBuffer; count: number };
  private ringLines!: { ibuf: GPUBuffer; count: number };
  private quadBuf!: GPUBuffer;

  private frameUBO!: GPUBuffer;
  private objUBO!: GPUBuffer;
  private postUBO!: GPUBuffer;

  private starBuf!: GPUBuffer;
  private starCount = 0;
  private satelliteBuf!: GPUBuffer;
  private satelliteScratch!: Float32Array;
  private poiBuf!: GPUBuffer;
  private poiCapacity = 0;
  // Rocket trajectory ribbon. Geometry never changes, so the buffer is
  // (re)allocated only when the polyline length changes.
  private flightPathBuf: GPUBuffer | null = null;
  private flightPathSegmentCount = 0;
  private flightPathPointCount = 0;

  private frameBG!: GPUBindGroup;
  private objBG!: GPUBindGroup;
  private compositeBG!: GPUBindGroup;
  private backdropBG!: GPUBindGroup;
  private downsampleBG!: GPUBindGroup;
  private fxBG!: GPUBindGroup;
  private sampler!: GPUSampler;

  private pipelines!: {
    nebula: GPURenderPipeline;
    backdrop: GPURenderPipeline;
    downsample: GPURenderPipeline;
    postfx: GPURenderPipeline;
    planet: GPURenderPipeline;
    sun: GPURenderPipeline;
    sunCorona: GPURenderPipeline;
    ring: GPURenderPipeline;
    star: GPURenderPipeline;
    satellite: GPURenderPipeline;
    poi: GPURenderPipeline;
    poiLine: GPURenderPipeline;
    flightPath: GPURenderPipeline;
    composite: GPURenderPipeline;
    wireframe: GPURenderPipeline;
    atmosphere: GPURenderPipeline;
    clouds: GPURenderPipeline;
    aurora: GPURenderPipeline;
  };
  private frameLayout!: GPUBindGroupLayout;
  private objLayout!: GPUBindGroupLayout;
  private compositeLayout!: GPUBindGroupLayout;
  private blitLayout!: GPUBindGroupLayout;
  private postLayout!: GPUBindGroupLayout;

  private objScratch = new Float32Array(OBJ_FLOATS * MAX_OBJECTS);
  // 64 base floats (viewProj 16 + cameraPos 4 + keyLightDir 4 + misc 4 +
  // shadowCasters 32 + shadowMisc 4) + 16 floats for invViewProj appended for
  // the nebula backdrop's world-direction unprojection. Shaders that don't
  // need invViewProj simply declare a shorter Frame struct.
  private frameScratch = new Float32Array(80);
  private postScratch = new Float32Array(16);

  private stats: RenderStats = { drawCalls: 0, triangles: 0, gpuMemoryMB: 0 };
  private deviceLostCb: (() => void) | null = null;

  async init(canvas: HTMLCanvasElement, onProgress?: LoadProgressFn): Promise<void> {
    const report = async (frac: number, label: string): Promise<void> => {
      if (!onProgress) return;
      onProgress(frac, label);
      // Let the loading bar paint before the next synchronous, main-thread
      // blocking stage (geometry build / shader compilation).
      await paintYield();
    };

    await report(0.08, 'Initializing WebGPU…');
    if (!navigator.gpu) throw new Error('WebGPU not available');
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    if (!adapter) throw new Error('No WebGPU adapter');
    await report(0.2, 'Requesting GPU device…');
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

    await report(0.35, 'Building scene geometry…');
    this.createGeometry();
    await report(0.5, 'Allocating buffers…');
    this.createUniforms();
    await report(0.6, 'Compiling shaders…');
    this.createPipelines(this.sampleCount);
    await report(0.9, 'Generating starfield…');
    this.buildStars(8000);
    await report(1, 'Entering the timeline…');
  }

  private createGeometry(): void {
    const d = this.device;
    // Build every sphere LOD up front (they are tiny and static). Moons and
    // distant planets simply bind a coarser level at draw time.
    this.sphereLods = [];
    this.sphereLineLods = [];
    for (const [latBands, lonBands] of SPHERE_LODS) {
      const geo = createSphere(latBands, lonBands);
      const data = interleave(geo);
      const vb = d.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      d.queue.writeBuffer(vb, 0, data);
      const ib = d.createBuffer({
        size: geo.indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
      d.queue.writeBuffer(ib, 0, geo.indices);
      this.sphereLods.push({
        vbuf: vb,
        ibuf: ib,
        count: geo.indexCount,
        u32: geo.indices instanceof Uint32Array,
      });
      this.sphereLineLods.push(this.createLineIndexBuffer(geo));
    }

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

    // Per-frame satellite instance buffer — fixed size, dynamically filled.
    this.satelliteBuf = d.createBuffer({
      size: MAX_SATELLITES * SAT_STRIDE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.satelliteScratch = new Float32Array(MAX_SATELLITES * SAT_FLOATS);
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
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });
    // Sampler + single source texture; used by the backdrop upsample blit.
    this.blitLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });
    // Post uniform + sampler + single source texture; shared by the scene
    // downsample and the FX pass, which differ only in their source texture.
    this.postLayout = d.createBindGroupLayout({
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
    const sunMod = d.createShaderModule({ code: sunWGSL });
    const ringMod = d.createShaderModule({ code: ringWGSL });
    const nebulaMod = d.createShaderModule({ code: nebulaWGSL });
    const starMod = d.createShaderModule({ code: starfieldWGSL });
    const poiMod = d.createShaderModule({ code: poiWGSL });
    const poiLineMod = d.createShaderModule({ code: poiLineWGSL });
    const flightPathMod = d.createShaderModule({ code: flightPathWGSL });
    const compositeMod = d.createShaderModule({ code: compositeWGSL });
    const backdropMod = d.createShaderModule({ code: backdropWGSL });
    const postfxMod = d.createShaderModule({ code: postfxWGSL });
    const wireframeMod = d.createShaderModule({ code: wireframeWGSL });
    const atmosphereMod = d.createShaderModule({ code: atmosphereWGSL });
    const cloudsMod = d.createShaderModule({ code: cloudsWGSL });
    const auroraMod = d.createShaderModule({ code: auroraWGSL });

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

    // Nebula backdrop. Rendered into its own reduced-resolution target — no
    // MSAA (it's a smooth fullscreen field with no edges to resolve) and no
    // depth attachment — then upsampled into the scene pass by `backdrop`.
    const nebula = d.createRenderPipeline({
      layout: sceneFramePL,
      vertex: { module: nebulaMod, entryPoint: 'vs' },
      fragment: {
        module: nebulaMod,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Upsample blit of the backdrop target, drawn first in the scene pass in
    // place of the fullscreen nebula it replaces (depth always, no write).
    const backdropPL = d.createPipelineLayout({
      bindGroupLayouts: [this.blitLayout],
    });
    const backdrop = d.createRenderPipeline({
      layout: backdropPL,
      vertex: { module: backdropMod, entryPoint: 'vs' },
      fragment: {
        module: backdropMod,
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

    const postPL = d.createPipelineLayout({
      bindGroupLayouts: [this.postLayout],
    });
    const downsample = d.createRenderPipeline({
      layout: postPL,
      vertex: { module: postfxMod, entryPoint: 'vs' },
      fragment: {
        module: postfxMod,
        entryPoint: 'fs_down',
        targets: [{ format: HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
    });
    const postfx = d.createRenderPipeline({
      layout: postPL,
      vertex: { module: postfxMod, entryPoint: 'vs' },
      fragment: {
        module: postfxMod,
        entryPoint: 'fs_fx',
        targets: [{ format: HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list' },
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

    // Sun body — opaque emissive sphere; same winding/cull as the planet.
    const sun = d.createRenderPipeline({
      layout: sceneObjPL,
      vertex: { module: sunMod, entryPoint: 'vs', buffers: [meshLayout] },
      fragment: {
        module: sunMod,
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

    // Sun corona — camera-facing additive billboard. Depth-tested (so planets
    // in front occlude it, and the sun body masks the disc) but no depth write.
    const sunCorona = d.createRenderPipeline({
      layout: sceneObjPL,
      vertex: { module: sunMod, entryPoint: 'vs_corona', buffers: [quadLayout] },
      fragment: {
        module: sunMod,
        entryPoint: 'fs_corona',
        targets: [{ format: HDR_FORMAT, blend: addBlend }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
      multisample,
    });

    // Satellite sprites reuse the star shader but participate in depth so
    // they correctly hide behind their parent planet (`less-equal`, no write).
    const satellite = d.createRenderPipeline({
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
        depthCompare: 'less-equal',
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
        { shaderLocation: 4, offset: 44, format: 'float32' }, // digit (1..9 or 0)
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

    // Camera-facing ribbon for the rocket trajectory. One instanced quad per
    // polyline segment; vertex buffer stores (prev, next) world positions per
    // instance. Alpha-blended (not additive) so the white line stays calm and
    // doesn't blow out the bloom pass.
    const flightPathInstanceLayout: GPUVertexBufferLayout = {
      arrayStride: 9 * 4,
      stepMode: 'instance',
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, // prev
        { shaderLocation: 1, offset: 12, format: 'float32x3' }, // next
        { shaderLocation: 2, offset: 24, format: 'float32' }, // kind (0=ribbon,1=arrow)
        { shaderLocation: 3, offset: 28, format: 'float32' }, // normalized arc length at prev
        { shaderLocation: 4, offset: 32, format: 'float32' }, // normalized arc length at next
      ],
    };
    const flightPath = d.createRenderPipeline({
      layout: sceneFramePL,
      vertex: {
        module: flightPathMod,
        entryPoint: 'vs',
        buffers: [flightPathInstanceLayout],
      },
      fragment: {
        module: flightPathMod,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT, blend: alphaBlend }],
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

    const atmosphere = d.createRenderPipeline({
      layout: sceneObjPL,
      vertex: { module: atmosphereMod, entryPoint: 'vs', buffers: [meshLayout] },
      fragment: {
        module: atmosphereMod,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT, blend: addBlend }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
      multisample,
    });

    const clouds = d.createRenderPipeline({
      layout: sceneObjPL,
      vertex: { module: cloudsMod, entryPoint: 'vs', buffers: [meshLayout] },
      fragment: {
        module: cloudsMod,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT, blend: alphaBlend }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
      multisample,
    });

    // Auroral shell — additive, camera-facing hemisphere only (cull back),
    // depth-tested against the planet so the back half is hidden. Sits above
    // the atmosphere shell.
    const aurora = d.createRenderPipeline({
      layout: sceneObjPL,
      vertex: { module: auroraMod, entryPoint: 'vs', buffers: [meshLayout] },
      fragment: {
        module: auroraMod,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT, blend: addBlend }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
      multisample,
    });

    this.pipelines = { nebula, backdrop, downsample, postfx, planet, sun, sunCorona, ring, star, satellite, poi, poiLine, flightPath, composite, wireframe, atmosphere, clouds, aurora };
  }

  private buildStars(count: number): void {
    const d = this.device;
    const rand = mulberry32(1337);
    const data = new Float32Array(count * 7);
    for (let i = 0; i < count; i++) {
      // Random point on a shell. Kept reasonably close to the scene
      // (timeline spans ~36 units; camera follows alongside) so flying /
      // scrubbing along the timeline produces visible parallax against the
      // stars. Radius is randomized over a wide-ish band so individual stars
      // sit at noticeably different depths and parallax-shear against each
      // other.
      const u = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const radius = 55 + rand() * 110;
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

  resize(width: number, height: number, dpr = 1): void {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    this.width = width;
    this.height = height;
    this.dpr = dpr > 0 ? dpr : 1;
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

    this.ensureAuxTargets(true);
  }

  // Size of a reduced-resolution helper target. `scale` is expressed in CSS
  // pixels so a 2x-DPR display gets the same backdrop/FX resolution as a 1x
  // one — these targets carry only low-frequency detail, so spending device
  // pixels on them is pure waste on high-DPI screens.
  private auxSize(scale: number): [number, number] {
    const s = Math.max(0.1, Math.min(1, scale)) / this.dpr;
    return [
      Math.max(1, Math.min(this.width, Math.round(this.width * s))),
      Math.max(1, Math.min(this.height, Math.round(this.height * s))),
    ];
  }

  // (Re)creates the backdrop and post-FX targets whenever the viewport or the
  // active quality tier's resolution scales change, then rebuilds every bind
  // group that references them.
  private ensureAuxTargets(force = false): void {
    const [bw, bh] = this.auxSize(this.backdropScale);
    const [fw, fh] = this.auxSize(this.postScale);
    if (!force && bw === this.backdropW && bh === this.backdropH && fw === this.fxW && fh === this.fxH) {
      return;
    }
    const d = this.device;
    const usage =
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;

    this.backdropTex?.destroy();
    this.backdropTex = d.createTexture({ size: [bw, bh], format: HDR_FORMAT, usage });
    this.backdropView = this.backdropTex.createView();
    this.backdropW = bw;
    this.backdropH = bh;

    this.fxSrcTex?.destroy();
    this.fxTex?.destroy();
    this.fxSrcTex = d.createTexture({ size: [fw, fh], format: HDR_FORMAT, usage });
    this.fxSrcView = this.fxSrcTex.createView();
    this.fxTex = d.createTexture({ size: [fw, fh], format: HDR_FORMAT, usage });
    this.fxView = this.fxTex.createView();
    this.fxW = fw;
    this.fxH = fh;

    this.backdropBG = d.createBindGroup({
      layout: this.blitLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.backdropView },
      ],
    });
    this.downsampleBG = d.createBindGroup({
      layout: this.postLayout,
      entries: [
        { binding: 0, resource: { buffer: this.postUBO } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.hdrView },
      ],
    });
    this.fxBG = d.createBindGroup({
      layout: this.postLayout,
      entries: [
        { binding: 0, resource: { buffer: this.postUBO } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.fxSrcView },
      ],
    });
    this.compositeBG = d.createBindGroup({
      layout: this.compositeLayout,
      entries: [
        { binding: 0, resource: { buffer: this.postUBO } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.hdrView },
        { binding: 3, resource: this.fxView },
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
    this.resize(this.width, this.height, this.dpr);
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
    extra: number = 0,
    extra2: number = 0,
    extra3: number = 0,
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
    s[base + 35] = extra;
    // p2.x — planet shader's cityLights flag, p2.y — flowMap flag. Other
    // shaders ignore p2.
    s[base + 36] = extra2;
    s[base + 37] = extra3;
    s[base + 38] = 0;
    s[base + 39] = 0;
  }

  render(frame: FrameState): void {
    const d = this.device;
    this.stats = { drawCalls: 0, triangles: 0, gpuMemoryMB: 0 };

    this.backdropScale = frame.quality.backdropScale;
    this.postScale = frame.quality.postScale;
    this.ensureSampleCount(frame.quality.msaa);
    this.ensureAuxTargets();

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
    // misc.z: wireframe debug-view flag. POI marker / connector shaders
    // sample this to switch to a wireframe-styled rendering (cyan tint,
    // outline only) so the overlay matches the wireframe planet body.
    f[26] = frame.wireframe ? 1 : 0;
    f[27] = this.width / this.height;
    // Shadow casters: 8 vec4 spheres at floats 28..59, count at float 60.
    const sCount = Math.min(frame.shadowCasters.length, 8);
    for (let i = 0; i < sCount; i++) {
      const c = frame.shadowCasters[i]!;
      const o = 28 + i * 4;
      f[o] = c.center[0];
      f[o + 1] = c.center[1];
      f[o + 2] = c.center[2];
      f[o + 3] = c.radius;
    }
    // Zero unused slots so stale data from previous frames doesn't leak.
    for (let i = sCount; i < 8; i++) {
      const o = 28 + i * 4;
      f[o] = 0;
      f[o + 1] = 0;
      f[o + 2] = 0;
      f[o + 3] = 0;
    }
    f[60] = sCount;
    // shadowMisc.y: quality tier index (0 = high, 1 = med, 2 = low). Heavy
    // procedural shaders read this to drop to cheaper paths (fewer raymarch
    // steps, fewer fbm octaves, single flow-field sample) on weaker tiers,
    // where fragment throughput is the bottleneck — pronounced on macOS
    // (Metal/Dawn). The branch is uniform across the draw, so it's coherent and
    // divergence-free.
    f[61] = frame.quality.tier === 'low' ? 2 : frame.quality.tier === 'med' ? 1 : 0;
    f[62] = 0;
    f[63] = 0;
    // invViewProj for the nebula backdrop (and any other fullscreen pass that
    // needs to recover a world-space ray from a screen-space pixel).
    f.set(frame.invViewProj, 64);
    d.queue.writeBuffer(this.frameUBO, 0, f, 0, 80);

    // Build per-object uniforms + collect POI billboards.
    const objects: { kind: number; index: number; lod: number }[] = [];
    const poiData: number[] = [];
    let objIndex = 0;
    const model = mat4.create();

    // Reserve obj slot 0 for the sun so its uniform is never crowded out by the
    // planet budget. The body and corona pipelines both read this same entry.
    const sunObjIndex = objIndex;
    // Frustum-cull the sun. Inflate the test radius to 1.6× so the additive
    // corona billboard (which extends to 1.5× the body radius) isn't clipped a
    // frame early as the star slides off screen.
    const sunVisible = frame.frustum.intersectsSphere(
      frame.sun.center,
      frame.sun.radius * 1.6,
    );
    const sunLod = selectSphereLod(
      frame.sun.center,
      frame.sun.radius,
      frame.cameraPos,
    );
    mat4.fromRotationTranslationScale(
      model,
      [0, 0, 0, 1],
      frame.sun.center,
      frame.sun.radius,
    );
    this.writeObject(
      sunObjIndex,
      model,
      frame.sun.radius, // p0.x = radius (corona reads this)
      1234, // seed for surface noise variation
      frame.time,
      9, // kind: sun
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
      0,
      0,
      0,
    );
    objIndex++;

    for (const p of frame.planets) {
      // Budget: planet + atmosphere + clouds = up to 3 shells + ring + moons.
      if (objIndex >= MAX_OBJECTS - 8) break;
      const vis = p.visibility;
      if (vis <= 0.02) continue; // fully hidden — skip planet, POIs, moons
      const er = p.radius * vis;
      const rot = p.orientation;
      const cloudShadowStrength = p.clouds && !frame.wireframe ? vis : 0;
      // One LOD per planet, shared by its atmosphere/cloud/aurora shells so
      // the shells keep the same silhouette as the surface they wrap.
      const planetLod = selectSphereLod(p.center, er, frame.cameraPos);
      mat4.fromRotationTranslationScale(model, rot, p.center, er);
      this.writeObject(
        objIndex,
        model,
        p.radius,
        p.seed % 100000,
        p.cloudTime,
        0,
        p.paletteLow,
        p.paletteMid,
        p.paletteHigh,
        p.focus,
        1,
        cloudShadowStrength,
        p.oceans ? 1 : 0,
        p.cityLights ? 1 : 0,
        p.flowMap ? 1 : 0,
      );
      objects.push({ kind: 0, index: objIndex, lod: planetLod });
      objIndex++;

      this.collectPois(p, poiData, er, vis);

      // Atmospheric scattering shell (skipped in wireframe debug view).
      if (!frame.wireframe) {
        const outerR = er * 1.02;
        mat4.fromRotationTranslationScale(model, rot, p.center, outerR);
        this.writeObject(
          objIndex,
          model,
          er,
          outerR,
          0,
          4,
          p.paletteHigh,
          p.paletteHigh,
          p.paletteHigh,
          p.focus,
          1.4 * vis,
          0,
        );
        objects.push({ kind: 4, index: objIndex, lod: planetLod });
        objIndex++;
      }

      // Auroral shell — additive emissive curtains over the poles, above the
      // atmosphere. Skipped in wireframe and when the planet lacks the feature.
      if (p.aurora && !frame.wireframe && objIndex < MAX_OBJECTS) {
        const auroraR = er * 1.22;
        mat4.fromRotationTranslationScale(model, rot, p.center, auroraR);
        this.writeObject(
          objIndex,
          model,
          er,        // p0.x = planet world radius (inner)
          auroraR,   // p0.y = shell radius (outer)
          0,
          6,         // kind: aurora
          p.paletteHigh,
          p.paletteHigh,
          p.paletteHigh,
          p.focus,   // p1.x = focus
          1.0 * vis, // p1.y = intensity
          0,
        );
        objects.push({ kind: 6, index: objIndex, lod: planetLod });
        objIndex++;
      }

      // Optional cloud shell, between the planet surface and atmosphere. Same
      // mesh, slightly larger radius; alpha-blended. Skip in wireframe and
      // when the setting is off. Per-planet variation (rotation speed/dir,
      // coverage, noise offset) is derived from the seed inside the shader.
      if (p.clouds && !frame.wireframe && objIndex < MAX_OBJECTS) {
        const cloudR = er * CLOUD_SHELL_SCALE;
        mat4.fromRotationTranslationScale(model, rot, p.center, cloudR);
        this.writeObject(
          objIndex,
          model,
          er,            // p0.x = planet world radius (used for tint cohesion)
          CLOUD_SHELL_SCALE, // p0.y = shell scale
          p.cloudTime,   // p0.z = per-planet cloud time (pauses with spin)
          5,             // p0.w = kind (clouds)
          p.paletteHigh, // unused
          p.paletteHigh, // unused
          p.paletteHigh, // palHigh.rgb = atmosphere tint
          p.focus,       // p1.x = focus
          p.seed % 100000, // p1.y = seed (overload, normally hasAtmo)
          0,             // p1.z = unused for clouds
          vis,           // p1.w = visibility (overload, normally oceans flag)
        );
        objects.push({ kind: 5, index: objIndex, lod: planetLod });
        objIndex++;
      }

      if (p.hasRing && objIndex < MAX_OBJECTS) {
        // Compose the ring tilt with the planet's orientation so rings stay
        // locked to the planet's equator when the user drags/spins the planet.
        const ringRot = quat.multiply(
          rot,
          quat.fromAxisAngle([1, 0, 0.2], p.ringTilt),
        );
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
          p.thinRing ? 1 : 0,
        );
        objects.push({ kind: 2, index: objIndex, lod: planetLod });
        objIndex++;
      }

      for (const m of p.moons) {
        if (objIndex >= MAX_OBJECTS - 1) break;
        const orbit = m.orbitRadius * vis;
        // Compute the moon's offset in the planet's local frame, then rotate
        // it by the planet's orientation so moons stay locked to the planet
        // as it spins or the user drags it.
        const localOffset: [number, number, number] = [
          Math.cos(m.angle) * orbit,
          Math.sin(m.angle * 0.5) * orbit * 0.2,
          Math.sin(m.angle) * orbit,
        ];
        const worldOffset = quat.rotateVec3(rot, localOffset);
        const moonCenter: [number, number, number] = [
          p.center[0] + worldOffset[0],
          p.center[1] + worldOffset[1],
          p.center[2] + worldOffset[2],
        ];
        const moonR = m.size * vis;
        // Per-moon frustum cull: a moon can swing well clear of its parent, so
        // skip any whose own bounding sphere is fully off screen even when the
        // planet itself is visible.
        if (!frame.frustum.intersectsSphere(moonCenter, moonR)) continue;
        // Compose the planet's orientation with the moon's own slow spin so
        // the moon's surface frame inherits the planet's rotation too.
        const moonRot = quat.multiply(
          rot,
          quat.fromAxisAngle([0, 1, 0], frame.moonTime * 0.3),
        );
        const moonLod = selectSphereLod(moonCenter, moonR, frame.cameraPos);
        mat4.fromRotationTranslationScale(model, moonRot, moonCenter, moonR);
        this.writeObject(
          objIndex,
          model,
          m.size,
          (p.seed + 7) % 100000,
          frame.time,
          0,
          m.paletteLow as [number, number, number],
          m.paletteMid as [number, number, number],
          m.paletteHigh as [number, number, number],
          p.focus,
          0,
          0,
        );
        objects.push({ kind: 3, index: objIndex, lod: moonLod });
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
    this.uploadFlightPath(frame.flightPath);

    // Post uniform.
    const post = this.postScratch;
    const lowNoPost = frame.quality.tier === 'low';
    post[0] = lowNoPost ? 0 : frame.blur;
    post[1] = lowNoPost ? 0 : 0.55;
    post[2] = lowNoPost ? 0 : (frame.quality.chromaticAberration ? 0.0035 : 0);
    post[3] = lowNoPost ? 0 : (frame.quality.bloomMips > 0 ? 0.8 : 0);
    post[4] = 1 / this.width;
    post[5] = 1 / this.height;
    post[6] = 1 / this.fxW;
    post[7] = 1 / this.fxH;
    const flare = computeSunFlare(frame);
    post[8] = flare.u;
    post[9] = flare.v;
    post[10] = lowNoPost ? 0 : flare.strength;
    post[11] = this.width / this.height;
    // Skip the downsample + FX passes entirely when nothing in the FX layer
    // would contribute (the low tier disables post-processing wholesale).
    const fxEnabled = post[0] > 0.001 || post[3] > 0.001 || post[10] > 0.001;
    post[12] = fxEnabled ? 1 : 0;
    post[13] = frame.crtBarrel;
    d.queue.writeBuffer(this.postUBO, 0, post);

    const encoder = d.createCommandEncoder();

    // Nebula backdrop into its own reduced-resolution target. Its raymarch is
    // the heaviest per-pixel shader in the scene and carries no high-frequency
    // detail, so rendering it small and upsampling is the single largest
    // fill-rate saving available.
    const backdropPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.backdropView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    backdropPass.setPipeline(this.pipelines.nebula);
    backdropPass.setBindGroup(0, this.frameBG);
    backdropPass.draw(3);
    backdropPass.end();
    this.stats.drawCalls++;
    this.stats.triangles += 1;

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
        // Nothing reads depth after this pass, so discarding it keeps the
        // (4x multisampled) depth buffer in tile memory on tile-based GPUs
        // instead of flushing it to VRAM every frame.
        depthStoreOp: 'discard',
      },
    });

    // Backdrop upsample — replaces the fullscreen nebula draw that used to
    // open this pass.
    scenePass.setPipeline(this.pipelines.backdrop);
    scenePass.setBindGroup(0, this.backdropBG);
    scenePass.draw(3);
    this.stats.drawCalls++;
    this.stats.triangles += 1;

    // Group 0 (per-frame uniforms) is invariant for the rest of the scene pass
    // and its layout is shared by every pipeline used here, so bind it once
    // instead of before every draw. Fewer setBindGroup calls = less encoder/
    // driver overhead, which is disproportionately expensive on Metal/Dawn.
    scenePass.setBindGroup(0, this.frameBG);

    // Stars. Kept at native resolution: they're the one part of the backdrop
    // with pixel-scale detail, and thousands of tiny sprites cost far less
    // than a fullscreen procedural shader.
    if (frame.quality.starCount > 0 && this.starCount > 0) {
      const drawStars = Math.min(this.starCount, frame.quality.starCount);
      scenePass.setPipeline(this.pipelines.star);
      scenePass.setVertexBuffer(0, this.quadBuf);
      scenePass.setVertexBuffer(1, this.starBuf);
      scenePass.draw(6, drawStars);
      this.stats.drawCalls++;
      this.stats.triangles += drawStars * 2;
    }

    // Sphere LOD binding helpers. `boundLod` tracks which LOD mesh (and which
    // index list — triangles vs. wireframe edges) is currently bound so the
    // common case of consecutive draws at the same LOD costs no extra calls.
    // Set to -1 whenever a non-sphere vertex buffer is bound.
    let boundLod = -1;
    let boundLines = false;
    const bindSphere = (lod: number) => {
      if (boundLod === lod && !boundLines) return;
      const mesh = this.sphereLods[lod]!;
      scenePass.setVertexBuffer(0, mesh.vbuf);
      scenePass.setIndexBuffer(mesh.ibuf, mesh.u32 ? 'uint32' : 'uint16');
      boundLod = lod;
      boundLines = false;
    };
    const bindSphereLines = (lod: number) => {
      if (boundLod === lod && boundLines) return;
      const mesh = this.sphereLods[lod]!;
      const lines = this.sphereLineLods[lod]!;
      scenePass.setVertexBuffer(0, mesh.vbuf);
      scenePass.setIndexBuffer(lines.ibuf, lines.u32 ? 'uint32' : 'uint16');
      boundLod = lod;
      boundLines = true;
    };

    if (frame.wireframe) {
      // Debug wireframe: draw every mesh as edges instead of filled surfaces.
      scenePass.setPipeline(this.pipelines.wireframe);
      // Sun body as wireframe (drawn separately from `objects`, like the filled
      // path below). Skipped when the sun is off screen.
      if (sunVisible) {
        bindSphereLines(sunLod);
        scenePass.setBindGroup(1, this.objBG, [sunObjIndex * OBJ_STRIDE]);
        scenePass.drawIndexed(this.sphereLineLods[sunLod]!.count);
        this.stats.drawCalls++;
      }
      for (const o of objects) {
        if (o.kind === 2) continue; // rings use their own mesh below
        bindSphereLines(o.lod);
        scenePass.setBindGroup(1, this.objBG, [o.index * OBJ_STRIDE]);
        scenePass.drawIndexed(this.sphereLineLods[o.lod]!.count);
        this.stats.drawCalls++;
      }
      let wireRingBound = false;
      for (const o of objects) {
        if (o.kind !== 2) continue;
        if (!wireRingBound) {
          boundLod = -1;
          scenePass.setVertexBuffer(0, this.ring.vbuf);
          scenePass.setIndexBuffer(this.ringLines.ibuf, 'uint16');
          wireRingBound = true;
        }
        scenePass.setBindGroup(1, this.objBG, [o.index * OBJ_STRIDE]);
        scenePass.drawIndexed(this.ringLines.count);
        this.stats.drawCalls++;
      }
    } else {
      // Sun body (opaque, emissive). Skipped when the sun lies outside the
      // view frustum.
      if (sunVisible) {
        bindSphere(sunLod);
        scenePass.setPipeline(this.pipelines.sun);
        scenePass.setBindGroup(1, this.objBG, [sunObjIndex * OBJ_STRIDE]);
        scenePass.drawIndexed(this.sphereLods[sunLod]!.count);
        this.stats.drawCalls++;
        this.stats.triangles += this.sphereLods[sunLod]!.count / 3;
      }

      // Opaque planets, then moons — same pipeline, each at its own LOD.
      for (const o of objects) {
        if (o.kind !== 0 && o.kind !== 3) continue;
        bindSphere(o.lod);
        scenePass.setPipeline(this.pipelines.planet);
        scenePass.setBindGroup(1, this.objBG, [o.index * OBJ_STRIDE]);
        scenePass.drawIndexed(this.sphereLods[o.lod]!.count);
        this.stats.drawCalls++;
        this.stats.triangles += this.sphereLods[o.lod]!.count / 3;
      }

      // Satellite point-sprites — pin-pricks orbiting each planet. Drawn after
      // the opaque planet+moon pass so depth test correctly hides satellites
      // behind their parent body. Reuses the star shader/pipeline; only the
      // depth state differs (less-equal, no write).
      const satCount = this.uploadSatellites(frame);
      if (satCount > 0) {
        scenePass.setPipeline(this.pipelines.satellite);
        boundLod = -1;
        scenePass.setVertexBuffer(0, this.quadBuf);
        scenePass.setVertexBuffer(1, this.satelliteBuf);
        scenePass.draw(6, satCount);
        this.stats.drawCalls++;
        this.stats.triangles += satCount * 2;
        // Restore the sphere mesh on slot 0 so the subsequent cloud/
        // atmosphere passes — which expect sphere vertices on slot 0 — don't
        // read the quad billboard buffer. Slot 1 (satellite instances) is
        // ignored by those pipelines since their layout doesn't declare it.
      }

      // Cloud shells (alpha blended) — between the opaque planet and the
      // additive atmosphere so haze can still glow over the cloud silhouette.
      for (const o of objects) {
        if (o.kind !== 5) continue;
        bindSphere(o.lod);
        scenePass.setPipeline(this.pipelines.clouds);
        scenePass.setBindGroup(1, this.objBG, [o.index * OBJ_STRIDE]);
        scenePass.drawIndexed(this.sphereLods[o.lod]!.count);
        this.stats.drawCalls++;
        this.stats.triangles += this.sphereLods[o.lod]!.count / 3;
      }

      // Atmospheric scattering shells (additive). Sphere mesh is still bound.
      for (const o of objects) {
        if (o.kind !== 4) continue;
        bindSphere(o.lod);
        scenePass.setPipeline(this.pipelines.atmosphere);
        scenePass.setBindGroup(1, this.objBG, [o.index * OBJ_STRIDE]);
        scenePass.drawIndexed(this.sphereLods[o.lod]!.count);
        this.stats.drawCalls++;
        this.stats.triangles += this.sphereLods[o.lod]!.count / 3;
      }

      // Auroral shells (additive). Drawn after the atmosphere so the curtains
      // glow above the haze. Sphere mesh is still bound.
      for (const o of objects) {
        if (o.kind !== 6) continue;
        bindSphere(o.lod);
        scenePass.setPipeline(this.pipelines.aurora);
        scenePass.setBindGroup(1, this.objBG, [o.index * OBJ_STRIDE]);
        scenePass.drawIndexed(this.sphereLods[o.lod]!.count);
        this.stats.drawCalls++;
        this.stats.triangles += this.sphereLods[o.lod]!.count / 3;
      }

      // Sun corona (additive billboard). Drawn after atmosphere shells but
      // before alpha-blended rings so rings composite over the glow. Uses the
      // unit-quad billboard buffer; the sun obj entry supplies center + radius.
      // Skipped when the sun (corona included) is off screen.
      if (sunVisible) {
        scenePass.setPipeline(this.pipelines.sunCorona);
        scenePass.setBindGroup(1, this.objBG, [sunObjIndex * OBJ_STRIDE]);
        boundLod = -1;
        scenePass.setVertexBuffer(0, this.quadBuf);
        scenePass.draw(6);
        this.stats.drawCalls++;
        this.stats.triangles += 2;
      }

      // Rings (alpha).
      let ringBound = false;
      for (const o of objects) {
        if (o.kind !== 2) continue;
        if (!ringBound) {
          boundLod = -1;
          scenePass.setVertexBuffer(0, this.ring.vbuf);
          scenePass.setIndexBuffer(this.ring.ibuf, 'uint16');
          ringBound = true;
        }
        scenePass.setPipeline(this.pipelines.ring);
        scenePass.setBindGroup(1, this.objBG, [o.index * OBJ_STRIDE]);
        scenePass.drawIndexed(this.ring.count);
        this.stats.drawCalls++;
        this.stats.triangles += this.ring.count / 3;
      }
    }

    // POI connector lines (additive), drawn under the markers.
    if (this.poiCount > 0) {
      scenePass.setPipeline(this.pipelines.poiLine);
      scenePass.setVertexBuffer(0, this.poiBuf);
      scenePass.draw(6, this.poiCount);
      this.stats.drawCalls++;
      this.stats.triangles += this.poiCount * 2;
    }

    // POIs (additive billboards).
    if (this.poiCount > 0) {
      scenePass.setPipeline(this.pipelines.poi);
      scenePass.setVertexBuffer(0, this.quadBuf);
      scenePass.setVertexBuffer(1, this.poiBuf);
      scenePass.draw(6, this.poiCount);
      this.stats.drawCalls++;
      this.stats.triangles += this.poiCount * 2;
    }

    // Rocket trajectory ribbon. Drawn last so it overlays clouds/atmosphere,
    // but with depth less-equal + no depth write so opaque planet bodies still
    // occlude segments that pass behind them.
    if (this.flightPathSegmentCount > 0 && this.flightPathBuf) {
      scenePass.setPipeline(this.pipelines.flightPath);
      scenePass.setVertexBuffer(0, this.flightPathBuf);
      // Ribbon segments plus one trailing arrowhead instance.
      const instances = this.flightPathSegmentCount + 1;
      scenePass.draw(6, instances);
      this.stats.drawCalls++;
      this.stats.triangles += this.flightPathSegmentCount * 2 + 1;
    }

    scenePass.end();

    // Reduced-resolution post chain. Bloom, god rays, the lens flare and the
    // modal freeze-blur are all wide, low-frequency filters with high tap
    // counts (89+ samples per pixel between them), so running them at native
    // resolution dominates frame time on fill-rate limited GPUs. Downsample the
    // scene once, then evaluate them all against that small source.
    if (fxEnabled) {
      const downPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.fxSrcView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      downPass.setPipeline(this.pipelines.downsample);
      downPass.setBindGroup(0, this.downsampleBG);
      downPass.draw(3);
      downPass.end();
      this.stats.drawCalls++;

      const fxPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.fxView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      fxPass.setPipeline(this.pipelines.postfx);
      fxPass.setBindGroup(0, this.fxBG);
      fxPass.draw(3);
      fxPass.end();
      this.stats.drawCalls++;
    }

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
    for (let i = 0; i < p.pois.length; i++) {
      const poi = p.pois[i]!;
      const dir = quat.rotateVec3(rot, poi.dir);
      const surfDir = quat.rotateVec3(rot, poi.surfaceDir);
      const inner = vec3.add(p.center, vec3.scale(surfDir, effectiveRadius));
      const outer = vec3.add(p.center, vec3.scale(dir, markerDist));
      const dim = fade;
      const size = (0.027 + 0.021 * p.focus) * vis;
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
        i + 1,
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

  // Build a per-segment instance buffer (prev.xyz, next.xyz, kind) from the
  // flight path polyline, plus one trailing arrowhead instance (kind=1) at the
  // end point. Only re-uploads when the polyline length changes, which in
  // practice means once on first frame.
  private uploadFlightPath(path: Float32Array): void {
    const pointCount = path.length / 3;
    if (pointCount < 2) {
      this.flightPathSegmentCount = 0;
      return;
    }
    if (pointCount === this.flightPathPointCount && this.flightPathBuf) {
      // Buffer is still valid from a previous frame (e.g. user toggled the
      // path off and back on). Restore the segment count so the draw call
      // runs again.
      this.flightPathSegmentCount = pointCount - 1;
      return;
    }
    const segments = pointCount - 1;
    // Cumulative arc length per point, normalized to 0..1, so the fragment
    // shader can place a pulse at a constant world-space speed along the path.
    const arc = new Float32Array(pointCount);
    for (let i = 1; i < pointCount; i++) {
      const dx = path[i * 3 + 0]! - path[(i - 1) * 3 + 0]!;
      const dy = path[i * 3 + 1]! - path[(i - 1) * 3 + 1]!;
      const dz = path[i * 3 + 2]! - path[(i - 1) * 3 + 2]!;
      arc[i] = arc[i - 1]! + Math.hypot(dx, dy, dz);
    }
    const total = arc[pointCount - 1]! || 1;
    for (let i = 0; i < pointCount; i++) arc[i] = arc[i]! / total;
    // One extra instance for the arrowhead at the end of the path.
    const instance = new Float32Array((segments + 1) * 9);
    for (let i = 0; i < segments; i++) {
      const o = i * 9;
      instance[o + 0] = path[i * 3 + 0]!;
      instance[o + 1] = path[i * 3 + 1]!;
      instance[o + 2] = path[i * 3 + 2]!;
      instance[o + 3] = path[(i + 1) * 3 + 0]!;
      instance[o + 4] = path[(i + 1) * 3 + 1]!;
      instance[o + 5] = path[(i + 1) * 3 + 2]!;
      instance[o + 6] = 0;
      instance[o + 7] = arc[i]!;
      instance[o + 8] = arc[i + 1]!;
    }
    // Arrowhead: prev = first point (start), next = second point. The shader
    // anchors the tip at the start and orients it along this segment's
    // travel direction.
    const a = segments * 9;
    instance[a + 0] = path[0]!;
    instance[a + 1] = path[1]!;
    instance[a + 2] = path[2]!;
    instance[a + 3] = path[3]!;
    instance[a + 4] = path[4]!;
    instance[a + 5] = path[5]!;
    instance[a + 6] = 1;
    instance[a + 7] = 0;
    instance[a + 8] = arc[1]!;
    this.flightPathBuf?.destroy();
    this.flightPathBuf = this.device.createBuffer({
      size: instance.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.flightPathBuf, 0, instance);
    this.flightPathSegmentCount = segments;
    this.flightPathPointCount = pointCount;
  }

  // Pack visible planets' satellites into the per-frame instance buffer. Each
  // satellite contributes 7 floats: (worldPos.xyz, size, phase, tintR, tintB).
  // World position = planet.center + local offset (no planet-rotation coupling
  // so satellites trace world-locked orbits independent of planet spin). Size
  // and twinkle phase are scaled/seeded for natural variation; visibility fades
  // satellites alongside their planet.
  private uploadSatellites(frame: FrameState): number {
    const scratch = this.satelliteScratch;
    let n = 0;
    for (const p of frame.planets) {
      const vis = p.visibility;
      if (vis <= 0.02) continue;
      const fade = Math.min(1, Math.max(0, vis));
      for (let s = 0; s < p.satellites.length; s++) {
        if (n >= MAX_SATELLITES) break;
        const sat = p.satellites[s]!;
        const o = n * SAT_FLOATS;
        scratch[o + 0] = p.center[0] + sat.offset[0];
        scratch[o + 1] = p.center[1] + sat.offset[1];
        scratch[o + 2] = p.center[2] + sat.offset[2];
        scratch[o + 3] = sat.size * fade;
        // Per-satellite phase so twinkles aren't synchronized.
        scratch[o + 4] = (p.seed * 0.137 + s * 0.731) % 1;
        scratch[o + 5] = 1.0; // tintR
        scratch[o + 6] = 1.0; // tintB
        n++;
      }
      if (n >= MAX_SATELLITES) break;
    }
    if (n === 0) return 0;
    this.device.queue.writeBuffer(
      this.satelliteBuf,
      0,
      scratch.buffer,
      scratch.byteOffset,
      n * SAT_STRIDE,
    );
    return n;
  }

  private estimateMemoryMB(): number {
    const hdr = this.width * this.height * 8;
    const depth = this.width * this.height * 4 * this.sampleCount;
    const msaa = this.sampleCount > 1 ? hdr * this.sampleCount : 0;
    const backdrop = this.backdropW * this.backdropH * 8;
    const fx = this.fxW * this.fxH * 8 * 2;
    const stars = this.starCount * 7 * 4;
    return (hdr * 2 + msaa + depth + backdrop + fx + stars) / (1024 * 1024);
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
    this.backdropTex?.destroy();
    this.fxSrcTex?.destroy();
    this.fxTex?.destroy();
    this.starBuf?.destroy();
    this.satelliteBuf?.destroy();
    this.poiBuf?.destroy();
    this.device?.destroy();
  }
}
