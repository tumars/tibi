import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

// Tauri 开发时 vite 跑在 1420；浏览器模式（pnpm web）同样的端口，连 WebSocket 桥
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  // 朗读的 Worker（lib/kokoro.worker.ts）要动态加载 kokoro-js、用 import.meta.url，只能打成 ES 模块
  worker: { format: 'es' },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // 两个入口：桌面 index.html、手机 mobile.html（00 §3.13，独立的壳；Tauri 移动端的窗口指向 mobile.html）
    rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), mobile: fileURLToPath(new URL('./mobile.html', import.meta.url)) } },
  },
});
