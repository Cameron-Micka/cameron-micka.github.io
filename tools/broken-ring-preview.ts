import { loadGlb } from '../src/engine/gltf/loader';
import { OrbitCamera, rotateAround } from '../src/engine/gltf/OrbitCamera';
import type { GltfFrame, GltfRenderStats } from '../src/engine/gltf/types';
import { vec3, type Vec3 } from '../src/engine/math/vec3';

function element<T extends Element>(
  selector: string,
  type: { new (...args: never[]): T },
): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type))
    throw new Error(`Missing preview element: ${selector}`);
  return found;
}

const canvas = element('canvas', HTMLCanvasElement);
const status = element('#status', HTMLDivElement);
const stats = element('#stats', HTMLOutputElement);
const backendSelect = element('#backend', HTMLSelectElement);
const query = new URLSearchParams(location.search);
const backend = query.get('backend') ?? 'webgl2';
const background = query.get('background') ?? 'dark';
const modelUrl = query.get('model') ?? '/models/broken-ring.glb';
const ring =
  new URL(modelUrl, location.href).pathname === '/models/broken-ring.glb';
const station =
  new URL(modelUrl, location.href).pathname === '/models/death-star-ii.glb';
const lifecycle = new AbortController();
const events = { signal: lifecycle.signal };
let disposed = false;
let disposeGpu: (() => void) | undefined;
let orbit: OrbitCamera | undefined;
let request = 0;
let autoOrbit = false;
let wireframe = false;
let failed = false;
let lastTime: number | undefined;

function stop(): void {
  cancelAnimationFrame(request);
  request = 0;
  lastTime = undefined;
}

function showError(error: unknown): void {
  if (disposed) return;
  failed = true;
  stop();
  const message = error instanceof Error ? error.message : String(error);
  console.error('Native GLB preview failed:', error);
  status.textContent = `Unable to preview the model: ${message}`;
  status.hidden = false;
  for (const button of document.querySelectorAll('nav button')) {
    if (button instanceof HTMLButtonElement) button.disabled = true;
  }
}

function dispose(): void {
  if (disposed) return;
  disposed = true;
  stop();
  lifecycle.abort();
  orbit?.dispose();
  disposeGpu?.();
}

addEventListener('pagehide', dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);

