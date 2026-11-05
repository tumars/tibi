import { strFromU8, unzipSync } from 'fflate';
import type { ExtractedFile } from '../platform.js';
import { htmlToMarkdown, type HtmlParser } from './html.js';

/**
 * 文件导入的正文抽取（06 extract_epub / extract_pdf / extract_docx，M4）。都转成 Markdown 交给 Core 的切分：
 * - EPUB：按 spine 顺序，每个章节文件一个 `#` 标题（目录里的名字，没有就用文件里第一个标题），形态是书；
 *   单独成块的插图经 saveAsset 存到正文外面，正文里留 `![alt](地址)`（没有 saveAsset 时图片去掉）；
 * - PDF：pdfjs 取文字，按行距把行拼回段落；大部分页没有文字时标 needs_ocr（扫描版）；有目录（outline）且超过 20 页时按目录分章、形态是书；
 * - DOCX：mammoth 转 HTML 再转 Markdown（标题、列表保留）。
 * 不绑运行时：HTML 解析器、pdfjs、mammoth 由调用方给（桌面 Core 用 Node 版，手机上 Core 在 WebView 里用浏览器版，T28）。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ExtractDeps {
  parse: HtmlParser;
  /** 返回 pdfjs 模块（已经设好 worker） */
  pdfjs?: () => Promise<any>;
  /** DOCX → HTML（mammoth） */
  docxToHtml?: (buf: Uint8Array) => Promise<string>;
  /** 存一张书里的图片（Platform.saveAsset），返回正文里用的地址 */
  saveAsset?: (key: string, name: string, data: Uint8Array) => Promise<string>;
}

export async function extractBuffer(name: string, buf: Uint8Array, deps: ExtractDeps): Promise<ExtractedFile> {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'epub') return extractEpub(buf, deps);
  if (ext === 'pdf') return extractPdf(buf, deps);
  if (ext === 'docx') return extractDocx(buf, deps);
  throw new Error(`不支持 .${ext}`);
}

/* ---------- EPUB ---------- */
const xmlOf = (parse: HtmlParser) => (text: string) => parse(`<root>${text.replace(/<\?xml[^>]*>/, '')}</root>`);
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
function resolve(base: string, href: string) {
  const parts = (dirOf(base) + decodeURIComponent(href.split('#')[0]!)).split('/'); const out: string[] = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return out.join('/');
}

const IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)$/gm;
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
const IMAGE_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

/** PNG / GIF / JPEG / WebP 的像素尺寸（读文件头）；认不出返回 undefined */
export function imageSize(b: Uint8Array): { w: number; h: number } | undefined {
  const u16 = (i: number) => (b[i]! << 8) | b[i + 1]!; const u32 = (i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: u32(16), h: u32(20) };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { w: b[6]! | (b[7]! << 8), h: b[8]! | (b[9]! << 8) };
  if (b.length > 30 && b[0] === 0x52 && b[8] === 0x57 && b[12] === 0x56) {   // RIFF....WEBPVP8
    if (b[15] === 0x20) return { w: (b[26]! | (b[27]! << 8)) & 0x3fff, h: (b[28]! | (b[29]! << 8)) & 0x3fff };
    if (b[15] === 0x4c) return { w: 1 + (b[21]! | ((b[22]! & 0x3f) << 8)), h: 1 + (((b[22]! >> 6) | (b[23]! << 2) | ((b[24]! & 0x0f) << 10))) };
    if (b[15] === 0x58) return { w: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), h: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) return undefined;
      const m = b[i + 1]!;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16(i + 7), h: u16(i + 5) };
      i += 2 + u16(i + 2);
    }
  }
  return undefined;
}

/** 装饰小图（花饰、分隔线、首字下沉）不当插图：文件头或标签上的尺寸太小 */
function isDecorative(el: Element, data: Uint8Array): boolean {
  const size = imageSize(data);
  const w = size?.w ?? (Number(el.getAttribute('width')) || 0); const h = size?.h ?? (Number(el.getAttribute('height')) || 0);
  if (w && h) return Math.min(w, h) < 24 || w * h < 64 * 64;
  return data.length < 1024;
}

