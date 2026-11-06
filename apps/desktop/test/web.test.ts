import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assembleCore, documents, fakePlatform, SqliteDict, type SearchResult } from '@tibi/core';
import { openLocalDbs, type Invoke } from '../src/mobile/local/driver';
import { createDbHost } from '../src/web/dbhost';
import { throughProxy, webFetch } from '../src/web/net';
import { browserName } from '../src/web/runtime';
// @ts-expect-error 边缘函数是纯 JS
import { blockedHost, handleProxy } from '../web/edge-functions/api/proxy.js';

/**
 * Web 版（12）：Worker 里的数据库命令用 Node 版 sqlite-wasm 的内存库跑（和浏览器里同一份 wasm，只是没有 OPFS），
 * 参数和结果过一遍结构化克隆（和 postMessage 一样）；中转函数用假的 fetch 测规则。
 */
async function wasmShell(dictRows?: [string, string, number][]): Promise<Invoke> {
  const sqlite3 = await sqlite3InitModule();
  const handle = createDbHost({
    app: () => ({ db: new sqlite3.oo1.DB(':memory:', 'c'), path: ':memory:' }),
    async dict() {
      if (!dictRows) return undefined;
      const d = new sqlite3.oo1.DB(':memory:', 'c');
      d.exec(`CREATE TABLE stardict (word TEXT NOT NULL, phonetic TEXT, definition TEXT, translation TEXT, pos TEXT, collins INTEGER, oxford INTEGER, tag TEXT, bnc INTEGER, frq INTEGER, exchange TEXT);
              CREATE TABLE lemma_map (form TEXT NOT NULL, lemma TEXT NOT NULL, rank INTEGER NOT NULL, PRIMARY KEY (form, lemma));`);
      for (const [w, zh, frq] of dictRows) d.exec({ sql: 'INSERT INTO stardict(word, translation, frq) VALUES (?, ?, ?)', bind: [w, zh, frq] });
      return d;
    },
  });
  return async <T>(cmd: string, args: Record<string, unknown>) => structuredClone(await handle(cmd, structuredClone(args))) as T;
}

