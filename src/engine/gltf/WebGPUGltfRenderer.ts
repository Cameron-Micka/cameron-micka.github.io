import { trianglesToLineIndices } from '../geometry';
import shaderSource from '../shaders/gltf.wgsl?raw';
import {
  GLTF_VERTEX_BYTES,
  GLTF_VERTEX_FLOATS,
  type GltfAsset,
  type GltfFrame,
  type GltfRenderStats,
} from './types';
import {
  FRAME_BYTES,
  FRAME_FLOATS,
  MATERIAL_BYTES,
  OBJECT_BYTES,
  alignTo,
  closeImages,
  createRenderPlan,
  decodeImages,
  gpuSamplerDescriptor,
  mipLevelCount,
  requiredItem,
  requiredResource,
  textureByteLength,
  updateDrawTransforms,
  writeFrameUniforms,
  writeObjectUniforms,
  type RenderPlan,
} from './rendererShared';
import { generateMipmaps } from './generateMipmaps';
import { checkedGpu, checkedShaderModule } from './webgpuUtils';

export interface WebGPUGltfRendererOptions {
  colorFormat: GPUTextureFormat;
  /** Defaults to depth24plus. The caller's pass must have this depth format. */
  depthFormat?: GPUTextureFormat;
  /** Defaults to 1; WebGPU also supports 4. Must match the caller's pass. */
  sampleCount?: number;
  /** Prewarm other quality tiers without uploading geometry/textures again. */
  sampleCounts?: readonly number[];
}

interface Geometry {
  vertices: GPUBuffer;
  indices: GPUBuffer;
  indexFormat: GPUIndexFormat;
  indexCount: number;
  lines: GPUBuffer;
  lineFormat: GPUIndexFormat;
  lineCount: number;
}

interface PipelineVariant {
  sampleCount: number;
  blend: boolean;
  doubleSided: boolean;
  mirrored: boolean;
  wireframe: boolean;
}

const VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: GLTF_VERTEX_BYTES,
  stepMode: 'vertex',
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'float32x4' },
    { shaderLocation: 3, offset: 40, format: 'float32x2' },
    { shaderLocation: 4, offset: 48, format: 'float32x2' },
    { shaderLocation: 5, offset: 56, format: 'float32x4' },
  ],
};

function pipelineKey(variant: PipelineVariant): string {
  const alpha = `${variant.sampleCount}/${variant.blend ? 'blend' : 'opaque'}`;
  if (variant.wireframe) return `${alpha}/lines`;
  return `${alpha}/${variant.doubleSided ? 'double' : 'single'}/${variant.mirrored ? 'cw' : 'ccw'}`;
}

function initialized<T>(resource: T | null, label: string): T {
  if (resource === null) {
    throw new Error(`glTF WebGPU: ${label} has not been initialized.`);
  }
  return resource;
}

/**
 * Encodes static glTF into a caller-owned pass. It never ends the pass, clears,
 * configures a canvas, changes viewport/scissor, or submits rendering commands.
 * create() does submit owned image/mipmap initialization work and awaits it.
 *
 * output defaults to linear (use e.g. rgba16float for HDR composition). srgb
 * applies exposure + ACES + one sRGB conversion, accounting for -srgb targets.
 * Bindings, vertex/index buffers and pipelines in the supplied pass are owned
 * during render(); the host must rebind them for subsequent draws.
 *
 * Uniform uploads are queued by render(): submit that pass's command buffer
 * before calling render() again on this instance. Use separate instances for
 * independently encoded views whose submissions overlap. Source draw transforms
 * and visibility are live; recreate to upload edited geometry/materials.
 */
export class WebGPUGltfRenderer {
  private readonly plan: RenderPlan;
  private readonly options: Required<WebGPUGltfRendererOptions>;
  private readonly geometry: Geometry[] = [];
  private readonly buffers: GPUBuffer[] = [];
  private readonly textures = new Map<string, GPUTexture>();
  private readonly views = new Map<string, GPUTextureView>();
  private readonly samplers = new Map<string, GPUSampler>();
  private readonly materials: GPUBindGroup[] = [];
  private readonly pipelines = new Map<string, GPURenderPipeline>();
  private readonly frameScratch = new Float32Array(FRAME_FLOATS);
  private readonly objectStride: number;
  private objectScratch: Float32Array<ArrayBuffer>;
  private readonly counters: GltfRenderStats = {
    drawCalls: 0,
    triangles: 0,
    lines: 0,
    geometryBytes: 0,
    textureBytes: 0,
  };
  private pipelineLayout: GPUPipelineLayout | null = null;
  private frameBuffer: GPUBuffer | null = null;
  private objectBuffer: GPUBuffer | null = null;
  private frameBindGroup: GPUBindGroup | null = null;
  private objectBindGroup: GPUBindGroup | null = null;
  private disposed = false;

