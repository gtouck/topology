import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  build: { rollupOptions: { input: { editor: fileURLToPath(new URL('./index.html', import.meta.url)), viewer: fileURLToPath(new URL('./viewer.html', import.meta.url)) } } },
});
