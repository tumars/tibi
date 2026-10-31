import { parseHTML } from 'linkedom';

/**
 * 很小的 HTML → Markdown：只保留 Tibi 需要的结构（标题、段落、列表、引用、代码块、行内代码、链接文字、强调），
 * 其余标签只取文字。代码块保留围栏并带语言（sections.content_md 的约定，01 §2）。
 */
export function htmlToMarkdown(html: string, baseUrl?: string): string {
  const { document } = parseHTML(`<body>${html}</body>`);
  const out: string[] = [];

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
    const hasBlock = children.some(c => c.nodeType === 1 && /^(p|div|section|article|ul|ol|pre|h[1-6]|blockquote|table|figure|hr|main|header|footer|li)$/i.test((c as Element).tagName));
    if (hasBlock) {
      let run: Node[] = [];
      const flush = () => { const t = run.map(text).join('').trim(); if (t) out.push(t, ''); run = []; };
      for (const c of children) {
        if (c.nodeType === 1 && /^(p|div|section|article|ul|ol|pre|h[1-6]|blockquote|table|figure|hr|main|header|footer|li)$/i.test((c as Element).tagName)) { flush(); block(c as Element, depth); }
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
