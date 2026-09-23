import { trianglesToLineIndices } from '../geometry';
import vertexSource from '../shaders/gltf.vert.glsl?raw';
import fragmentSource from '../shaders/gltf.frag.glsl?raw';
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
  OBJECT_FLOATS,
  closeImages,
  createRenderPlan,
  decodeImages,
  mipLevelCount,
  requiredItem,
  requiredResource,
  textureByteLength,
  updateDrawTransforms,
  writeFrameUniforms,
  writeObjectUniforms,
  type RenderPlan,
} from './rendererShared';

interface Geometry {
  vao: WebGLVertexArrayObject;
  indices: WebGLBuffer;
  indexType: number;
  indexCount: number;
  lines: WebGLBuffer;
  lineType: number;
  lineCount: number;
}

interface Material {
  uniform: WebGLBuffer;
  textures: WebGLTexture[];
  samplers: WebGLSampler[];
}

const ATTRIBUTES = [
  { size: 3, offset: 0 },
  { size: 3, offset: 12 },
  { size: 4, offset: 24 },
  { size: 2, offset: 40 },
  { size: 2, offset: 48 },
  { size: 4, offset: 56 },
];

function allocated<T>(value: T | null, label: string): T {
  if (value === null)
    throw new Error(`glTF WebGL2: could not allocate ${label}.`);
  return value;
}

function checkGl(gl: WebGL2RenderingContext, label: string): void {
  const errors: string[] = [];
  for (let attempt = 0; attempt < 16; attempt++) {
    const error = gl.getError();
    if (error === gl.NO_ERROR) break;
    errors.push(`0x${error.toString(16)}`);
    if (error === gl.CONTEXT_LOST_WEBGL) break;
  }
  if (errors.length || gl.isContextLost()) {
    throw new Error(
      `glTF WebGL2 ${label}: ${errors.join(', ') || 'context lost'}.`,
    );
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string,
): WebGLShader {
  const shader = allocated(gl.createShader(type), label);
  try {
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
      throw new Error(
        `glTF ${label} compilation failed:\n${gl.getShaderInfoLog(shader) ?? 'No compiler log.'}`,
      );
    }
    return shader;
  } catch (error) {
    gl.deleteShader(shader);
    throw error;
  }
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = compileShader(
    gl,
    gl.VERTEX_SHADER,
    vertexSource,
    'gltf.vert.glsl',
  );
  let fragment: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  try {
    fragment = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentSource,
      'gltf.frag.glsl',
    );
    program = allocated(gl.createProgram(), 'PBR program');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
      throw new Error(
        `glTF PBR program link failed:\n${gl.getProgramInfoLog(program) ?? 'No linker log.'}`,
      );
    }
    return program;
  } catch (error) {
    if (program) gl.deleteProgram(program);
    throw error;
  } finally {
    gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  }
}

/**
 * Static glTF draws into the caller's current draw framebuffer and viewport.
 * Never clears, resizes, changes scissor state, or owns the context.
 *
 * State is deliberately NOT saved/restored. create() uses unpack pixel-store
 * state/PBO binding, texture unit 0, VAO/buffer/program bindings. render() owns
 * the program, VAO, UBO bindings 0-2, texture/sampler units 0-4, active texture,
 * color/depth masks, depth test/range/function, culling/front face, blend state,
 * line width, stencil, polygon offset, rasterizer discard, sample coverage and
 * alpha-to-coverage. It leaves depth writes on and blending off. Host passes
 * must rebind their state. Framebuffer, draw buffers, viewport and scissor are
 * always left to the host; fragment output 0 must have a color attachment.
 *
 * output defaults to linear. Use a linear HDR attachment for site compositing;
 * srgb output applies exposure + ACES, encoding once (or via an sRGB attachment).
 * Geometry/materials are uploaded once; source draw transforms/visibility are live.
 */