  private constructor(
    private readonly device: GPUDevice,
    asset: GltfAsset,
    options: WebGPUGltfRendererOptions,
  ) {
    this.plan = createRenderPlan(asset);
    this.options = {
      colorFormat: options.colorFormat,
      depthFormat: options.depthFormat ?? 'depth24plus',
      sampleCount: options.sampleCount ?? 1,
      sampleCounts: [
        ...new Set([options.sampleCount ?? 1, ...(options.sampleCounts ?? [])]),
      ],
    };
    if (this.options.sampleCounts.some((count) => count !== 1 && count !== 4)) {
      throw new Error('glTF WebGPU sample counts must be 1 or 4.');
    }
    this.objectStride = alignTo(
      OBJECT_BYTES,
      device.limits.minUniformBufferOffsetAlignment,
    );
    this.objectScratch = new Float32Array(
      (this.objectStride / 4) * Math.max(1, this.plan.draws.length),
    );
  }

  static async create(
    device: GPUDevice,
    asset: GltfAsset,
    options: WebGPUGltfRendererOptions,
  ): Promise<WebGPUGltfRenderer> {
    const renderer = new WebGPUGltfRenderer(device, asset, options);
    try {
      await renderer.initialize(asset);
      return renderer;
    } catch (error) {
      renderer.dispose();
      throw error;
    }
  }

  get stats(): Readonly<GltfRenderStats> {
    return this.counters;
  }

