/**
 * 分词：只找英文单词（含 ' 与 -），数字、纯符号、行内代码（`…`）、网址不算词（00 §3.1 类型策略：代码与 URL 不参与着色）。
 * 偏移 s/e 是句子里的字符位置，渲染时据此着色。
 */
export interface RawToken { t: string; s: number; e: number }

const EXCLUDE = /`[^`]*`|https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/g;
const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+(?:['’][A-Za-z]+)*)*/g;

export function tokenize(sentence: string): RawToken[] {
  const excluded: [number, number][] = [];
  for (const m of sentence.matchAll(EXCLUDE)) excluded.push([m.index!, m.index! + m[0].length]);
  const out: RawToken[] = [];
  for (const m of sentence.matchAll(WORD)) {
    const s = m.index!, e = s + m[0].length;
    if (excluded.some(([a, b]) => s >= a && e <= b)) continue;
    let t = m[0];
    // 去掉所有格 's / ’s（Rust's → Rust），但保留 it's、don't 这类缩略（由 lemmatize 处理）
    if (/^[A-Za-z]+['’]s$/.test(t) && t.length > 3 && !/^(it|he|she|that|what|there|here|who|let)['’]s$/i.test(t)) t = t.slice(0, -2);
    if (t.length < 2 && !/^[aI]$/.test(t)) continue;
    out.push({ t, s, e: s + t.length });
  }
  return out;
}

/**
 * 是否当专有名词处理：首字母大写、不在句首、不是全大写缩写（API、HTTP 归为缩写另算）。
 * 专有名词不标生词（category = proper_noun）。
 */
export function looksProperNoun(t: string, atSentenceStart: boolean): boolean {
  if (atSentenceStart) return false;
  return /^[A-Z][a-z]/.test(t) || /^[A-Z][a-z]+(-[A-Z][a-z]+)+$/.test(t);
}

/** 全大写缩写（API、HTTP、NASA）：当作术语，不标生词 */
export function isAcronym(t: string): boolean {
  return /^[A-Z]{2,}s?$/.test(t);
}

/** 词的规范形式（lemma 之前先做的大小写处理）：句首大写转小写；全大写缩写保留；其余保留原样再小写 */
export function normalizeCase(t: string, atSentenceStart: boolean): string {
  if (isAcronym(t)) return t;
  if (atSentenceStart || /^[A-Z][a-z]/.test(t)) return t.toLowerCase();
  return t.toLowerCase();
}
