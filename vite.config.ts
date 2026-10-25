import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import budgets from './scripts/artifact-budgets.json';
const serverMode = process.env.TOPOLOGY_STORAGE_MODE === 'server';
export default defineConfig({
  plugins: serverMode ? [{ name: 'server-storage-mode', transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'topology-storage', content: 'server' }, injectTo: 'head' }] }] : [],
  server: serverMode ? { proxy: { '/api': { target: process.env.TOPOLOGY_API_ORIGIN || 'http://127.0.0.1:3001', changeOrigin: false } } } : {},
  build: { chunkSizeWarningLimit: budgets.editorChunk.bytes / 1000, rollupOptions: { input: { editor: fileURLToPath(new URL('./index.html', import.meta.url)), viewer: fileURLToPath(new URL('./viewer.html', import.meta.url)) } } },
});
