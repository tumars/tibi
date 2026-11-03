import type { Dict } from '../../dict/types.js';
import type { Status } from '../../types.js';
import { lemmatize } from './lemma.js';
import { isRare, levelOfRatio } from './level.js';
import { isAcronym, looksProperNoun, normalizeCase, tokenize } from './tokenize.js';

/**
 * 标注（能力 annotate_terms 的纯计算部分）：分词、还原、按词库定每个词的状态。
 * 词只有在词库里有行（用户标过、查过）时才带状态；没有行的词不着色，也不会因为标注而建行。
 * 另外按词频算一个与用户无关的文本级别（level.ts）。不碰数据库：词库由调用方以 statusOf 传入。
 */
export interface AnnotatedToken { t: string; l: string; s: number; e: number; status?: Status; proper?: boolean }
export interface AnnotatedSentence { text: string; tokens: AnnotatedToken[] }
export interface AnnotateInput {
  sentences: string[];
  dict: Dict;
  /** 词库：lemma → status（只含有行的词） */
  statusOf: (lemma: string) => Status | undefined;
  /** 已有的短语（小写）：用于识别 */
  phrases?: string[];
  /** 是否忽略专有名词（技术 / 新闻类型默认忽略，00 §3.1） */
  ignoreProperNouns?: boolean;
}
export interface AnnotateResult {
  sentences: AnnotatedSentence[];
  phrases: { text: string; sentence_idx: number[] }[];
  /** total：参与统计的词次；new / learning：用户标过的生词与学习中的词次 */
  counts: { total: number; new: number; learning: number };
  /** 常用 3000 词以外的词次占比；没有词频表时为 undefined */
  rare_ratio?: number;
  /** 按 rare_ratio 估的文本级别 A2–C2 */
  level?: string;
}

/** 词库里的状态只认 0–5 / 97 / 98；旧数据里的 99（待确认）当作没有行 */
function userStatus(s: Status | number | undefined): Status | undefined {
  if (s === undefined) return undefined;
  return (s >= 0 && s <= 5) || s === 97 || s === 98 ? (s as Status) : undefined;
}

export async function annotateSentences(input: AnnotateInput): Promise<AnnotateResult> {
  const { dict } = input;
  const raw = input.sentences.map(s => tokenize(s));
  // 词形：批量还原
  const forms = new Set<string>();
  const normalized = raw.map(toks => toks.map((tk, i) => normalizeCase(tk.t, i === 0)));
  for (const ns of normalized) for (const f of ns) forms.add(f);
  const lemmaOf = new Map<string, string>();
  await Promise.all([...forms].map(async f => lemmaOf.set(f, await lemmatize(f, dict))));
  // 词频：批量（只用来估文本级别）
  const hasFreq = dict.hasFrequency !== false;
  const lemmas = [...new Set([...lemmaOf.values()])];
  const ranks = !hasFreq ? new Map<string, number>() : dict.frequencyRanks ? await dict.frequencyRanks(lemmas) : new Map<string, number>();
  if (hasFreq && !dict.frequencyRanks) await Promise.all(lemmas.map(async l => { const r = await dict.frequencyRank(l); if (r) ranks.set(l, r); }));

  const counts = { total: 0, new: 0, learning: 0 };
  let rare = 0;
  const sentences: AnnotatedSentence[] = raw.map((toks, si) => ({
    text: input.sentences[si]!,
    tokens: toks.map((tk, i) => {
      const form = normalized[si]![i]!;
      const l = lemmaOf.get(form) ?? form;
      const out: AnnotatedToken = { t: tk.t, l, s: tk.s, e: tk.e };
      if (isAcronym(tk.t)) return out;                                   // 缩写：不参与
      if (looksProperNoun(tk.t, i === 0)) { out.proper = true; return out; }   // 专有名词：不标生词
      if (/^[A-Z]/.test(l) || l.length < 2) return out;
      if (/['’]/.test(l)) return out;                                    // 缩略（don't、I’m、o’clock）：词频表里没有
      counts.total++;
      if (hasFreq && isRare(ranks.get(l))) rare++;
      const st = userStatus(input.statusOf(l));
      if (st === undefined) return out;
      out.status = st;
      if (st === 0) counts.new++; else if (st >= 1 && st <= 4) counts.learning++;
      return out;
    }),
  }));
  // 短语识别：子串匹配（小写）
  const phrases: AnnotateResult['phrases'] = [];
  for (const p of input.phrases ?? []) {
    const needle = p.toLowerCase();
    const idx = input.sentences.map((s, i) => (s.toLowerCase().includes(needle) ? i : -1)).filter(i => i >= 0);
    if (idx.length) phrases.push({ text: p, sentence_idx: idx });
  }
  if (!hasFreq || !counts.total) return { sentences, phrases, counts };
  const rare_ratio = rare / counts.total;
  return { sentences, phrases, counts, rare_ratio, level: levelOfRatio(rare_ratio) };
}
