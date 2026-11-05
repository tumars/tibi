import { Readability } from '@mozilla/readability';
import type { ReadableArticle } from '../platform.js';

/**
 * 网页 → 正文 Markdown（00 §3.1）。不绑定某个 DOM 实现：桌面 Core（Node）传 linkedom 的解析，手机上 Core 跑在 WebView 里，传 DOMParser。
 */
export type HtmlParser = (html: string) => Document;

/** WebView 里的解析器 */
export const domParser: HtmlParser = html => new DOMParser().parseFromString(html, 'text/html');

/** 不是正文的块：导航、目录、快捷键帮助（文档站常见：mdBook、Docusaurus、Sphinx、MkDocs） */
export const NOISE = [
  'nav', '[role="navigation"]', '[role="banner"]', '[role="search"]', '[aria-hidden="true"]', 'script', 'style', 'noscript', 'template',
  '#mdbook-help-container', '#help-container', '#menu-bar', '#mdbook-menu-bar', '.menu-title', '#mdbook-sidebar', '#sidebar', '.sidebar', '.nav-chapters', '.nav-wrapper', '.mobile-nav-chapters', '#searchbar-outer', '#search-wrapper',
  '.toc', '#toc', '.table-of-contents', '.breadcrumb', '.breadcrumbs', '.skip-link', '.skip-to-content', '.theme-doc-toc-mobile', '.pagination-nav', '.headerlink', '.md-sidebar', '.md-header', '.md-footer',
  'body > header', 'body > footer', 'footer.footer', 'aside.sidebar', 'aside[role="navigation"]',
].join(', ');

/**
 * 很小的 HTML → Markdown：只保留 Tibi 需要的结构（标题、段落、列表、引用、代码块、行内代码、链接文字、强调），
 * 其余标签只取文字。代码块保留围栏并带语言（sections.content_md 的约定，01 §2）。
 * opts.image：单独成块的图片（不夹在文字里）交给它换成要存的地址，返回 undefined 就不要这张；不给时图片一律去掉（网页正文）。
 */