describe('Web 版的数据库（sqlite-wasm，Worker 命令和手机壳同名）', () => {
  it('迁移、导入、搜索、事务回滚、BLOB 都能走通', async () => {
    const { db, dict } = await openLocalDbs(await wasmShell());
    expect(dict).toBeDefined();   // 词典总是"有"，下载完之前查词等着、没有时查不到
    expect((await db.get<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(9);
    const { core } = await assembleCore({ db, platform: fakePlatform(), device: 'desktop', resume: false });
    const { import_id } = await core.call<{ import_id: string }>('documents.import', { source: { type: 'text', text: 'The compiler enforces a small set of rules.\n\nA parser builds a syntax tree.' } });
    expect((await documents.importDone(import_id))?.ok).toBe(true);
    expect((await core.call<SearchResult>('search.query', { q: 'parser' })).documents).toHaveLength(1);
    await expect(db.transaction(async tx => { await tx.run("INSERT INTO tags(id, name, created_at, updated_at) VALUES ('t1', 'x', 1, 1)"); throw new Error('回滚'); })).rejects.toThrow('回滚');
    expect(await db.get("SELECT id FROM tags WHERE id = 't1'")).toBeUndefined();
    // run 的 changes 只算这一条；SELECT 不算
    expect((await db.run("UPDATE user_profile SET updated_at = 2 WHERE id = '1'")).changes).toBe(1);
    expect((await db.run('SELECT 1')).changes).toBe(0);
    await db.exec('CREATE TABLE b(x BLOB)');
    await db.run('INSERT INTO b VALUES (?)', [new Uint8Array([1, 2, 255])]);
    expect([...(await db.get<{ x: Uint8Array }>('SELECT x FROM b'))!.x]).toEqual([1, 2, 255]);
  });

  it('词典下载好之后能查；没有词典时查不到、不报错', async () => {
    const withDict = await openLocalDbs(await wasmShell([['compiler', 'n. 编译器', 9000]]));
    const d = new SqliteDict(withDict.dict!);
    expect((await d.lookup('Compiler'))?.translation).toBe('n. 编译器');
    expect(await d.frequencyRank('compiler')).toBe(9000);
    const none = new SqliteDict((await openLocalDbs(await wasmShell())).dict!);
    expect(await none.lookup('compiler')).toBeUndefined();
    expect(await none.lemmas('left')).toEqual([]);
  });
});

describe('中转 /api/proxy', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const req = (target: string, init: RequestInit & { site?: string } = {}) => {
    const h = new Headers(init.headers); h.set('sec-fetch-site', init.site ?? 'same-origin');
    return new Request(`https://app.tibi.test/api/proxy?url=${encodeURIComponent(target)}`, { ...init, headers: h });
  };

  it('拦本机、内网和保留地址', () => {
    for (const h of ['localhost', 'a.localhost', 'nas.local', '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', '[fd00::1]', '[fe80::1]', '[::ffff:127.0.0.1]']) expect(blockedHost(h), h).toBe(true);
    for (const h of ['example.com', '8.8.8.8', '172.32.0.1', '[2606:4700::1111]']) expect(blockedHost(h), h).toBe(false);
  });

  it('只给本站页面用，只认 http(s) 公网地址', async () => {
    expect((await handleProxy(req('https://example.com/', { site: 'cross-site' }))).status).toBe(403);
    const r = await handleProxy(req('http://192.168.1.1/'));
    expect(r.status).toBe(400);
    expect(decodeURIComponent(r.headers.get('x-tibi-proxy-error')!)).toContain('内网');
    expect((await handleProxy(req('file:///etc/passwd'))).status).toBe(400);
  });

  it('GET 跟重定向（每跳重查），去掉 cookie，回来带上最终地址', async () => {
    const seen: { url: string; cookie: string | null }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push({ url, cookie: new Headers(init.headers).get('cookie') });
      if (url === 'https://a.example/') return new Response('', { status: 301, headers: { location: '/b' } });
      return new Response('<html>ok</html>', { headers: { 'content-type': 'text/html', 'set-cookie': 'x=1' } });
    });
    const r = await handleProxy(req('https://a.example/', { headers: { cookie: 'secret=1', authorization: 'Bearer k' } }));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('<html>ok</html>');
    expect(r.headers.get('x-tibi-final-url')).toBe('https://a.example/b');
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(seen.map(s => s.url)).toEqual(['https://a.example/', 'https://a.example/b']);
    expect(seen.every(s => s.cookie === null)).toBe(true);

    vi.stubGlobal('fetch', async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } }));
    expect((await handleProxy(req('https://a.example/'))).status).toBe(400);
  });

  it('POST 不跟重定向（密钥不带去别处），location 改名免得浏览器自己跟', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { calls++; expect(new Headers(init.headers).get('authorization')).toBe('Bearer k'); return new Response('', { status: 307, headers: { location: 'https://evil.example/' } }); });
    const r = await handleProxy(req('https://api.example/v1/chat', { method: 'POST', body: '{}', headers: { authorization: 'Bearer k' } }));
    expect(calls).toBe(1);
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBeNull();
    expect(r.headers.get('x-tibi-location')).toBe('https://evil.example/');
  });
});

describe('Web 版的跨域请求', () => {
  it('经中转时 url 换回目标地址；中转报的错变成 TypeError', async () => {
    const page = vi.fn(async (u: RequestInfo | URL) => {
      expect(String(u)).toBe('/api/proxy?url=https%3A%2F%2Fa.example%2F');
      return new Response('hi', { headers: { 'x-tibi-final-url': 'https://a.example/b' } });
    }) as unknown as typeof fetch;
    const r = await throughProxy(page, 'https://a.example/');
    expect(r.url).toBe('https://a.example/b');
    expect(await r.text()).toBe('hi');
    const bad = (async () => new Response('', { status: 400, headers: { 'x-tibi-proxy-error': encodeURIComponent('不能访问本机或内网地址') } })) as unknown as typeof fetch;
    await expect(throughProxy(bad, 'https://a.example/')).rejects.toThrow('内网');
  });

  it('先直连，被 CORS 拦了再经中转，之后这个站点一直经中转', async () => {
    const calls: string[] = [];
    const page = (async (u: RequestInfo | URL) => {
      const s = String(u); calls.push(s);
      if (!s.startsWith('/api/proxy')) throw new TypeError('Failed to fetch');
      return new Response('ok');
    }) as typeof fetch;
    const f = webFetch(page);
    await f('https://api.example/v1', { method: 'POST', body: '{}' });
    await f('https://api.example/v2');
    expect(calls).toEqual(['https://api.example/v1', '/api/proxy?url=https%3A%2F%2Fapi.example%2Fv1', '/api/proxy?url=https%3A%2F%2Fapi.example%2Fv2']);
  });

  it('设备名', () => {
    expect(browserName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')).toBe('Safari（Mac）');
    expect(browserName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge（Windows）');
  });
});
