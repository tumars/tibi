import type { Dict } from '../../dict/types.js';
import type { Status } from '../../types.js';
import { lemmatize } from './lemma.js';
import { prelabel, PRELABEL_STATUS, type Prelabel } from './prelabel.js';
import { isAcronym, looksProperNoun, normalizeCase, tokenize } from './tokenize.js';

/**
 * 标注（能力 annotate_terms 的纯计算部分）：分词、还原、按已知词库与预标注规则定每个词的状态。
 * 不碰数据库：已知词库由调用方以 statusOf 传入；返回里说明哪些词要建行。
 */
export interface AnnotatedToken { t: string; l: string; s: number; e: number; status?: Status; prelabel?: Prelabel; proper?: boolean }
export interface AnnotatedSentence { text: string; tokens: AnnotatedToken[] }
export interface AnnotateInput {
  sentences: string[];
  dict: Dict;
  vocab_estimate: number;
  /** 已知词库：lemma → status（只含有行的词） */
  statusOf: (lemma: string) => Status | undefined;
  /** 已有的短语（小写）：用于识别 */
  phrases?: string[];
  /** 是否忽略专有名词（技术 / 新闻类型默认忽略，00 §3.1） */
  ignoreProperNouns?: boolean;
}
export interface AnnotateResult {
  sentences: AnnotatedSentence[];
  /** 需要建行的新词：lemma → 预标注状态（0 或 99），以及首次出现的显示形式 */
  newTerms: Map<string, { status: 0 | 99; display: string; prelabel: Prelabel }>;
  phrases: { text: string; sentence_idx: number[] }[];
  counts: { total: number; new: number; learning: number; unsure: number; known: number };
  unknown_ratio: number;
  /** 预标注判断过的不重复词数（H1 的分母，01 §6） */
  prelabel_total: number;
}

export async function annotateSentences(input: AnnotateInput): Promise<AnnotateResult> {
  const { dict, vocab_estimate } = input;
  const raw = input.sentences.map(s => tokenize(s));
  // 词形：批量还原
  const forms = new Set<string>();
  const normalized = raw.map(toks => toks.map((tk, i) => normalizeCase(tk.t, i === 0)));
  for (const ns of normalized) for (const f of ns) forms.add(f);
  const lemmaOf = new Map<string, string>();
  await Promise.all([...forms].map(async f => lemmaOf.set(f, await lemmatize(f, dict))));
  // 词频：批量
  const lemmas = [...new Set([...lemmaOf.values()])];
  const ranks = dict.frequencyRanks ? await dict.frequencyRanks(lemmas) : new Map<string, number>();
  if (!dict.frequencyRanks) await Promise.all(lemmas.map(async l => { const r = await dict.frequencyRank(l); if (r) ranks.set(l, r); }));

  const newTerms: AnnotateResult['newTerms'] = new Map();
  const counts = { total: 0, new: 0, learning: 0, unsure: 0, known: 0 };
  const prelabeled = new Set<string>();
  const sentences: AnnotatedSentence[] = raw.map((toks, si) => ({
    text: input.sentences[si]!,
    tokens: toks.map((tk, i) => {
      const form = normalized[si]![i]!;
      const l = lemmaOf.get(form) ?? form;
      const out: AnnotatedToken = { t: tk.t, l, s: tk.s, e: tk.e };
      if (isAcronym(tk.t)) return out;                                   // 缩写：不参与
      if (looksProperNoun(tk.t, i === 0)) { out.proper = true; return out; }   // 专有名词：不标生词
      if (/^[A-Z]/.test(l) || l.length < 2) return out;
      if (/['’]/.test(l)) return out;                                    // 缩略（don't、I’m、o’clock）：词频表里没有，不是生词
      counts.total++;
      const existing = input.statusOf(l);
      if (existing !== undefined) {
        out.status = existing;
        if (existing === 0) counts.new++; else if (existing >= 1 && existing <= 4) counts.learning++; else if (existing === 99) counts.unsure++; else counts.known++;
        return out;
      }
      // 没有词典就判断不了生熟：不着色，别把整篇都标成生词
      const pl = dict.hasFrequency === false ? 'known' : prelabel(ranks.get(l), vocab_estimate);
      prelabeled.add(l);
      out.prelabel = pl;
      const st = PRELABEL_STATUS[pl];
      if (st === undefined) { counts.known++; return out; }
      out.status = st;
      if (st === 0) counts.new++; else counts.unsure++;
      if (!newTerms.has(l)) newTerms.set(l, { status: st, display: l, prelabel: pl });
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
  const unknown_ratio = counts.total ? counts.new / counts.total : 0;
  return { sentences, newTerms, phrases, counts, unknown_ratio, prelabel_total: prelabeled.size };
}