export interface HtmlToMarkdownOptions { image?: (src: string, el: Element) => string | undefined }
export function htmlToMarkdown(html: string, baseUrl: string | undefined, parse: HtmlParser, opts: HtmlToMarkdownOptions = {}): string {
  const document = parse(`<!doctype html><html><body>${html}</body></html>`);
  const out: string[] = [];
  // 图片块 ![alt](src)：alt 里的方括号、换行会弄坏这一行，去掉；像文件名的 alt（"0060m"、"img_12.jpg"，制书工具常这么填）不要，免得当成图注显示
  const image = (el: Element) => {
    const raw = el.getAttribute('src'); const src = raw && opts.image?.(raw, el); if (!src) return;
    const alt = (el.getAttribute('alt') ?? '').replace(/[[\]\s]+/g, ' ').trim();
    out.push(`![${/^[\w.-]*$/.test(alt) && /\d|\.(jpe?g|png|gif|webp|svg)$/i.test(alt) ? '' : alt}](${src})`, '');
  };
  // 只有图片、没有文字的块（EPUB 常见 <p><img/></p>、<div class="figure"><img/></div>）
  const onlyImages = (el: Element) => {
    if (!opts.image || (el.textContent ?? '').trim()) return undefined;
    const imgs = Array.from(el.querySelectorAll('img')) as Element[];
    return imgs.length ? imgs : undefined;
  };

  const text = (n: Node): string => {
    if (n.nodeType === 3) return (n.textContent ?? '').replace(/\s+/g, ' ');
    if (n.nodeType !== 1) return '';
    const el = n as Element; const tag = el.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (tag === 'code') return '`' + (el.textContent ?? '').replace(/`/g, '\\`') + '`';
    if (tag === 'strong' || tag === 'b') return '**' + inner(el).trim() + '**';
    if (tag === 'em' || tag === 'i') return '*' + inner(el).trim() + '*';
    if (tag === 'a') return inner(el);
    if (tag === 'img') return '';
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg' || tag === 'figure' && !el.querySelector('figcaption')) return '';
    return inner(el);
  };
  const inner = (el: Element): string => (Array.from(el.childNodes) as Node[]).map(text).join('');

  const block = (el: Element, depth = 0) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') { image(el); return; }
    const imgs = tag === 'pre' ? undefined : onlyImages(el);
    if (imgs) { for (const i of imgs) image(i); return; }
    if (/^h[1-6]$/.test(tag)) { const t = inner(el).trim(); if (t) out.push('#'.repeat(Number(tag[1])) + ' ' + t, ''); return; }
    if (tag === 'pre') {
      const code = el.querySelector('code');
      const cls = (code?.getAttribute('class') ?? el.getAttribute('class') ?? '');
      const lang = (cls.match(/(?:language|lang)-([\w+#-]+)/)?.[1] ?? cls.match(/\b(js|ts|rust|python|go|java|c|cpp|bash|shell|json|yaml|html|css|sql)\b/i)?.[1] ?? '').toLowerCase();
      const body = (code?.textContent ?? el.textContent ?? '').replace(/\n+$/, '');
      out.push('```' + lang, body, '```', ''); return;
    }
    if (tag === 'ul' || tag === 'ol') {
      let i = 1;
      for (const li of Array.from(el.children) as Element[]) {
        if (li.tagName.toLowerCase() !== 'li') continue;
        const nested = (Array.from(li.children) as Element[]).filter(c => /^(ul|ol)$/i.test(c.tagName));
        const own = (Array.from(li.childNodes) as Node[]).filter(c => !(c.nodeType === 1 && /^(ul|ol)$/i.test((c as Element).tagName))).map(text).join('').trim();
        out.push('  '.repeat(depth) + (tag === 'ol' ? `${i++}. ` : '- ') + own);
        for (const n of nested) block(n, depth + 1);
      }
      if (depth === 0) out.push('');
      return;
    }
    if (tag === 'blockquote') {
      const start = out.length; for (const c of Array.from(el.children) as Element[]) block(c);
      if (out.length === start) { const t = inner(el).trim(); if (t) out.push(t); }
      for (let i = start; i < out.length; i++) if (out[i]) out[i] = '> ' + out[i];
      out.push(''); return;
    }
    if (tag === 'p' || tag === 'figcaption' || tag === 'td' || tag === 'th' || tag === 'dd' || tag === 'dt') { const t = inner(el).replace(/\n{2,}/g, '\n').trim(); if (t) out.push(t, ''); return; }
    if (tag === 'hr') { out.push('---', ''); return; }
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg' || tag === 'img' || tag === 'iframe' || tag === 'form' || tag === 'button' || tag === 'nav' || tag === 'aside') return;
    // 容器：递归；只有行内内容时当成一段
    const children = Array.from(el.childNodes) as Node[];
    const isBlock = (c: Node) => c.nodeType === 1 && (/^(p|div|section|article|ul|ol|pre|h[1-6]|blockquote|table|figure|figcaption|hr|main|header|footer|li)$/i.test((c as Element).tagName) || !!opts.image && /^img$/i.test((c as Element).tagName));
    if (children.some(isBlock)) {
      let run: Node[] = [];
      const flush = () => { const t = run.map(text).join('').trim(); if (t) out.push(t, ''); run = []; };
      for (const c of children) {
        if (isBlock(c)) { flush(); block(c as Element, depth); }
        else run.push(c);
      }
      flush();
    } else { const t = inner(el).trim(); if (t) out.push(t, ''); }
  };
  for (const c of Array.from(document.body!.childNodes) as Node[]) {
    if (c.nodeType === 1) block(c as Element); else { const t = text(c).trim(); if (t) out.push(t, ''); }
  }
  void baseUrl;
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** 抽正文：先去掉不是正文的块，再交给 Readability；标题和导语单独取（它有时会把文章头整个丢掉） */
export async function extractReadable(html: string, url: string, parse: HtmlParser): Promise<ReadableArticle> {
  const document = parse(html);
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
  let markdown = htmlToMarkdown(contentHtml, url, parse);
  if (leadHtml) {
    const lead = htmlToMarkdown(leadHtml, url, parse).trim();
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
}
