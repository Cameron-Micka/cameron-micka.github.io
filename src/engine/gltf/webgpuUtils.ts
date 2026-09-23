/**
 * Pop scopes before awaiting: asynchronous initialization must not leave an
 * error scope on the caller's device while unrelated host code is running.
 * Async pipeline rejections are handled alongside scoped allocation errors.
 */
export async function checkedGpu<T>(
  device: GPUDevice,
  label: string,
  operation: () => T,
): Promise<Awaited<T>> {
  device.pushErrorScope('internal');
  device.pushErrorScope('out-of-memory');
  device.pushErrorScope('validation');
  const result: Promise<Awaited<T>> = (() => {
    try {
      return Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error);
    }
  })();
  const scopes = Promise.all([
    device.popErrorScope(),
    device.popErrorScope(),
    device.popErrorScope(),
  ]);
  try {
    const [value, errors] = await Promise.all([result, scopes]);
    const messages = errors.flatMap((error) => (error ? [error.message] : []));
    if (messages.length) throw new Error(messages.join('\n'));
    return value;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`glTF WebGPU ${label}: ${message}`, { cause });
  }
}

export async function checkedShaderModule(
  device: GPUDevice,
  code: string,
  label: string,
): Promise<GPUShaderModule> {
  const module = await checkedGpu(device, `${label} creation`, () =>
    device.createShaderModule({ label, code }),
  );
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === 'error');
  if (errors.length) {
    throw new Error(
      `glTF ${label} compilation failed:\n${errors
        .map(
          (message) =>
            `${message.lineNum}:${message.linePos}: ${message.message}`,
        )
        .join('\n')}`,
    );
  }
  return module;
}
