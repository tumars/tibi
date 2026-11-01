import { Fragment, type ReactNode } from 'react';

/**
 * Tibi 回答用的极简 Markdown：段落、列表、### 标题、引用、代码块，行内 **粗体**、*斜体*、`代码`、[链接](https://…)。
 * 只生成 React 元素，不用 innerHTML（模型输出当不可信文本）。
 */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []; let i = 0; let n = 0;
  const re = /(\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  for (const m of text.matchAll(re)) {
    if (m.index! > i) out.push(text.slice(i, m.index));
    const k = `${key}-${n++}`;
    if (m[2]) out.push(<b key={k}>{m[2]}</b>);
    else if (m[3]) out.push(<i key={k}>{m[3]}</i>);
    else if (m[4]) out.push(<code key={k}>{m[4]}</code>);
    else if (m[5]) out.push(<a key={k} href={m[6]} target="_blank" rel="noopener noreferrer">{m[5]}</a>);
    i = m.index! + m[0].length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = []; let i = 0; let k = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('```')) {
      const buf: string[] = []; i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) buf.push(lines[i++]!);
      i++; blocks.push(<pre key={k++}>{buf.join('\n')}</pre>); continue;
    }
    const h = l.match(/^#{1,4}\s+(.*)$/);
    if (h) { blocks.push(<h4 key={k++}>{inline(h[1]!, `h${k}`)}</h4>); i++; continue; }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l); const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={k++}>{items.map((t, j) => <li key={j}>{inline(t, `l${k}-${j}`)}</li>)}</Tag>); continue;
    }
    if (l.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) buf.push(lines[i++]!.replace(/^>\s?/, ''));
      blocks.push(<blockquote key={k++}>{inline(buf.join(' '), `q${k}`)}</blockquote>); continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(```|#{1,4}\s|>|\s*([-*•]|\d+[.)])\s+)/.test(lines[i]!)) buf.push(lines[i++]!);
    blocks.push(<p key={k++}>{buf.map((b, j) => <Fragment key={j}>{j > 0 && <br />}{inline(b, `p${k}-${j}`)}</Fragment>)}</p>);
  }
  return <>{blocks}</>;
}
