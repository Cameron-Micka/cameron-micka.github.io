import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export function createModuleTestServer() {
  return createServer({
    configFile: false,
    root: fileURLToPath(new URL('../..', import.meta.url)),
    resolve: {
      alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
    },
    appType: 'custom',
    server: {
      middlewareMode: true,
      // Vite 5 otherwise binds its default HMR port even with hmr: false.
      hmr: { server: createHttpServer() },
      watch: null,
    },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
}