  private createStaticBuffer(
    data:
      | Float32Array<ArrayBuffer>
      | Uint16Array<ArrayBuffer>
      | Uint32Array<ArrayBuffer>,
    usage: GPUBufferUsageFlags,
    label: string,
  ): GPUBuffer {
    const buffer = this.device.createBuffer({
      label: `glTF ${label}`,
      size: alignTo(data.byteLength, 4),
      usage,
      mappedAtCreation: true,
    });
    this.buffers.push(buffer);
    new Uint8Array(buffer.getMappedRange()).set(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
    buffer.unmap();
    return buffer;
  }

  private createUniformBuffer(size: number, label: string): GPUBuffer {
    const buffer = this.device.createBuffer({
      label: `glTF ${label}`,
      size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.buffers.push(buffer);
    return buffer;
  }

  private async initialize(asset: GltfAsset): Promise<void> {
    const device = this.device;
    const images = await decodeImages(
      asset.images,
      this.plan.textures,
      device.limits.maxTextureDimension2D,
    );
    try {
      const module = await checkedShaderModule(
        device,
        shaderSource,
        'gltf.wgsl',
      );
      await checkedGpu(device, 'geometry upload', () => {
        for (const primitive of asset.primitives) {
          const edges = trianglesToLineIndices(
            primitive.indices,
            primitive.vertices.length / GLTF_VERTEX_FLOATS,
          );
          const vertices = this.createStaticBuffer(
            primitive.vertices,
            GPUBufferUsage.VERTEX,
            `${primitive.name} vertices`,
          );
          const indices = this.createStaticBuffer(
            primitive.indices,
            GPUBufferUsage.INDEX,
            `${primitive.name} indices`,
          );
          const lines = this.createStaticBuffer(
            edges,
            GPUBufferUsage.INDEX,
            `${primitive.name} wireframe`,
          );
          this.geometry.push({
            vertices,
            indices,
            indexFormat:
              primitive.indices instanceof Uint32Array ? 'uint32' : 'uint16',
            indexCount: primitive.indices.length,
            lines,
            lineFormat: edges instanceof Uint32Array ? 'uint32' : 'uint16',
            lineCount: edges.length,
          });
          this.counters.geometryBytes +=
            vertices.size + indices.size + lines.size;
        }
      });
      await checkedGpu(device, 'texture/sampler upload', () => {
        for (const plan of this.plan.textures) {
          const image =
            plan.source === undefined ? undefined : images.get(plan.source);
          if (plan.source !== undefined && image === undefined) {
            throw new Error(`Decoded image ${plan.source} is missing.`);
          }
          const width = image?.width ?? 1;
          const height = image?.height ?? 1;
          const levels = mipLevelCount(width, height, plan.mipmapped);
          const texture = device.createTexture({
            label: `glTF ${plan.key}`,
            size: { width, height, depthOrArrayLayers: 1 },
            mipLevelCount: levels,
            format: plan.srgb ? 'rgba8unorm-srgb' : 'rgba8unorm',
            usage:
              GPUTextureUsage.TEXTURE_BINDING |
              GPUTextureUsage.COPY_DST |
              GPUTextureUsage.RENDER_ATTACHMENT,
          });
          this.textures.set(plan.key, texture);
          this.views.set(plan.key, texture.createView());
          if (image) {
            device.queue.copyExternalImageToTexture(
              { source: image, flipY: false },
              { texture, premultipliedAlpha: false, colorSpace: 'srgb' },
              { width, height },
            );
          } else {
            device.queue.writeTexture(
              { texture },
              new Uint8Array([255, 255, 255, 255]),
              { bytesPerRow: 4, rowsPerImage: 1 },
              { width: 1, height: 1 },
            );
          }
          this.counters.textureBytes += textureByteLength(
            width,
            height,
            levels,
          );
        }
        for (const plan of this.plan.samplers) {
          this.samplers.set(
            plan.key,
            device.createSampler({
              label: `glTF ${plan.key}`,
              ...gpuSamplerDescriptor(plan.descriptor),
            }),
          );
        }
      });
      await generateMipmaps(device, [...this.textures.values()]);
      await checkedGpu(device, 'uniforms and material bindings', () =>
        this.createBindings(),
      );
      await this.createPipelines(module);
      await checkedGpu(device, 'initialization completion', () =>
        device.queue.onSubmittedWorkDone(),
      );
    } finally {
      closeImages(images);
    }
  }

  private createBindings(): void {
    const device = this.device;
    const frameLayout = device.createBindGroupLayout({
      label: 'glTF frame layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', minBindingSize: FRAME_BYTES },
        },
      ],
    });
    const objectLayout = device.createBindGroupLayout({
      label: 'glTF object layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: {
            type: 'uniform',
            hasDynamicOffset: true,
            minBindingSize: OBJECT_BYTES,
          },
        },
      ],
    });
    const materialEntries: GPUBindGroupLayoutEntry[] = [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', minBindingSize: MATERIAL_BYTES },
      },
    ];
    for (let slot = 0; slot < 5; slot++) {
      materialEntries.push(
        {
          binding: slot * 2 + 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
        {
          binding: slot * 2 + 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      );
    }
    const materialLayout = device.createBindGroupLayout({
      label: 'glTF material layout',
      entries: materialEntries,
    });
    this.pipelineLayout = device.createPipelineLayout({
      label: 'glTF PBR pipeline layout',
      bindGroupLayouts: [frameLayout, objectLayout, materialLayout],
    });
    this.frameBuffer = this.createUniformBuffer(FRAME_BYTES, 'frame uniforms');
    this.objectBuffer = this.createUniformBuffer(
      this.objectScratch.byteLength,
      'object uniforms',
    );
    this.frameBindGroup = device.createBindGroup({
      label: 'glTF frame bindings',
      layout: frameLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.frameBuffer, size: FRAME_BYTES },
        },
      ],
    });
    this.objectBindGroup = device.createBindGroup({
      label: 'glTF dynamic object bindings',
      layout: objectLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.objectBuffer, size: OBJECT_BYTES },
        },
      ],
    });
    for (const material of this.plan.materials) {
      const uniform = this.createStaticBuffer(
        material.uniforms,
        GPUBufferUsage.UNIFORM,
        `${material.name} uniforms`,
      );
      const entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: { buffer: uniform, size: MATERIAL_BYTES } },
      ];
      for (const [slot, binding] of material.bindings.entries()) {
        entries.push(
          {
            binding: slot * 2 + 1,
            resource: requiredResource(
              this.views,
              binding.textureKey,
              'texture view',
            ),
          },
          {
            binding: slot * 2 + 2,
            resource: requiredResource(
              this.samplers,
              binding.samplerKey,
              'sampler',
            ),
          },
        );
      }
      this.materials.push(
        device.createBindGroup({
          label: `glTF ${material.name}`,
          layout: materialLayout,
          entries,
        }),
      );
    }
  }

  private async createPipelines(module: GPUShaderModule): Promise<void> {
    const variants = new Map<string, PipelineVariant>();
    for (const sampleCount of this.options.sampleCounts) {
      for (const material of this.plan.materials) {
        for (const mirrored of [false, true]) {
          for (const wireframe of [false, true]) {
            const variant: PipelineVariant = {
              sampleCount,
              blend: material.alphaMode === 'BLEND',
              doubleSided: material.doubleSided,
              mirrored,
              wireframe,
            };
            variants.set(pipelineKey(variant), variant);
          }
        }
      }
    }
    const layout = initialized(this.pipelineLayout, 'pipeline layout');
    await Promise.all(
      [...variants].map(async ([key, variant]) => {
        const pipeline = await checkedGpu(this.device, `pipeline ${key}`, () =>
          this.device.createRenderPipelineAsync({
            label: `glTF ${key}`,
            layout,
            vertex: { module, entryPoint: 'vs', buffers: [VERTEX_LAYOUT] },
            fragment: {
              module,
              entryPoint: 'fs',
              targets: [
                {
                  format: this.options.colorFormat,
                  writeMask: GPUColorWrite.ALL,
                  blend: variant.blend
                    ? {
                        color: {
                          srcFactor: 'src-alpha',
                          dstFactor: 'one-minus-src-alpha',
                          operation: 'add',
                        },
                        alpha: {
                          srcFactor: 'one',
                          dstFactor: 'one-minus-src-alpha',
                          operation: 'add',
                        },
                      }
                    : undefined,
                },
              ],
            },
            primitive: {
              topology: variant.wireframe ? 'line-list' : 'triangle-list',
              frontFace: variant.mirrored ? 'cw' : 'ccw',
              cullMode:
                variant.doubleSided || variant.wireframe ? 'none' : 'back',
            },
            depthStencil: {
              format: this.options.depthFormat,
              depthWriteEnabled: !variant.blend,
              depthCompare: 'less-equal',
            },
            multisample: { count: variant.sampleCount },
          }),
        );
        this.pipelines.set(key, pipeline);
      }),
    );
  }

  render(
    pass: GPURenderPassEncoder,
    frame: GltfFrame,
    sampleCount = this.options.sampleCount,
  ): GltfRenderStats {
    if (this.disposed)
      throw new Error('glTF WebGPU renderer has been disposed.');
    if (!this.options.sampleCounts.includes(sampleCount)) {
      throw new Error(
        `glTF WebGPU sample count ${sampleCount} was not prepared.`,
      );
    }
    writeFrameUniforms(
      this.frameScratch,
      frame,
      this.options.colorFormat.endsWith('-srgb'),
    );
    updateDrawTransforms(this.plan.draws, frame);
    for (const draw of this.plan.draws) {
      if (!draw.visible) continue;
      writeObjectUniforms(
        this.objectScratch,
        (draw.index * this.objectStride) / 4,
        draw,
      );
    }
    const frameBuffer = initialized(this.frameBuffer, 'frame uniforms');
    const objectBuffer = initialized(this.objectBuffer, 'object uniforms');
    this.device.queue.writeBuffer(frameBuffer, 0, this.frameScratch);
    this.device.queue.writeBuffer(objectBuffer, 0, this.objectScratch);
    pass.setBindGroup(0, initialized(this.frameBindGroup, 'frame bindings'));
    this.counters.drawCalls = 0;
    this.counters.triangles = 0;
    this.counters.lines = 0;
    let previousPipeline: GPURenderPipeline | undefined;
    for (const draw of this.plan.draws) {
      if (!draw.visible) continue;
      const geometry = requiredItem(
        this.geometry,
        draw.primitiveIndex,
        'GPU geometry',
      );
      const material = requiredItem(
        this.materials,
        draw.materialIndex,
        'GPU material',
      );
      const key = pipelineKey({
        sampleCount,
        blend: draw.material.alphaMode === 'BLEND',
        doubleSided: draw.material.doubleSided,
        mirrored: draw.handedness < 0,
        wireframe: frame.wireframe === true,
      });
      const pipeline = requiredResource(this.pipelines, key, 'PBR pipeline');
      if (pipeline !== previousPipeline) {
        pass.setPipeline(pipeline);
        previousPipeline = pipeline;
      }
      pass.setBindGroup(
        1,
        initialized(this.objectBindGroup, 'object bindings'),
        [draw.index * this.objectStride],
      );
      pass.setBindGroup(2, material);
      pass.setVertexBuffer(0, geometry.vertices);
      if (frame.wireframe) {
        pass.setIndexBuffer(geometry.lines, geometry.lineFormat);
        pass.drawIndexed(geometry.lineCount);
        this.counters.lines += geometry.lineCount / 2;
      } else {
        pass.setIndexBuffer(geometry.indices, geometry.indexFormat);
        pass.drawIndexed(geometry.indexCount);
        this.counters.triangles += geometry.indexCount / 3;
      }
      this.counters.drawCalls++;
    }
    return { ...this.counters };
  }

  /** Destroy only adapter-owned buffers/textures; the caller's device survives. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const buffer of this.buffers) buffer.destroy();
    for (const texture of this.textures.values()) texture.destroy();
    this.buffers.length = 0;
    this.geometry.length = 0;
    this.materials.length = 0;
    this.pipelines.clear();
    this.textures.clear();
    this.views.clear();
    this.samplers.clear();
    this.plan.draws.length = 0;
    this.plan.materials.length = 0;
    this.pipelineLayout = null;
    this.frameBuffer = null;
    this.objectBuffer = null;
    this.frameBindGroup = null;
    this.objectBindGroup = null;
    this.objectScratch = new Float32Array(0);
    this.counters.drawCalls = 0;
    this.counters.triangles = 0;
    this.counters.lines = 0;
    this.counters.geometryBytes = 0;
    this.counters.textureBytes = 0;
  }
}
