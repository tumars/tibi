// Web 版的 Service Worker（docs/design/12-web.md §2）：书里的插图存在 OPFS 的 assets/<key>/<name>（db.worker.ts 写），
// 页面里的 <img src="__assets/<key>/<name>"> 由这里读出来。只在 Web 版注册（web/main.tsx），桌面和手机不用。
const PREFIX = new URL('__assets/', self.registration.scope).pathname;
const SAFE = /^[\w-]+\/[\w-][\w.-]*$/;
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(PREFIX)) return;
  const rel = decodeURIComponent(url.pathname.slice(PREFIX.length));
  if (!SAFE.test(rel)) { e.respondWith(new Response('', { status: 404 })); return; }
  e.respondWith((async () => {
    try {
      const [key, name] = rel.split('/');
      const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('assets')).getDirectoryHandle(key);
      const file = await (await dir.getFileHandle(name)).getFile();
      const type = TYPES[name.split('.').pop().toLowerCase()] ?? 'application/octet-stream';
      return new Response(file, { headers: { 'content-type': type, 'cache-control': 'private, max-age=31536000, immutable' } });
    } catch {
      return new Response('', { status: 404 });
    }
  })());
});
