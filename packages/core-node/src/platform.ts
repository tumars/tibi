import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { mkdirSync } from 'node:fs';
import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { TibiError, type BackupStore, type FetchedPage, type Platform, type ReadableArticle } from '@tibi/core';
import { htmlToMarkdown } from './html2md.js';

/** 桌面运行时的 Platform 实现（05 §8 的网址规则在这里落地） */
export interface NodePlatformOptions {
  app_version: string;
  db_path: string;
  /** 取密钥：sidecar 模式下经壳的通道；dev 模式读环境变量 */
  getSecret: (ref: string) => Promise<string | undefined>;
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return PRIVATE_V4.some(r => r.test(ip));
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:');
}

/** 校验网址：只收 http(s)，解析后拒绝回环、内网、链路本地地址 */
export async function checkUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new TibiError('invalid_source', '网址格式不对'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new TibiError('invalid_source', '只支持 http 和 https 网址');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local')) throw new TibiError('invalid_source', '不能抓取本机或局域网地址');
  if (isIP(host)) { if (isPrivateAddress(host)) throw new TibiError('invalid_source', '不能抓取本机或局域网地址'); return u; }
  try {
    const addrs = await lookup(host, { all: true });
    if (addrs.length === 0 || addrs.some(a => isPrivateAddress(a.address))) throw new TibiError('invalid_source', '不能抓取本机或局域网地址');
  } catch (e) {
    if (e instanceof TibiError) throw e;
    throw new TibiError('offline', '解析不了这个域名。检查网络后再试');
  }
  return u;
}

/** 正文抽取前先删掉的块：导航、侧栏目录、面包屑、快捷键帮助、页脚 */
const NOISE = [
  'nav', '[role="navigation"]', '[role="banner"]', '[role="search"]', '[aria-hidden="true"]', 'script', 'style', 'noscript', 'template',
  '#mdbook-help-container', '#help-container', '#menu-bar', '#mdbook-menu-bar', '.menu-title', '#mdbook-sidebar', '#sidebar', '.sidebar', '.nav-chapters', '.nav-wrapper', '.mobile-nav-chapters', '#searchbar-outer', '#search-wrapper',
  '.toc', '#toc', '.table-of-contents', '.breadcrumb', '.breadcrumbs', '.skip-link', '.skip-to-content', '.theme-doc-toc-mobile', '.pagination-nav', '.headerlink', '.md-sidebar', '.md-header', '.md-footer',
  'body > header', 'body > footer', 'footer.footer', 'aside.sidebar', 'aside[role="navigation"]',
].join(', ');

/** 备份放在 app.db 旁边的 backups/ 目录；内存库（测试）没有 */
export function fileBackups(dbPath: string): BackupStore | undefined {
  if (!dbPath || dbPath === ':memory:') return undefined;
  const dir = join(dirname(dbPath), 'backups');
  return {
    pathFor(name) { mkdirSync(dir, { recursive: true }); return join(dir, name); },
    async list() {
      let names: string[] = [];
      try { names = await readdir(dir); } catch { return []; }
      const out = [];
      for (const name of names.filter(n => n.endsWith('.db'))) {
        const path = join(dir, name); const st = await stat(path).catch(() => undefined);
        if (st?.isFile()) out.push({ name, path, size: st.size, created_at: st.mtimeMs });
      }
      return out;
    },
    async remove(path) { if (dirname(path) === dir) await unlink(path).catch(() => undefined); },
  };
}

