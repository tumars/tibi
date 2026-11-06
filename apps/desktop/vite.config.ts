import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const host = process.env.TAURI_DEV_HOST;
// Web 版（12）：TIBI_WEBAPP=1 时只打 web.html，输出到 dist-web/（scripts/build-webapp.mjs 再补上词典和边缘函数）
const webapp = !!process.env.TIBI_WEBAPP;
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * 开发时的 Web 版后端：/api/proxy 用和线上同一份边缘函数（web/edge-functions/api/proxy.js），
 * /dict/ 读 scripts/web-dict.mjs 生成在 .web-dict/ 里的精简词典。
 */
function webDev(): Plugin {
  return {
    name: 'tibi-web-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (url.startsWith('/dict/')) {
          const file = here(`./.web-dict/${url.slice('/dict/'.length).split('?')[0]}`);
          if (!/^[\w.-]+$/.test(url.slice(6).split('?')[0]!) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
          res.setHeader('content-type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
          createReadStream(file).pipe(res); return;
        }
        if (!url.startsWith('/api/proxy')) { next(); return; }
        try {
          const { handleProxy } = await import('./web/edge-functions/api/proxy.js');
          const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
          const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const r: Response = await handleProxy(new Request(`http://${req.headers.host}${url}`, { method: req.method, headers, body: /^(GET|HEAD)$/i.test(req.method ?? 'GET') ? undefined : Buffer.concat(chunks) }));
          res.statusCode = r.status;
          r.headers.forEach((v, k) => res.setHeader(k, v));
          if (r.body) Readable.fromWeb(r.body as never).pipe(res); else res.end();
        } catch (e) { res.statusCode = 500; res.end(String(e)); }
      });
    },
  };
}

// Tauri 开发时 vite 跑在 1420；浏览器模式（pnpm web）同样的端口，连 WebSocket 桥
export default defineConfig({
  plugins: [react(), tailwindcss(), webDev()],
  resolve: { alias: { '@': here('./src') } },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  // sqlite-wasm 要按原样加载自己的 wasm（Web 版的 db.worker.ts）
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  // 朗读的 Worker（lib/kokoro.worker.ts）要动态加载 kokoro-js、用 import.meta.url，只能打成 ES 模块
  worker: { format: 'es' },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    outDir: webapp ? 'dist-web' : 'dist',
    // 两个入口：桌面 index.html、手机 mobile.html（00 §3.13，独立的壳；Tauri 移动端的窗口指向 mobile.html）；Web 版单独打 web.html
    rollupOptions: { input: webapp ? { web: here('./web.html') } : { main: here('./index.html'), mobile: here('./mobile.html') } },
  },
});
