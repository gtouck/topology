import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({ build: {
  outDir: 'dist-viewer', emptyOutDir: true,
  lib: { entry: fileURLToPath(new URL('./src/viewer-index.ts', import.meta.url)), name: 'TopologyKit', formats: ['es', 'umd'], fileName: (format) => format === 'es' ? 'topology-viewer.js' : 'topology-viewer.umd.js' },
} });
