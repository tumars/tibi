import { Type } from '@sinclair/typebox';
import { method, type MethodMap } from '../../rpc/define.js';
import type { DictBrief, DictEntry, DictExtras, Id, Term } from '../../types.js';
import { getTermByText } from '../terms/repo.js';
import { toTerm } from '../terms/views.js';
import { lemmatize } from '../text/lemma.js';
import { normalizeCase } from '../text/tokenize.js';

/**
 * 词典页（00 §3.14）：主动查词。都只读，不改熟练度、不建卡（R5 只管读文章时点词）；加入生词本走 terms.add。
 * 数据只来自本地 dict.db，不联网（T29）。
 */
export interface DictSuggestResult {
  /** 这台设备上有没有词典 */
  available: boolean;
  /** prefix 前缀联想；zh 中文反查；similar 查不到时拼写相近的词 */
  mode: 'prefix' | 'zh' | 'similar';
  items: DictBrief[];
}
export interface DictEntryResult {
  available: boolean;
  /** 词典里的词头；查不到时为空 */
  entry?: DictEntry;
  /** 进生词本的那个词（原形），term 也按它查 */
  lemma: string;
  /** 输入的是变形、词典里只有原形时，输入的那个词（translations → translation） */
  via?: string;
  term?: Term;
  in_wordbook: boolean;
  /** 你读过的文章里出现这个词的地方，snippet 里命中处用 ⟦ ⟧ 标出 */
  readings: { document_id: Id; title: string; snippet: string }[];
  /** 查不到时拼写相近的词 */
  similar: DictBrief[];
  /** 词光和 WordNet 的内容（T32） */
  extras?: DictExtras;
}

const CJK = /[\u3400-\u9fff]/;
const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
const toBrief = (e: DictEntry): DictBrief => ({ word: e.word, phonetic: e.phonetic, gloss: (e.translation || e.definition || '').trim().split('\n').slice(0, 2).join('；') });

/** ECDICT 的词性分布 `n:46/v:54` 里占比大的在前，WordNet 自己只在同词性内排序 */
function sortSenses(x: DictExtras, pos?: string): DictExtras {
  const share = new Map((pos ?? '').split('/').map(p => { const [k, v] = p.split(':'); return [k === 'j' ? 'a' : k!, Number(v) || 0] as const; }));
  const order = (p: string) => -(share.get(p) ?? 0);
  // 稳定排序：同词性保持 WordNet 的顺序
  return { ...x, senses: [...x.senses].sort((a, b) => order(a.pos) - order(b.pos)).slice(0, 6) };
}

async function lemmaOf(text: string, dict: import('../../dict/types.js').Dict): Promise<string> {
  return /\s/.test(text) ? text.toLowerCase() : lemmatize(normalizeCase(text, true), dict);
}

/** 正文全文搜这个词和它的词形，每篇文章一条 */
async function findReadings(db: import('../../db/driver.js').Database, forms: string[], limit: number): Promise<DictEntryResult['readings']> {
  const safe = [...new Set(forms.map(f => f.replace(/["*()^:]/g, ' ').trim()).filter(f => /[A-Za-z]/.test(f)))];
  if (!safe.length) return [];
  try {
    const hits = await db.all<{ id: string; title: string; snippet: string }>(
      `SELECT d.id, d.title, snippet(sections_fts, 1, '⟦', '⟧', '…', 18) AS snippet
       FROM sections_fts JOIN sections sec ON sec.rowid = sections_fts.rowid JOIN documents d ON d.id = sec.document_id
       WHERE sections_fts MATCH ? AND d.deleted_at IS NULL AND sec.deleted_at IS NULL ORDER BY bm25(sections_fts) LIMIT ?`,
      [`content_md : (${safe.map(f => `"${f}"`).join(' OR ')})`, limit * 4]);
    const out: DictEntryResult['readings'] = [];
    for (const h of hits) if (!out.some(r => r.document_id === h.id) && out.length < limit) out.push({ document_id: h.id, title: h.title, snippet: h.snippet.replace(/\s+/g, ' ').trim() });
    return out;
  } catch { return []; }   // FTS 语法不合法时不给例子，不影响查词
}

export const dictionaryMethods: MethodMap = {
  'dict.suggest': method(Type.Object({ q: Type.String(), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })) }), async (p, ctx): Promise<DictSuggestResult> => {
    const q = clean(p.q); const n = p.limit ?? 20; const d = ctx.dict;
    const available = !!d.prefix;
    if (!q || !available) return { available, mode: 'prefix', items: [] };
    if (CJK.test(q)) return { available, mode: 'zh', items: await d.reverse?.(q, n) ?? [] };
    // 输入正好是词头时排第一（mat 不能被更常用的 matter 挤下去）；输入是变形时原形紧跟（went → go，cities → city）
    const lemma = /\s/.test(q) ? q : await lemmaOf(q, d);
    const heads = (await Promise.all([q, lemma].map(w => d.lookup(w)))).filter((e): e is DictEntry => !!e).map(toBrief);
    const seen = new Set<string>();
    const items = [...heads, ...await d.prefix!(q, n)].filter(i => { const k = i.word.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, n);
    if (items.length) return { available, mode: 'prefix', items };
    return { available, mode: 'similar', items: await d.similar?.(q, 6) ?? [] };
  }, '联想'),

  'dict.entry': method(Type.Object({ word: Type.String({ minLength: 1, maxLength: 80 }) }), async (p, ctx): Promise<DictEntryResult> => {
    const q = clean(p.word); const d = ctx.dict; const isPhrase = /\s/.test(q);
    const lemma = await lemmaOf(q, d);
    // 词头优先（left、went 都有自己的页）；没有词头再看原形
    const exact = await d.lookup(q);
    const found = exact ?? (lemma !== q.toLowerCase() ? await d.lookup(lemma) : undefined);
    // 只在它确实按原形算时才说"是变形"（number 在词典里也是 numb 的比较级，没有必要提）
    const entry = found?.base && found.base.toLowerCase() !== lemma ? { ...found, base: undefined } : found;
    const row = await getTermByText(ctx.db, lemma, isPhrase ? 'phrase' : 'word');
    const base = lemma === entry?.word.toLowerCase() ? entry : await d.lookup(lemma);
    // 词头自己有就用自己的（left 有"左"），went 这种只是变形页的才看原形
    const extras = await (entry ? d.extras?.(entry.word) : undefined) ?? await (lemma !== entry?.word.toLowerCase() ? d.extras?.(lemma) : undefined);
    const forms = [q, lemma, ...(base?.inflections ?? []).map(i => i.form), ...(base?.forms ?? []).filter(f => /^[A-Za-z'-]+$/.test(f) && f.length > 2)];
    return {
      available: !!d.prefix, entry, lemma, via: !exact && entry ? q : undefined,
      term: row && !row.deleted_at ? await toTerm(ctx.db, d, row) : undefined,
      in_wordbook: !!row && !row.deleted_at && !!row.in_wordbook,
      readings: await findReadings(ctx.db, forms, 5),
      similar: entry || row ? [] : await d.similar?.(q, 6) ?? [],
      extras: extras && sortSenses(extras, base?.pos),
    };
  }, '词条'),
};