export function nodePlatform(opts: NodePlatformOptions): Platform {
  const allowed = new Set<string>();
  return {
    backups: fileBackups(opts.db_path),
    registerPaths(paths) { for (const p of paths) allowed.add(p); },
    isPathAllowed(path) { return allowed.has(path) || !!process.env.TIBI_DEV_ALLOW_ANY_PATH; },
    async fetchUrl(url, o = {}): Promise<FetchedPage> {
      let current = await checkUrl(url);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), o.timeout_ms ?? 20_000);
      o.signal?.addEventListener('abort', () => ctrl.abort());
      try {
        for (let hop = 0; hop < 5; hop++) {
          const res = await fetch(current, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': `Tibi/${opts.app_version} (+https://github.com/tumars/tibi)`, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' } });
          if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
            current = await checkUrl(new URL(res.headers.get('location')!, current).toString());   // 重定向每跳重查
            continue;
          }
          const content_type = res.headers.get('content-type') ?? '';
          const body = await res.text();
          return { status: res.status, final_url: current.toString(), content_type, body };
        }
        throw new TibiError('invalid_source', '重定向次数太多');
      } finally { clearTimeout(timer); }
    },
    async extractReadable(html, url): Promise<ReadableArticle> {
      const { document } = parseHTML(html);
      try { (document as unknown as { location: unknown }).location = new URL(url); } catch { /* linkedom 不需要 */ }
      const meta = (name: string) => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content') ?? undefined;
      const docTitle = document.title;
      // 先去掉导航、目录、快捷键帮助这类不是正文的块（文档站常见：mdBook、Docusaurus、Sphinx、MkDocs），Readability 有时会把它们当正文
      for (const el of [...document.querySelectorAll(NOISE)]) el.remove();
      // Readability 会丢掉 class / id 带 header 的块；文章头（h1 + 导语段落）常放在这种块里（如 MDN），去掉这类名字再交给它
      for (const el of [...document.querySelectorAll('[class*="header"], [id*="header"]')]) {
        const paras = [...el.querySelectorAll('p')].filter(x => (x.textContent ?? '').trim().length > 80);
        if (el.querySelector('h1') && paras.length) { el.removeAttribute('class'); el.removeAttribute('id'); }
      }
      // 文章自己的标题：优先正文区里的 h1，没有就用正文区第一个 h2（新版 mdBook），最后才是全页第一个 h1
      const titleEl = ['main h1', 'article h1', '[role="main"] h1', 'main h2', 'article h2', 'h1'].map(q => document.querySelector(q)).find(Boolean);
      const h1 = titleEl?.textContent?.trim() || undefined;
      // 标题下的导语段落（在 Readability 之前取，它可能把标题所在的块整个丢掉）
      let leadHtml = '';
      for (let el = titleEl?.parentElement, i = 0; el && i < 3; el = el.parentElement, i++) {
        const ps = [...el.querySelectorAll('p')].filter(x => (x.textContent ?? '').trim().length > 60).slice(0, 3);
        if (ps.length) { leadHtml = ps.map(x => x.outerHTML).join(''); break; }
      }
      const reader = new Readability(document as never, { keepClasses: false });
      const art = reader.parse();
      const contentHtml = art?.content ?? document.body?.innerHTML ?? '';
      let markdown = htmlToMarkdown(contentHtml, url);
      if (leadHtml) {
        const lead = htmlToMarkdown(leadHtml, url).trim();
        const probe = lead.replace(/\s+/g, ' ').slice(0, 50);
        if (probe && !markdown.replace(/\s+/g, ' ').includes(probe)) markdown = `${lead}\n\n${markdown}`;
      }
      const images: string[] = [...new Set((contentHtml.match(/<img[^>]+src="([^"]+)"/g) ?? []).map((m: string) => m.replace(/.*src="([^"]+)".*/, '$1')))];
      const published = meta('article:published_time') ?? meta('date') ?? meta('pubdate');
      return {
        title: art?.title || docTitle || url,
        site_name: art?.siteName ?? meta('og:site_name') ?? meta('application-name') ?? undefined,
        h1,
        byline: art?.byline ?? meta('author') ?? undefined,
        excerpt: art?.excerpt ?? meta('description') ?? undefined,
        lang: art?.lang ?? document.documentElement?.getAttribute('lang') ?? undefined,
        markdown, images,
        published_at: published ? (Date.parse(published) || undefined) : undefined,
      };
    },
    readFile: (path) => readFile(path).then(b => new Uint8Array(b)),
    getSecret: opts.getSecret,
    info: () => ({ app_version: opts.app_version, platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux', db_path: opts.db_path }),
    isOnline: () => true,
  };
}
