import mipmapSource from '../shaders/gltf-mipmap.wgsl?raw';
import { checkedGpu, checkedShaderModule } from './webgpuUtils';

/**
 * Initialization-only mip generation. Each pass reads one level and writes
 * the next; sRGB render attachments preserve linear-light filtering.
 * Submits only its own texture-initialization commands, never a host pass.
 */
export async function generateMipmaps(
  device: GPUDevice,
  textures: readonly GPUTexture[],
): Promise<void> {
  const mipmapped = textures.filter((texture) => texture.mipLevelCount > 1);
  if (mipmapped.length === 0) return;
  const module = await checkedShaderModule(
    device,
    mipmapSource,
    'gltf-mipmap.wgsl',
  );
  const { layout, pipelineLayout, sampler } = await checkedGpu(
    device,
    'mipmap bindings',
    () => {
      const layout = device.createBindGroupLayout({
        label: 'glTF mipmap layout',
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: 'float', viewDimension: '2d' },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: { type: 'filtering' },
          },
        ],
      });
      return {
        layout,
        pipelineLayout: device.createPipelineLayout({
          label: 'glTF mipmap pipeline layout',
          bindGroupLayouts: [layout],
        }),
        sampler: device.createSampler({
          label: 'glTF mipmap sampler',
          minFilter: 'linear',
          magFilter: 'linear',
          mipmapFilter: 'nearest',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge',
        }),
      };
    },
  );
  const pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  await Promise.all(
    [...new Set(mipmapped.map((texture) => texture.format))].map(
      async (format) => {
        const pipeline = await checkedGpu(
          device,
          `${format} mipmap pipeline`,
          () =>
            device.createRenderPipelineAsync({
              label: `glTF ${format} mipmap pipeline`,
              layout: pipelineLayout,
              vertex: { module, entryPoint: 'vs' },
              fragment: {
                module,
                entryPoint: 'fs',
                targets: [{ format }],
              },
              primitive: { topology: 'triangle-list' },
            }),
        );
        pipelines.set(format, pipeline);
      },
    ),
  );
  await checkedGpu(device, 'mipmap generation', () => {
    const encoder = device.createCommandEncoder({
      label: 'glTF texture mipmap initialization',
    });
    for (const texture of mipmapped) {
      const pipeline = pipelines.get(texture.format);
      if (!pipeline) {
        throw new Error(`No mipmap pipeline for ${texture.format}.`);
      }
      for (let level = 1; level < texture.mipLevelCount; level++) {
        const source = texture.createView({
          baseMipLevel: level - 1,
          mipLevelCount: 1,
        });
        const target = texture.createView({
          baseMipLevel: level,
          mipLevelCount: 1,
        });
        const bindGroup = device.createBindGroup({
          label: `glTF mipmap level ${level}`,
          layout,
          entries: [
            { binding: 0, resource: source },
            { binding: 1, resource: sampler },
          ],
        });
        const pass = encoder.beginRenderPass({
          label: `glTF mipmap level ${level}`,
          colorAttachments: [
            {
              view: target,
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
            },
          ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
      }
    }
    device.queue.submit([encoder.finish()]);
  });
}
