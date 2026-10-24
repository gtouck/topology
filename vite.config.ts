import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import budgets from './scripts/artifact-budgets.json';
export default defineConfig({
  build: { chunkSizeWarningLimit: budgets.editorChunk.bytes / 1000, rollupOptions: { input: { editor: fileURLToPath(new URL('./index.html', import.meta.url)), viewer: fileURLToPath(new URL('./viewer.html', import.meta.url)) } } },
});
