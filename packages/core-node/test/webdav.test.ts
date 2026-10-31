import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { sync } from '@tibi/core';

/** 最小 WebDAV 服务器（行为照 wsgidav：父目录不存在时 MKCOL / PUT 回 409，PROPFIND 的 XML 带 ns0: 前缀，Basic 认证） */
function davServer() {
  const files = new Map<string, Buffer>(); const dirs = new Set<string>(['/dav/']);
  const srv = createServer((req, res) => {
    if (req.headers.authorization !== 'Basic ' + Buffer.from('tibi:pw').toString('base64')) { res.writeHead(401).end(); return; }
    const path = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
    const parent = path.replace(/[^/]+\/?$/, '');
    const chunks: Buffer[] = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      if (req.method === 'MKCOL') { const d = path.endsWith('/') ? path : path + '/'; if (dirs.has(d)) { res.writeHead(405).end(); return; } if (!dirs.has(parent)) { res.writeHead(409).end(); return; } dirs.add(d); res.writeHead(201).end(); return; }
      if (req.method === 'PUT') { if (!dirs.has(parent)) { res.writeHead(409).end(); return; } files.set(path, Buffer.concat(chunks)); res.writeHead(201).end(); return; }
      if (req.method === 'GET') { const f = files.get(path); if (!f) { res.writeHead(404).end(); return; } res.writeHead(200).end(f); return; }
      if (req.method === 'DELETE') { files.delete(path); res.writeHead(204).end(); return; }
      if (req.method === 'PROPFIND') {
        const d = path.endsWith('/') ? path : path + '/'; if (!dirs.has(d)) { res.writeHead(404).end(); return; }
        const kids = [...files.keys()].filter(k => k.startsWith(d) && !k.slice(d.length).includes('/')).map(k => `<ns0:response><ns0:href>${encodeURI(k)}</ns0:href><ns0:propstat><ns0:prop><ns0:resourcetype /></ns0:prop></ns0:propstat></ns0:response>`);
        const sub = [...dirs].filter(k => k !== d && k.startsWith(d) && !k.slice(d.length, -1).includes('/')).map(k => `<ns0:response><ns0:href>${encodeURI(k)}</ns0:href><ns0:propstat><ns0:prop><ns0:resourcetype><ns0:collection /></ns0:resourcetype></ns0:prop></ns0:propstat></ns0:response>`);
        res.writeHead(207, { 'Content-Type': 'application/xml' }).end(`<?xml version="1.0"?><ns0:multistatus xmlns:ns0="DAV:"><ns0:response><ns0:href>${encodeURI(d)}</ns0:href></ns0:response>${kids.join('')}${sub.join('')}</ns0:multistatus>`);
        return;
      }
      res.writeHead(405).end();
    });
  });
  return new Promise<{ url: string; close: () => void; files: Map<string, Buffer> }>(r => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, close: () => srv.close(), files })));
}

describe('WebDAV 后端（08 §8）', () => {
  it('资料库目录不存在时逐级建好；读写列删；密码错报 auth', async () => {
    const s = await davServer();
    try {
      const bad = sync.webdavBackend({ url: `${s.url}/dav/a/Tibi Sync`, user: 'tibi', password: 'x' });
      await expect(bad.list('devices')).rejects.toMatchObject({ code: 'auth' });
      const b = sync.webdavBackend({ url: `${s.url}/dav/a/Tibi Sync`, user: 'tibi', password: 'pw' });
      expect(await b.list('devices')).toEqual([]);
      expect(await b.read('library.json')).toBeUndefined();
      await b.write('library.json', new TextEncoder().encode('{"x":1}'));
      await b.write('changes/dev1/0000000001.jsonl.gz', new Uint8Array([1, 2, 3]));
      expect(new TextDecoder().decode(await b.read('library.json'))).toBe('{"x":1}');
      expect(await b.list('changes/dev1')).toEqual(['0000000001.jsonl.gz']);
      expect(await b.list('changes')).toEqual([]);   // 子目录不算文件
      await b.remove('changes/dev1/0000000001.jsonl.gz');
      expect(await b.list('changes/dev1')).toEqual([]);
      expect([...s.files.keys()]).toContain('/dav/a/Tibi Sync/library.json');
    } finally { s.close(); }
  });
});
