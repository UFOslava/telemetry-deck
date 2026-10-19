import { defineConfig } from 'vite';

// Local dev backend target. scripts/dev.sh sets BACKEND_PROXY when it uses a
// non-default port; production relies on the nginx reverse proxy instead.
const backendProxy = process.env.BACKEND_PROXY || 'http://localhost:8000';
const wsProxy = backendProxy.replace(/^http/, 'ws');

export default defineConfig({
  // Top-level await (disk settings load) needs a modern build target
  build: { target: 'esnext' },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': backendProxy,
      '/ws': { target: wsProxy, ws: true }
    }
  }
});