async function start(): Promise<void> {
  if (backend !== 'webgl2' && backend !== 'webgpu') {
    throw new Error(`Unknown backend "${backend}". Choose webgl2 or webgpu.`);
  }
  if (background !== 'dark' && background !== 'pink') {
    throw new Error(
      `Unknown background "${background}". Choose dark or pink.`,
    );
  }
  const clearColor: Vec3 =
    background === 'pink' ? [1, 0, 0.5] : [5 / 255, 8 / 255, 14 / 255];
  backendSelect.value = backend;
  backendSelect.addEventListener(
    'change',
    () => {
      const url = new URL(location.href);
      url.searchParams.set('backend', backendSelect.value);
      location.replace(url);
    },
    events,
  );
  const asset = await loadGlb(modelUrl, { signal: lifecycle.signal });
  if (disposed) return;
  for (const warning of asset.warnings) console.warn(warning);
  element('#download', HTMLAnchorElement).href = modelUrl;
  if (!ring) {
    const title = station ? 'UNFINISHED STATION' : 'GLB PREVIEW';
    element('h1', HTMLHeadingElement).textContent = title;
    document.title = `${title} | Native PBR preview`;
    canvas.setAttribute('aria-label', `Interactive PBR preview: ${title}`);
  }
  if (station) {
    element('[data-view="front"]', HTMLButtonElement).textContent = 'Dish';
    element('[data-view="hull"]', HTMLButtonElement).textContent = 'Reverse';
    element('[data-view="fracture"]', HTMLButtonElement).textContent =
      'Structure';
  }
  let draw: (frame: GltfFrame) => GltfRenderStats;
  let resizeGpu: (width: number, height: number) => void;
  let getGpuError: () => number | string;
  let gpuDevice: GPUDevice | undefined;

  if (backend === 'webgl2') {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is unavailable.');
    const { WebGL2GltfRenderer } =
      await import('../src/engine/gltf/WebGL2GltfRenderer');
    const renderer = await WebGL2GltfRenderer.create(gl, asset);
    if (disposed) {
      renderer.dispose();
      return;
    }
    disposeGpu = () => renderer.dispose();
    resizeGpu = (width, height) => {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };
    getGpuError = () => gl.getError();
    draw = (frame) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.depthMask(true);
      gl.clearColor(...clearColor, 1);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      return renderer.render(frame);
    };
    canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        showError(
          new Error(
            'The WebGL context was lost. Reload to restore the preview.',
          ),
        );
      },
      events,
    );
  } else {
    if (!navigator.gpu)
      throw new Error('WebGPU is unavailable. Select WebGL2 instead.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter)
      throw new Error('No WebGPU adapter is available. Select WebGL2 instead.');
    const device = await adapter.requestDevice();
    gpuDevice = device;
    if (disposed) {
      device.destroy();
      return;
    }
    const onError = (event: GPUUncapturedErrorEvent) => {
      event.preventDefault();
      showError(new Error(event.error.message));
    };
    device.addEventListener('uncapturederror', onError);
    let depth: GPUTexture | undefined;
    let multisample: GPUTexture | undefined;
    let context: GPUCanvasContext | null = null;
    const owned: {
      renderer?: import('../src/engine/gltf/WebGPUGltfRenderer').WebGPUGltfRenderer;
    } = {};
    disposeGpu = () => {
      device.removeEventListener('uncapturederror', onError);
      owned.renderer?.dispose();
      depth?.destroy();
      multisample?.destroy();
      context?.unconfigure();
      device.destroy();
    };
    void device.lost.then((info) => {
      if (!disposed && info.reason !== 'destroyed')
        showError(
          new Error(`WebGPU device lost: ${info.message || info.reason}`),
        );
    });
    const format = navigator.gpu.getPreferredCanvasFormat();
    const { WebGPUGltfRenderer } =
      await import('../src/engine/gltf/WebGPUGltfRenderer');
    const renderer = await WebGPUGltfRenderer.create(device, asset, {
      colorFormat: format,
      depthFormat: 'depth24plus',
      sampleCount: 4,
    });
    owned.renderer = renderer;
    if (disposed) {
      renderer.dispose();
      return;
    }
    context = canvas.getContext('webgpu');
    if (!context) throw new Error('Could not create a WebGPU canvas context.');
    context.configure({ device, format, alphaMode: 'opaque' });
    resizeGpu = (width, height) => {
      canvas.width = width;
      canvas.height = height;
      depth?.destroy();
      multisample?.destroy();
      depth = device.createTexture({
        label: 'GLB preview depth',
        size: [width, height],
        format: 'depth24plus',
        sampleCount: 4,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      multisample = device.createTexture({
        label: 'GLB preview antialiasing',
        size: [width, height],
        format,
        sampleCount: 4,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    };
    getGpuError = () => (failed ? 'GPU error reported' : 0);
    draw = (frame) => {
      if (!context || !depth || !multisample)
        throw new Error('WebGPU preview targets are not initialized.');
      const encoder = device.createCommandEncoder({
        label: 'GLB preview frame',
      });
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: multisample.createView(),
            resolveTarget: context.getCurrentTexture().createView(),
            clearValue: {
              r: clearColor[0],
              g: clearColor[1],
              b: clearColor[2],
              a: 1,
            },
            loadOp: 'clear',
            storeOp: 'discard',
          },
        ],
        depthStencilAttachment: {
          view: depth.createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'discard',
        },
      });
      const result = renderer.render(pass, frame);
      pass.end();
      device.queue.submit([encoder.finish()]);
      return result;
    };
  }

  let renders = 0;
  let renderStats: GltfRenderStats | undefined;
  const camera = new OrbitCamera(canvas, () => render());
  orbit = camera;
  const center: Vec3 = [
    (asset.bounds.min[0] + asset.bounds.max[0]) / 2,
    (asset.bounds.min[1] + asset.bounds.max[1]) / 2,
    (asset.bounds.min[2] + asset.bounds.max[2]) / 2,
  ];
  const radius = Math.max(
    0.01,
    vec3.length(vec3.sub(asset.bounds.max, asset.bounds.min)) / 2,
  );
  camera.near = ring ? 0.1 : Math.max(0.001, radius / 100);
  camera.far = ring ? 200 : radius * 30;
  camera.minDistance = ring ? 3 : radius * 0.05;
  camera.maxDistance = ring ? 200 : radius * 20;
  let width = 0;
  let height = 0;
  function framing(): { scale: number; offset: number } {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    let scale = Math.max(1, (0.86 * height) / width);
    let offset = 0;
    if (width <= 600 || height <= 500) {
      const header = element('header', HTMLElement).getBoundingClientRect();
      const backend = element(
        '.backend',
        HTMLLabelElement,
      ).getBoundingClientRect();
      const footer = element('footer', HTMLElement).getBoundingClientRect();
      const top = Math.max(header.bottom, backend.bottom) + 12;
      const bottom = footer.top - 12;
      const available = Math.max(96, bottom - top);
      scale = Math.max(scale, (0.7 * height) / available);
      offset = 1 - (top + bottom) / height;
    }
    return { scale, offset };
  }
  let fitScale = framing().scale;
  const frame: GltfFrame = {
    viewProjection: camera.viewProjection,
    view: camera.view,
    cameraPosition: camera.position,
    keyLight: {
      direction: vec3.normalize([22, 15, 20]),
      color: [2.8 * 0.67, 2.8 * 0.8, 2.8],
    },
    fillLight: {
      direction: vec3.normalize([-12, 3, -18]),
      color: [0.43, 0.59, 0.98],
    },
    ambientSky: [0.32, 0.38, 0.46],
    ambientGround: [0.07, 0.08, 0.1],
    exposure: 1.25,
    output: 'srgb',
  };
  if (station) {
    frame.keyLight = {
      direction: vec3.normalize([-14, 24, 18]),
      color: [3.2, 3.25, 3.4],
    };
    frame.fillLight = {
      direction: vec3.normalize([14, -2, -8]),
      color: [0.3, 0.34, 0.42],
    };
    frame.ambientSky = [0.2, 0.22, 0.27];
    frame.ambientGround = [0.04, 0.05, 0.07];
    frame.exposure = 1.3;
  }

  function render(): void {
    if (disposed || failed || width === 0 || height === 0) return;
    camera.update(width / height);
    frame.cameraPosition = camera.position;
    frame.wireframe = wireframe;
    try {
      renderStats = draw(frame);
      renders++;
      stats.textContent = [
        `NATIVE ${backend.toUpperCase()} / CORE glTF 2.0`,
        `${asset.stats.triangles.toLocaleString()} triangles / ${renderStats.drawCalls} draws`,
        `${(asset.stats.fileBytes / 1048576).toFixed(2)} MiB GLB / ${asset.images.length} embedded images`,
        `${(renderStats.textureBytes / 1048576).toFixed(1)} MiB GPU textures / ${(renderStats.geometryBytes / 1048576).toFixed(2)} MiB geometry`,
        'GGX PBR / editable shaders / no Three.js',
      ].join('\n');
    } catch (error) {
      showError(error);
    }
  }

  const presets: Record<string, { position: Vec3; target: Vec3 }> = ring
    ? {
        reference: { position: [33, 6, 15], target: [0, 0.8, 0] },
        front: { position: [0, 0, 39], target: [0, 0.4, 0] },
        hull: { position: [29, 8, -22], target: [0, 1, 0] },
        fracture: { position: [14, 2, 8], target: [7.5, 5.8, 0] },
      }
    : station
      ? {
          reference: { position: [2, 1, 41], target: [0, 0, 0] },
          front: { position: [-8, 7, 18], target: [-3, 3.5, 8] },
          hull: { position: [8, 3, -37], target: [0, 0, 0] },
          fracture: { position: [21, 6, 17], target: [5, 1, 2] },
        }
      : {
          reference: {
            position: vec3.add(
              center,
              vec3.scale(vec3.normalize([1, 0.4, 1.3]), radius * 3.8),
            ),
            target: center,
          },
          front: {
            position: vec3.add(center, [0, 0, radius * 3.8]),
            target: center,
          },
          hull: {
            position: vec3.add(center, [0, radius, -radius * 3.8]),
            target: center,
          },
          fracture: {
            position: vec3.add(center, [0, 0, radius * 2.5]),
            target: center,
          },
        };

  function setView(name: string): void {
    const preset = presets[name];
    if (!preset) throw new Error(`Unknown preview view: ${name}`);
    const fit = framing();
    fitScale = fit.scale;
    camera.projectionOffsetY = fit.offset;
    camera.target = [...preset.target];
    camera.position = vec3.add(
      camera.target,
      vec3.scale(vec3.sub(preset.position, camera.target), fitScale),
    );
    camera.up = [0, 1, 0];
    if (name === 'reference' && ring)
      camera.up = rotateAround(
        camera.up,
        vec3.normalize(vec3.sub(camera.position, camera.target)),
        0.72,
      );
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      '[data-view]',
    )) {
      button.setAttribute('aria-pressed', String(button.dataset.view === name));
    }
    render();
  }

  function resize(): void {
    const dpr = Math.min(devicePixelRatio, 1.5);
    const nextWidth = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const nextHeight = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (width === nextWidth && height === nextHeight) return;
    width = nextWidth;
    height = nextHeight;
    resizeGpu(width, height);
    const fit = framing();
    const nextFit = fit.scale;
    camera.projectionOffsetY = fit.offset;
    camera.position = vec3.add(
      camera.target,
      vec3.scale(vec3.sub(camera.position, camera.target), nextFit / fitScale),
    );
    fitScale = nextFit;
    render();
  }

  function animate(time: number): void {
    request = 0;
    if (!autoOrbit || document.hidden || disposed || failed) return;
    const delta =
      lastTime === undefined ? 0 : Math.min(0.1, (time - lastTime) / 1000);
    lastTime = time;
    camera.orbit(delta * 0.045);
    request = requestAnimationFrame(animate);
  }

  function updateAnimation(): void {
    stop();
    if (autoOrbit && !document.hidden && !failed && !disposed)
      request = requestAnimationFrame(animate);
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-view]',
  )) {
    button.addEventListener(
      'click',
      () => setView(button.dataset.view ?? 'reference'),
      events,
    );
  }
  element('#wireframe', HTMLButtonElement).addEventListener(
    'click',
    (event) => {
      wireframe = !wireframe;
      if (event.currentTarget instanceof HTMLButtonElement)
        event.currentTarget.setAttribute('aria-pressed', String(wireframe));
      render();
    },
    events,
  );
  element('#rotate', HTMLButtonElement).addEventListener(
    'click',
    (event) => {
      autoOrbit = !autoOrbit;
      if (event.currentTarget instanceof HTMLButtonElement)
        event.currentTarget.setAttribute('aria-pressed', String(autoOrbit));
      updateAnimation();
    },
    events,
  );
  document.addEventListener('visibilitychange', updateAnimation, events);
  addEventListener('resize', resize, events);
  resize();
  setView(query.get('view') ?? 'reference');
  if (gpuDevice) await gpuDevice.queue.onSubmittedWorkDone();
  if (failed || disposed) return;
  const error = getGpuError();
  if (error !== 0) throw new Error(`GPU rejected the initial frame: ${error}`);
  status.hidden = true;

  const inspection = {
    backend,
    asset,
    camera,
    frame,
    render,
    setView,
    getGpuError,
    get renders() {
      return renders;
    },
    get stats() {
      return renderStats;
    },
    get autoOrbit() {
      return autoOrbit;
    },
    dispose,
  };
  Object.assign(globalThis, { ringPreview: inspection });
}

void start().catch((error: unknown) => {
  if (!disposed) {
    showError(error);
    disposeGpu?.();
    disposeGpu = undefined;
  }
});
