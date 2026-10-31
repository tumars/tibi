import type { BlockType, Kind } from '../../types.js';

/**
 * 切分（00 §3.1 第 2 步"结构化"）：Markdown → 章节 → 段落（块）→ 句子。
 * 规则，不调模型（能力 segment_document）。代码块保留围栏、不拆句（01 §2 sentences 表不收代码）。
 */

export type ParagraphBlockType = BlockType | 'code';
export interface Paragraph { idx: number; text: string; block_type: ParagraphBlockType; lang?: string }
export interface SegSection { idx: number; title: string; paragraphs: Paragraph[] }
export interface Segmented { kind: Kind; lang: string; word_count: number; sections: SegSection[] }

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^(```|~~~)\s*([\w+#.-]*)\s*$/;
const LIST = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

/** Markdown → 块（段落 / 标题 / 列表项 / 引用 / 代码块） */
export function splitBlocks(md: string): Paragraph[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: Paragraph[] = [];
  const push = (text: string, block_type: ParagraphBlockType, lang?: string) => {
    const t = block_type === 'code' ? text.replace(/\n+$/, '') : cleanInline(text);
    if (!t.trim()) return;
    out.push({ idx: out.length, text: t, block_type, ...(lang ? { lang } : {}) });
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = line.match(FENCE);
    if (fence) {
      const mark = fence[1]!; const lang = fence[2] || undefined; const buf: string[] = []; i++;
      while (i < lines.length && !lines[i]!.startsWith(mark)) buf.push(lines[i++]!);
      i++; // 收尾围栏
      push(buf.join('\n'), 'code', lang); continue;
    }
    if (/^ {4}\S/.test(line) && (out.length === 0 || out[out.length - 1]!.block_type !== 'list_item')) {
      const buf: string[] = [];
      while (i < lines.length && (/^ {4}/.test(lines[i]!) || lines[i]!.trim() === '')) buf.push(lines[i++]!.replace(/^ {4}/, ''));
      push(buf.join('\n'), 'code'); continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = line.match(HEADING);
    if (h) { push(h[2]!, 'heading'); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { i++; continue; }
    const li = line.match(LIST);
    if (li) {
      const buf = [li[1]!]; i++;
      while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !LIST.test(lines[i]!)) buf.push(lines[i++]!.trim());
      push(buf.join(' '), 'list_item'); continue;
    }
    const q = line.match(QUOTE);
    if (q) {
      const buf = [q[1]!]; i++;
      while (i < lines.length && QUOTE.test(lines[i]!)) buf.push(lines[i++]!.match(QUOTE)![1]!);
      push(buf.join(' '), 'quote'); continue;
    }
    // 普通段落：连续非空行
    const buf = [line]; i++;
    while (i < lines.length && lines[i]!.trim() && !HEADING.test(lines[i]!) && !FENCE.test(lines[i]!) && !LIST.test(lines[i]!) && !QUOTE.test(lines[i]!)) buf.push(lines[i++]!);
    push(buf.join(' '), 'prose');
  }
  return out;
}

/** 去掉行内 Markdown 标记但保留文字；行内代码保留反引号（分词时据此跳过） */
export function cleanInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')            // 图片
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')          // 链接 → 文字
    .replace(/(\*\*|__)(.+?)\1/g, '$2')              // 粗体
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1$2')      // 斜体
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'etc', 'e.g', 'i.e', 'cf', 'no', 'fig', 'vol', 'inc', 'ltd', 'co', 'u.s', 'u.k', 'u.n', 'a.m', 'p.m', 'approx', 'dept', 'est', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec']);

/**
 * 分句：按 . ! ? 后接空白与大写 / 引号 / 数字切；不在缩写（Mr. e.g. U.S.）、小数（3.14）、单字母缩写（J. K. Rowling）后切；
 * 句末的闭引号和括号归前一句。
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i]!;
    if (c !== '.' && c !== '!' && c !== '?') continue;
    // 连续的 ?! …
    let j = i + 1;
    while (j < n && (text[j] === '.' || text[j] === '!' || text[j] === '?')) j++;
    // 闭引号 / 括号归前一句
    while (j < n && /["'”’)\]]/.test(text[j]!)) j++;
    if (j >= n) break;
    if (!/\s/.test(text[j]!)) continue;                      // 后面不是空白：3.14、e.g.、网址
    // 下一个非空白字符
    let k = j; while (k < n && /\s/.test(text[k]!)) k++;
    if (k >= n) break;
    const next = text[k]!;
    if (/[a-z]/.test(next)) continue;                           // 小写开头：多半不是句末（"Really?" she asked）
    if (c === '.') {
      const word = text.slice(start, i).match(/([A-Za-z][\w.]*)$/)?.[1]?.toLowerCase() ?? '';
      if (ABBR.has(word) || ABBR.has(word.replace(/\.$/, ''))) continue;     // Mr. / e.g. / U.S.
      if (/^[A-Z]$/.test(text.slice(start, i).match(/(\S+)$/)?.[1] ?? '') && /^[A-Z]/.test(next)) continue;  // J. K.
    }
    out.push(text.slice(start, j).trim());
    start = k;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/**
 * 整篇切分。article：只有一个章节；book：按一级标题分章（没有一级标题就按二级），没有标题的开头归第 0 章。
 */
export function segmentMarkdown(md: string, opts: { kind?: Kind; title?: string } = {}): Segmented {
  const blocks = splitBlocks(md);
  const kind: Kind = opts.kind ?? 'article';
  const sections: SegSection[] = [];
  const lang = detectLang(blocks.filter(b => b.block_type !== 'code').map(b => b.text).join(' ').slice(0, 2000));
  if (kind === 'book') {
    const headLines = md.replace(/\r\n?/g, '\n').split('\n').map(l => l.match(HEADING)).filter(Boolean) as RegExpMatchArray[];
    const level = headLines.some(h => h[1]!.length === 1) ? 1 : 2;
    let cur: SegSection | undefined;
    for (const b of blocks) {
      const isChapter = b.block_type === 'heading' && headingLevelOf(md, b.text) === level;
      if (isChapter || !cur) {
        cur = { idx: sections.length, title: isChapter ? b.text : (opts.title ?? ''), paragraphs: [] };
        sections.push(cur);
        if (isChapter) continue;
      }
      cur.paragraphs.push({ ...b, idx: cur.paragraphs.length });
    }
  } else {
    // 文章：第一个标题若与标题相同则去掉，避免正文重复标题
    const ps = blocks.filter((b, i) => !(i === 0 && b.block_type === 'heading' && opts.title && b.text.trim().toLowerCase() === opts.title.trim().toLowerCase()));
    sections.push({ idx: 0, title: opts.title ?? '', paragraphs: ps.map((b, i) => ({ ...b, idx: i })) });
  }
  const word_count = sections.reduce((s, sec) => s + sec.paragraphs.filter(p => p.block_type !== 'code').reduce((a, p) => a + countWords(p.text), 0), 0);
  return { kind, lang, word_count, sections };
}

function headingLevelOf(md: string, text: string): number {
  const m = md.split('\n').find(l => { const h = l.match(HEADING); return h && h[2]!.trim() === text; })?.match(HEADING);
  return m ? m[1]!.length : 9;
}

export function countWords(text: string): number {
  return (text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).length;
}

/** 粗略语种判断：只分英文 / 中文 / 其他，M0 只支持英文 */
export function detectLang(sample: string): string {
  const cjk = (sample.match(/[一-鿿]/g) ?? []).length;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length;
  if (cjk > latin) return 'zh';
  return 'en';
}