export async function extractEpub(buf: Uint8Array, deps: ExtractDeps): Promise<ExtractedFile> {
  const xml = xmlOf(deps.parse);
  const files = unzipSync(buf);
  const text = (p: string) => (files[p] ? strFromU8(files[p]!) : '');
  const container = xml(text('META-INF/container.xml'));
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath || !files[opfPath]) throw new Error('这个 EPUB 文件不完整（找不到 content.opf）');
  const opf = xml(text(opfPath));
  const meta = (tag: string) => opf.querySelector(tag)?.textContent?.trim() || undefined;
  const title = meta('dc\\:title') ?? meta('title'); const author = meta('dc\\:creator') ?? meta('creator');
  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const it of opf.querySelectorAll('manifest item')) manifest.set(it.getAttribute('id')!, { href: resolve(opfPath, it.getAttribute('href') ?? ''), type: it.getAttribute('media-type') ?? '', props: it.getAttribute('properties') ?? '' });
  const spine = [...opf.querySelectorAll('spine itemref')].map(i => manifest.get(i.getAttribute('idref') ?? '')).filter((m): m is { href: string; type: string; props: string } => !!m && /html/.test(m.type));
  // 目录：EPUB 3 的 nav，或 EPUB 2 的 toc.ncx：章节文件 → 名字；带锚点的另记下（一个文件里放了好几章的书按锚点分章）
  const names = new Map<string, string>(); const anchors = new Map<string, { id: string; name: string }[]>(); const wholeFiles = new Set<string>();
  const toc = (base: string, h: string, label: string) => {
    const k = resolve(base, h); if (!names.has(k)) names.set(k, label);
    const frag = h.split('#')[1]; if (!frag) wholeFiles.add(k); else { const a = anchors.get(k) ?? []; a.push({ id: decodeURIComponent(frag), name: label }); anchors.set(k, a); }
  };
  const nav = [...manifest.values()].find(m => m.props.includes('nav'));
  if (nav) for (const a of xml(text(nav.href)).querySelectorAll('nav a')) { const h = a.getAttribute('href'); if (h) toc(nav.href, h, a.textContent?.trim() ?? ''); }
  const ncx = [...manifest.values()].find(m => /ncx/.test(m.type));
  if (ncx && !names.size) for (const np of xml(text(ncx.href)).querySelectorAll('navPoint')) { const src = np.querySelector('content')?.getAttribute('src'); const label = np.querySelector('navLabel text')?.textContent?.trim(); if (src && label) toc(ncx.href, src, label); }
  // 正文：<body> 里面；Project Gutenberg 的版权头尾（pg-start-separator 之前、pg-end-separator 之后）不要
  let ended = false;
  const bodies = new Map<string, string>();
  for (const item of spine) {
    if (ended) break;
    const html = text(item.href); if (!html) continue;
    let body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html.replace(/<head[\s\S]*?<\/head>/i, '');
    const st = body.search(/<[^>]+id="pg-start-separator"/); if (st >= 0) { const close = body.indexOf('</div>', st); body = close >= 0 ? body.slice(close + 6) : body.slice(st); }
    const en = body.search(/<[^>]+id="pg-end-separator"/); if (en >= 0) { body = body.slice(0, en); ended = true; }
    bodies.set(item.href, body);
  }
  // 只有一张图的页（制书工具给每幅插图配的“看大图”页）：别的页链过来的就是附属页，不单独当插图，链接本身也去掉
  const plain = (b: string) => b.replace(/<[^>]+>/g, ' ').replace(/&[#\w]+;/g, ' ');
  const imagePages = new Set(spine.map(i => i.href).filter(h => { const b = text(h); return /<img\b/i.test(b) && plain(b.replace(/<head[\s\S]*?<\/head>/i, '')).split(/\s+/).filter(w => /[a-z]/i.test(w)).length < 40; }));
  const linked = new Set<string>();
  for (const [h, b] of bodies) for (const m of b.matchAll(/<a\b[^>]*href="([^"#]+)/gi)) { const k = resolve(h, m[1]!); if (k !== h) linked.add(k); }
  const dropImageLinks = (h: string, b: string) => b.replace(/<a\b[^>]*href="([^"#]*)[^"]*"[^>]*>[\s\S]*?<\/a>/gi, (m, href: string) => { const k = href && resolve(h, href); return k && (imagePages.has(k) || IMAGE_TYPES[k.split('.').pop()?.toLowerCase() ?? '']) ? '' : m; });
  // 按锚点分章：只认目录锚点最多落在的那一级标题（h2 之类）；别的锚点（副标题、章首句）不分
  const tagOf = (b: string, id: string) => {
    const m = b.match(new RegExp(`<(\\w+)\\b[^>]*\\sid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`)); if (!m) return undefined;
    let tag = m[1]!.toLowerCase();
    if (tag === 'a') tag = b.slice(m.index! + m[0].length).match(/^\s*(?:<\/a>\s*)?<(h[1-6])\b/i)?.[1]?.toLowerCase() ?? tag;   // <a id="…"></a><h2>
    return { tag, at: m.index! };
  };
  const levels = new Map<string, number>();
  for (const [h, list] of anchors) for (const a of list) { const t = bodies.has(h) ? tagOf(bodies.get(h)!, a.id)?.tag : undefined; if (t && /^h[1-6]$/.test(t)) levels.set(t, (levels.get(t) ?? 0) + 1); }
  const level = [...levels].sort((a, b) => b[1] - a[1])[0];
  const chapterTag = level && level[1] >= 2 ? level[0] : undefined;
  // 图片：每本书一个目录（按文件内容取名，重新导入同一本书落在同一处）；先在正文里放占位，章节选定后再存用到的
  const key = deps.saveAsset ? hex(await globalThis.crypto.subtle.digest('SHA-256', buf as Uint8Array<ArrayBuffer>)).slice(0, 24) : '';
  const pending = new Map<string, string>();   // 占位 → 包里的路径
  const toMd = (href: string, html: string) => htmlToMarkdown(dropImageLinks(href, html), undefined, deps.parse, deps.saveAsset ? { image(src, el) {
    if (/^[a-z][\w+.-]*:/i.test(src)) return undefined;   // 外链、data: 都不要
    const path = resolve(href, src); const data = files[path];
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    if (!data?.length || !IMAGE_TYPES[ext] || isDecorative(el, data)) return undefined;
    const ph = `tibi-epub-image-${pending.size}`; pending.set(ph, path); return ph;
  } } : undefined).trim();
  const wordsOf = (md: string) => md.replace(IMAGE_LINE, '').split(/\s+/).filter(w => /[a-z]/i.test(w)).length;
  const parts: string[] = [];
  let carry: string[] = [];   // 第一章前面（扉页、卷首插图）的图片，放到第一章开头
  const addPart = (md: string, name: string | undefined) => {
    const first = md.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
    md = md.replace(/^#{1,6}\s+/gm, '## ');   // 章内标题降一级，`#` 只给章节
    if (first) md = md.replace(new RegExp(`^##\\s+${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n`, 'm'), '');
    md = md.replace(/^##\s+(.+)$/gm, (m, t: string) => t.split(/\s+/).length > 12 && /[.!?’”]$/.test(t) ? t : m);   // 被标成标题的整句（章首句）还原成段落
    parts.push(`# ${name || first || `Chapter ${parts.length + 1}`}\n\n${carry.length ? carry.join('\n\n') + '\n\n' : ''}${md}`); carry = [];
  };
  for (const item of spine) {
    const body = bodies.get(item.href); if (body === undefined) continue;
    const cuts = chapterTag ? (anchors.get(item.href) ?? []).map(a => ({ ...a, ...tagOf(body, a.id) })).filter(a => a.tag === chapterTag && a.at !== undefined).sort((a, b) => a.at! - b.at!) : [];
    if (cuts.length) {
      // 一个文件里好几章：第一个锚点之前的是上一章的接续，或者（还没有章时）书前页，只留图片
      const head = toMd(item.href, body.slice(0, cuts[0]!.at));
      if (parts.length && wordsOf(head)) parts[parts.length - 1] += '\n\n' + head;
      else carry.push(...(head.match(IMAGE_LINE) ?? []).map(l => l.trim()));
      cuts.forEach((c, i) => addPart(toMd(item.href, body.slice(c.at!, cuts[i + 1]?.at)), c.name));
      continue;
    }
    if (linked.has(item.href) && imagePages.has(item.href)) continue;
    const md = toMd(item.href, body);
    // 按锚点分章的书：没有章节锚点、目录也没整页指过来的文件，是上一章的接续
    if (chapterTag && parts.length && !wholeFiles.has(item.href)) { if (md) parts[parts.length - 1] += '\n\n' + md; continue; }
    // 第一章之前的书名页、目录页（有“Contents”标题，或列着三个以上目录里的章名）：只留图片
    if (!parts.length && (/^#{1,6}\s+(table of )?contents\s*$/im.test(md) || [...names.values()].filter(n => n.length > 3 && md.includes(n)).length >= 3)) {
      carry.push(...(md.match(IMAGE_LINE) ?? []).map(l => l.trim())); continue;
    }
    if (wordsOf(md) < 40) {   // 封面、版权页、空白页；正文里单独一页的插图（整页插画）接在上一章后面，第一章之前的（封面）不要
      const imgs = md.match(IMAGE_LINE);
      if (imgs && parts.length) parts[parts.length - 1] += '\n\n' + imgs.map(l => l.trim()).join('\n\n');
      continue;
    }
    addPart(md, names.get(item.href));
  }
  if (!parts.length) throw new Error('这个 EPUB 里没有找到正文');
  let markdown = parts.join('\n\n');
  if (pending.size) {
    const saved = new Map<string, string>();   // 包里的路径 → 地址（同一张图在几处用只存一次）
    for (const [ph, path] of pending) {
      if (!markdown.includes(`](${ph})`)) continue;   // 在跳过的封面、版权页里
      let uri = saved.get(path);
      if (!uri) {
        const name = path.replace(/[^\w.-]+/g, '_').replace(/^[_.]+/, '');
        uri = await deps.saveAsset!(key, name, files[path]!).catch(() => '');
        saved.set(path, uri);
      }
      markdown = markdown.split(`](${ph})`).join(`](${uri})`);
    }
    markdown = markdown.replace(/^!\[[^\]]*\]\(\)\n*/gm, '');   // 没存成的图片去掉
  }
  return { title, author, markdown, kind: 'book' };
}

/* ---------- PDF ---------- */
export async function extractPdf(buf: Uint8Array, deps: ExtractDeps): Promise<ExtractedFile> {
  if (!deps.pdfjs) throw new Error('这个版本不能导入 PDF');
  const pdfjs = await deps.pdfjs();
  const doc = await pdfjs.getDocument({ data: buf, useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const info = (await doc.getMetadata().catch(() => undefined))?.info as { Title?: string; Author?: string } | undefined;
  const pages: string[] = []; let empty = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    // 按 y 分行，行距明显变大或行首缩进时分段
    const lines: { y: number; x: number; h: number; s: string }[] = [];
    for (const it of tc.items as { str: string; transform: number[]; height: number; hasEOL?: boolean }[]) {
      const y = Math.round(it.transform[5]!); const x = it.transform[4]!;
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) < 3) last.s += (last.s.endsWith(' ') || it.str.startsWith(' ') ? '' : ' ') + it.str;
      else lines.push({ y, x, h: it.height || 10, s: it.str });
    }
    const paras: string[] = []; let cur = '';
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k]!; const prev = lines[k - 1];
      const gap = prev ? prev.y - l.y : 0;
      if (prev && (gap > prev.h * 1.7 || gap < 0)) { if (cur.trim()) paras.push(cur.trim()); cur = ''; }
      const t = l.s.trim(); if (!t) continue;
      cur = cur.endsWith('-') && /^[a-z]/.test(t) ? cur.slice(0, -1) + t : cur ? `${cur} ${t}` : t;   // 行尾连字符断词拼回去
    }
    if (cur.trim()) paras.push(cur.trim());
    const pageText = paras.filter(p => !/^\d{1,4}$/.test(p)).join('\n\n');   // 去掉单独的页码
    if (pageText.replace(/\s/g, '').length < 30) empty++;
    pages.push(pageText);
    page.cleanup();
  }
  const needs_ocr = doc.numPages > 0 && empty / doc.numPages > 0.6;
  // 有目录且页数多：按目录第一层分章
  let markdown = pages.join('\n\n'); let kind: 'article' | 'book' = 'article';
  const outline = await doc.getOutline().catch(() => null);
  if (outline && outline.length >= 3 && doc.numPages > 20) {
    const starts: { title: string; page: number }[] = [];
    for (const o of outline) {
      try {
        const dest = typeof o.dest === 'string' ? await doc.getDestination(o.dest) : o.dest;
        if (dest && dest[0]) { const idx = await doc.getPageIndex(dest[0] as never); starts.push({ title: o.title.trim(), page: idx }); }
      } catch { /* 坏目录项 */ }
    }
    starts.sort((a, b) => a.page - b.page);
    if (starts.length >= 3) {
      kind = 'book';
      const pre = pages.slice(0, starts[0]!.page).join('\n\n').trim();
      markdown = (pre ? `# ${info?.Title || '前言'}\n\n${pre}\n\n` : '') + starts.map((s, i) => `# ${s.title}\n\n${pages.slice(s.page, starts[i + 1]?.page ?? pages.length).join('\n\n')}`).join('\n\n');
    }
  }
  await doc.destroy();
  return { title: info?.Title?.trim() || undefined, author: info?.Author?.trim() || undefined, markdown, kind, needs_ocr, pages: pages.length };
}

/* ---------- DOCX ---------- */
export async function extractDocx(buf: Uint8Array, deps: ExtractDeps): Promise<ExtractedFile> {
  if (!deps.docxToHtml) throw new Error('这个版本不能导入 Word');
  const markdown = htmlToMarkdown(await deps.docxToHtml(buf), undefined, deps.parse).trim();
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return { title, markdown, kind: 'article' };
}
