import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: {
    sourcemap: true,
    rollupOptions: {
      // 多页：主窗口 + 独立设置窗口
      input: {
        main: 'index.html',
        settings: 'settings.html',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
