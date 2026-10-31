import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { parseHTML } from 'linkedom';
import type { ExtractedFile } from '@tibi/core';
import { htmlToMarkdown } from './html2md.js';

/**
 * 文件导入的正文抽取（06 extract_epub / extract_pdf / extract_docx，M4）。都转成 Markdown 交给 Core 的切分：
 * - EPUB：按 spine 顺序，每个章节文件一个 `#` 标题（目录里的名字，没有就用文件里第一个标题），形态是书；
 * - PDF：pdfjs 取文字，按行距把行拼回段落；大部分页没有文字时标 needs_ocr（扫描版）；有目录（outline）且超过 20 页时按目录分章、形态是书；
 * - DOCX：mammoth 转 HTML 再转 Markdown（标题、列表保留）。
 */
export async function extractFile(path: string): Promise<ExtractedFile> {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  const buf = new Uint8Array(await readFile(path));
  if (ext === 'epub') return extractEpub(buf);
  if (ext === 'pdf') return extractPdf(buf);
  if (ext === 'docx') return extractDocx(buf);
  throw new Error(`不支持 .${ext}`);
}

/* ---------- EPUB ---------- */
function xml(text: string) { return parseHTML(`<root>${text.replace(/<\?xml[^>]*>/, '')}</root>`).document; }
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
function resolve(base: string, href: string) {
  const parts = (dirOf(base) + decodeURIComponent(href.split('#')[0]!)).split('/'); const out: string[] = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return out.join('/');
}

export function extractEpub(buf: Uint8Array): ExtractedFile {
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
  // 目录：EPUB 3 的 nav，或 EPUB 2 的 toc.ncx；只取章节文件 → 名字
  const names = new Map<string, string>();
  const nav = [...manifest.values()].find(m => m.props.includes('nav'));
  if (nav) for (const a of xml(text(nav.href)).querySelectorAll('nav a')) { const h = a.getAttribute('href'); if (h) { const k = resolve(nav.href, h); if (!names.has(k)) names.set(k, a.textContent?.trim() ?? ''); } }
  const ncx = [...manifest.values()].find(m => /ncx/.test(m.type));
  if (ncx && !names.size) for (const np of xml(text(ncx.href)).querySelectorAll('navPoint')) { const src = np.querySelector('content')?.getAttribute('src'); const label = np.querySelector('navLabel text')?.textContent?.trim(); if (src && label) { const k = resolve(ncx.href, src); if (!names.has(k)) names.set(k, label); } }
  const parts: string[] = [];
  for (const item of spine) {
    const html = text(item.href); if (!html) continue;
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html.replace(/<head[\s\S]*?<\/head>/i, '');
    let md = htmlToMarkdown(body).trim();
    const words = md.split(/\s+/).filter(w => /[a-z]/i.test(w)).length;
    if (words < 40) continue;   // 封面、版权页、空白页
    const first = md.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
    const name = names.get(item.href) || first || `Chapter ${parts.length + 1}`;
    md = md.replace(/^#{1,6}\s+/gm, '## ');   // 章内标题降一级，`#` 只给章节
    if (first) md = md.replace(new RegExp(`^##\\s+${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n`, 'm'), '');
    parts.push(`# ${name}\n\n${md}`);
  }
  if (!parts.length) throw new Error('这个 EPUB 里没有找到正文');
  return { title, author, markdown: parts.join('\n\n'), kind: 'book' };
}

/* ---------- PDF ---------- */
export async function extractPdf(buf: Uint8Array): Promise<ExtractedFile> {
  // 打包成单文件 sidecar 后找不到 pdf.worker.mjs：先把 worker 模块挂到 globalThis.pdfjsWorker，pdfjs 的"假 worker"会直接用它
  const g = globalThis as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
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
export async function extractDocx(buf: Uint8Array): Promise<ExtractedFile> {
  const mammoth = await import('mammoth');
  const r = await mammoth.convertToHtml({ buffer: Buffer.from(buf) });
  const markdown = htmlToMarkdown(r.value).trim();
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return { title, markdown, kind: 'article' };
}