export class WebGL2GltfRenderer {
  private readonly plan: RenderPlan;
  private readonly geometry: Geometry[] = [];
  private readonly materials: Material[] = [];
  private readonly buffers: WebGLBuffer[] = [];
  private readonly vaos: WebGLVertexArrayObject[] = [];
  private readonly textures = new Map<string, WebGLTexture>();
  private readonly samplers = new Map<string, WebGLSampler>();
  private readonly frameScratch = new Float32Array(FRAME_FLOATS);
  private readonly objectScratch = new Float32Array(OBJECT_FLOATS);
  private readonly counters: GltfRenderStats = {
    drawCalls: 0,
    triangles: 0,
    lines: 0,
    geometryBytes: 0,
    textureBytes: 0,
  };
  private program: WebGLProgram | null = null;
  private frameBuffer: WebGLBuffer | null = null;
  private objectBuffer: WebGLBuffer | null = null;
  private disposed = false;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    asset: GltfAsset,
  ) {
    this.plan = createRenderPlan(asset);
  }

  static async create(
    gl: WebGL2RenderingContext,
    asset: GltfAsset,
  ): Promise<WebGL2GltfRenderer> {
    const renderer = new WebGL2GltfRenderer(gl, asset);
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

  private createBuffer(
    target: number,
    data:
      | number
      | Float32Array<ArrayBuffer>
      | Uint16Array<ArrayBuffer>
      | Uint32Array<ArrayBuffer>,
    usage: number,
    label: string,
  ): WebGLBuffer {
    const gl = this.gl;
    const buffer = allocated(gl.createBuffer(), label);
    this.buffers.push(buffer);
    gl.bindBuffer(target, buffer);
    if (typeof data === 'number') gl.bufferData(target, data, usage);
    else gl.bufferData(target, data, usage);
    checkGl(gl, `${label} upload`);
    return buffer;
  }

  private async initialize(asset: GltfAsset): Promise<void> {
    const gl = this.gl;
    checkGl(
      gl,
      'initial state (the caller must provide an error-free context)',
    );
    const maxTextureSize: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (typeof maxTextureSize !== 'number' || maxTextureSize <= 0) {
      throw new Error('glTF WebGL2: invalid maximum texture size.');
    }
    const images = await decodeImages(
      asset.images,
      this.plan.textures,
      maxTextureSize,
    );
    try {
      this.program = createProgram(gl);
      gl.useProgram(this.program);
      for (const { name, binding, size } of [
        { name: 'GltfFrameUniforms', binding: 0, size: FRAME_BYTES },
        { name: 'GltfObjectUniforms', binding: 1, size: OBJECT_BYTES },
        { name: 'GltfMaterialUniforms', binding: 2, size: MATERIAL_BYTES },
      ]) {
        const block = gl.getUniformBlockIndex(this.program, name);
        if (block === gl.INVALID_INDEX) {
          throw new Error(
            `glTF WebGL2 shader is missing uniform block ${name}.`,
          );
        }
        const actualSize: unknown = gl.getActiveUniformBlockParameter(
          this.program,
          block,
          gl.UNIFORM_BLOCK_DATA_SIZE,
        );
        if (actualSize !== size) {
          throw new Error(
            `glTF ${name}: shader size ${String(actualSize)} does not match CPU size ${size}.`,
          );
        }
        gl.uniformBlockBinding(this.program, block, binding);
      }
      for (const [unit, name] of [
        'uBaseColorTexture',
        'uMetallicRoughnessTexture',
        'uNormalTexture',
        'uOcclusionTexture',
        'uEmissiveTexture',
      ].entries()) {
        const uniform = gl.getUniformLocation(this.program, name);
        if (uniform === null) {
          throw new Error(`glTF WebGL2 shader is missing sampler ${name}.`);
        }
        gl.uniform1i(uniform, unit);
      }
      this.frameBuffer = this.createBuffer(
        gl.UNIFORM_BUFFER,
        FRAME_BYTES,
        gl.DYNAMIC_DRAW,
        'frame uniforms',
      );
      this.objectBuffer = this.createBuffer(
        gl.UNIFORM_BUFFER,
        OBJECT_BYTES,
        gl.DYNAMIC_DRAW,
        'object uniforms',
      );
      for (const primitive of asset.primitives) {
        const vao = allocated(gl.createVertexArray(), `${primitive.name} VAO`);
        this.vaos.push(vao);
        gl.bindVertexArray(vao);
        this.createBuffer(
          gl.ARRAY_BUFFER,
          primitive.vertices,
          gl.STATIC_DRAW,
          `${primitive.name} vertices`,
        );
        for (const [location, attribute] of ATTRIBUTES.entries()) {
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(
            location,
            attribute.size,
            gl.FLOAT,
            false,
            GLTF_VERTEX_BYTES,
            attribute.offset,
          );
        }
        const indices = this.createBuffer(
          gl.ELEMENT_ARRAY_BUFFER,
          primitive.indices,
          gl.STATIC_DRAW,
          `${primitive.name} indices`,
        );
        const edges = trianglesToLineIndices(
          primitive.indices,
          primitive.vertices.length / GLTF_VERTEX_FLOATS,
        );
        const lines = this.createBuffer(
          gl.ELEMENT_ARRAY_BUFFER,
          edges,
          gl.STATIC_DRAW,
          `${primitive.name} wireframe`,
        );
        this.geometry.push({
          vao,
          indices,
          indexType:
            primitive.indices instanceof Uint32Array
              ? gl.UNSIGNED_INT
              : gl.UNSIGNED_SHORT,
          indexCount: primitive.indices.length,
          lines,
          lineType:
            edges instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
          lineCount: edges.length,
        });
        this.counters.geometryBytes +=
          primitive.vertices.byteLength +
          primitive.indices.byteLength +
          edges.byteLength;
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
      for (const plan of this.plan.textures) {
        const image =
          plan.source === undefined ? undefined : images.get(plan.source);
        if (plan.source !== undefined && image === undefined) {
          throw new Error(
            `glTF WebGL2: decoded image ${plan.source} is missing.`,
          );
        }
        const width = image?.width ?? 1;
        const height = image?.height ?? 1;
        const levels = mipLevelCount(width, height, plan.mipmapped);
        const texture = allocated(gl.createTexture(), `texture ${plan.key}`);
        this.textures.set(plan.key, texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texStorage2D(
          gl.TEXTURE_2D,
          levels,
          plan.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8,
          width,
          height,
        );
        if (image) {
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            image,
          );
        } else {
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            new Uint8Array([255, 255, 255, 255]),
          );
        }
        if (levels > 1) gl.generateMipmap(gl.TEXTURE_2D);
        checkGl(gl, `texture ${plan.key} upload/mipmap generation`);
        this.counters.textureBytes += textureByteLength(width, height, levels);
      }
      for (const plan of this.plan.samplers) {
        const sampler = allocated(gl.createSampler(), `sampler ${plan.key}`);
        this.samplers.set(plan.key, sampler);
        gl.samplerParameteri(
          sampler,
          gl.TEXTURE_MAG_FILTER,
          plan.descriptor.magFilter,
        );
        gl.samplerParameteri(
          sampler,
          gl.TEXTURE_MIN_FILTER,
          plan.descriptor.minFilter,
        );
        gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, plan.descriptor.wrapS);
        gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, plan.descriptor.wrapT);
      }
      for (const material of this.plan.materials) {
        this.materials.push({
          uniform: this.createBuffer(
            gl.UNIFORM_BUFFER,
            material.uniforms,
            gl.STATIC_DRAW,
            `${material.name} uniforms`,
          ),
          textures: material.bindings.map((binding) =>
            requiredResource(this.textures, binding.textureKey, 'texture'),
          ),
          samplers: material.bindings.map((binding) =>
            requiredResource(this.samplers, binding.samplerKey, 'sampler'),
          ),
        });
      }
      checkGl(gl, 'initialization');
    } finally {
      closeImages(images);
    }
  }

  private targetIsSrgb(): boolean {
    const gl = this.gl;
    const attachment: unknown = gl.getParameter(gl.DRAW_BUFFER0);
    if (typeof attachment !== 'number' || attachment === gl.NONE) {
      throw new Error('glTF WebGL2 requires color output 0 to be enabled.');
    }
    const encoding: unknown = gl.getFramebufferAttachmentParameter(
      gl.DRAW_FRAMEBUFFER,
      attachment,
      gl.FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING,
    );
    if (encoding !== gl.SRGB && encoding !== gl.LINEAR) {
      throw new Error(
        'glTF WebGL2 could not query the current color attachment.',
      );
    }
    return encoding === gl.SRGB;
  }

  render(frame: GltfFrame): GltfRenderStats {
    if (this.disposed)
      throw new Error('glTF WebGL2 renderer has been disposed.');
    const gl = this.gl;
    if (gl.isContextLost()) throw new Error('glTF WebGL2 context is lost.');
    writeFrameUniforms(this.frameScratch, frame, this.targetIsSrgb());
    updateDrawTransforms(this.plan.draws, frame);
    const frameBuffer = allocated(this.frameBuffer, 'frame uniforms');
    const objectBuffer = allocated(this.objectBuffer, 'object uniforms');
    gl.useProgram(allocated(this.program, 'PBR program'));
    gl.bindBuffer(gl.UNIFORM_BUFFER, frameBuffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.frameScratch);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, frameBuffer);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, objectBuffer);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthRange(0, 1);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.disable(gl.SAMPLE_COVERAGE);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.cullFace(gl.BACK);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    );
    gl.lineWidth(1);
    this.counters.drawCalls = 0;
    this.counters.triangles = 0;
    this.counters.lines = 0;
    try {
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
        writeObjectUniforms(this.objectScratch, 0, draw);
        gl.bindBuffer(gl.UNIFORM_BUFFER, objectBuffer);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.objectScratch);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 2, material.uniform);
        for (let unit = 0; unit < material.textures.length; unit++) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(
            gl.TEXTURE_2D,
            requiredItem(material.textures, unit, 'bound texture'),
          );
          gl.bindSampler(
            unit,
            requiredItem(material.samplers, unit, 'bound sampler'),
          );
        }
        if (draw.material.doubleSided || frame.wireframe)
          gl.disable(gl.CULL_FACE);
        else gl.enable(gl.CULL_FACE);
        gl.frontFace(draw.handedness < 0 ? gl.CW : gl.CCW);
        const blend = draw.material.alphaMode === 'BLEND';
        if (blend) gl.enable(gl.BLEND);
        else gl.disable(gl.BLEND);
        gl.depthMask(!blend);
        gl.bindVertexArray(geometry.vao);
        if (frame.wireframe) {
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.lines);
          gl.drawElements(gl.LINES, geometry.lineCount, geometry.lineType, 0);
          this.counters.lines += geometry.lineCount / 2;
        } else {
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indices);
          gl.drawElements(
            gl.TRIANGLES,
            geometry.indexCount,
            geometry.indexType,
            0,
          );
          this.counters.triangles += geometry.indexCount / 3;
        }
        this.counters.drawCalls++;
      }
      checkGl(gl, 'render');
    } finally {
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    return { ...this.counters };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    for (const vao of this.vaos) gl.deleteVertexArray(vao);
    for (const buffer of this.buffers) gl.deleteBuffer(buffer);
    for (const texture of this.textures.values()) gl.deleteTexture(texture);
    for (const sampler of this.samplers.values()) gl.deleteSampler(sampler);
    if (this.program) {
      if (gl.getParameter(gl.CURRENT_PROGRAM) === this.program) {
        gl.useProgram(null);
      }
      gl.deleteProgram(this.program);
    }
    this.program = null;
    this.frameBuffer = null;
    this.objectBuffer = null;
    this.buffers.length = 0;
    this.vaos.length = 0;
    this.geometry.length = 0;
    this.materials.length = 0;
    this.textures.clear();
    this.samplers.clear();
    this.plan.draws.length = 0;
    this.plan.materials.length = 0;
    this.counters.drawCalls = 0;
    this.counters.triangles = 0;
    this.counters.lines = 0;
    this.counters.geometryBytes = 0;
    this.counters.textureBytes = 0;
  }
}
