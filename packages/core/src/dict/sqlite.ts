import type { Database } from '../db/driver.js';
import type { DictBrief, DictEntry, DictExtras } from '../types.js';
import { damerauLevenshtein } from '../domain/text/distance.js';
import type { Dict } from './types.js';

/**
 * dict.db（ECDICT）上的词典实现（01 §8）。表：stardict（ECDICT 原表）、lemma_map(form, lemma, rank)（入库脚本预生成）。
 */
interface StardictRow extends Record<string, string | number | null> { word: string; phonetic: string | null; definition: string | null; translation: string | null; pos: string | null; collins: number | null; oxford: number | null; tag: string | null; bnc: number | null; frq: number | null; exchange: string | null }

export class SqliteDict implements Dict {
  constructor(private readonly db: Database) {}

  async lookup(word: string): Promise<DictEntry | undefined> {
    const w = word.toLowerCase().trim();
    const r = await this.db.get<StardictRow>('SELECT word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange FROM stardict WHERE word = ? COLLATE NOCASE ORDER BY word = ? DESC LIMIT 1', [w, w]);
    if (!r) return undefined;
    return {
      word: r.word, phonetic: r.phonetic ?? undefined, translation: (r.translation ?? '').replace(/\\n/g, '\n'), definition: r.definition?.replace(/\\n/g, '\n') ?? undefined, pos: r.pos ?? undefined,
      collins: r.collins ?? undefined, oxford: !!r.oxford, exam: (r.tag ?? '').split(/\s+/).filter(Boolean),
      frequency: r.frq || r.bnc || undefined, forms: parseExchange(r.exchange), ...parseInflections(r.exchange, r.word),
    };
  }

  async lemmas(form: string): Promise<string[]> {
    const rows = await this.db.all<{ lemma: string }>('SELECT lemma FROM lemma_map WHERE form = ? ORDER BY rank', [form.toLowerCase()]);
    return rows.map(r => r.lemma);
  }

  async frequencyRank(lemma: string): Promise<number | undefined> {
    const r = await this.db.get<{ frq: number | null; bnc: number | null }>('SELECT frq, bnc FROM stardict WHERE word = ? COLLATE NOCASE LIMIT 1', [lemma.toLowerCase()]);
    if (!r) return undefined;
    return r.frq || r.bnc || undefined;
  }

  async frequencyRanks(lemmas: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const lower = [...new Set(lemmas.map(l => l.toLowerCase()))];
    const found = new Map<string, number>();
    for (let i = 0; i < lower.length; i += 400) {
      const chunk = lower.slice(i, i + 400);
      const rows = await this.db.all<{ word: string; frq: number | null; bnc: number | null }>(`SELECT word, frq, bnc FROM stardict WHERE word COLLATE NOCASE IN (${chunk.map(() => '?').join(',')})`, chunk);
      for (const r of rows) { const v = r.frq || r.bnc; if (v) found.set(r.word.toLowerCase(), v); }
    }
    for (const w of lower) {
      const v = found.get(w);
      if (v !== undefined) out.set(w, v);
    }
    return out;
  }

  async prefix(prefix: string, limit: number): Promise<DictBrief[]> {
    const p = prefix.trim().replace(/\s+/g, ' ');
    if (!p) return [];
    // NOCASE 索引上的范围查询；人名地名（大写开头或标了 [人名] [地名]）放最后，其余常用的在前（有词频的按词频，其余按长短）
    const rows = await this.db.all<BriefRow>(
      `SELECT word, phonetic, translation, definition FROM stardict
       WHERE word >= ? COLLATE NOCASE AND word < ? COLLATE NOCASE AND (translation IS NOT NULL OR definition IS NOT NULL)
       ORDER BY (word GLOB '[A-Z]*' OR translation LIKE '%[人名]%' OR translation LIKE '%[地名]%'),
         COALESCE(NULLIF(frq, 0), NULLIF(bnc, 0)) IS NULL, COALESCE(NULLIF(frq, 0), NULLIF(bnc, 0)), length(word), word LIMIT ?`, [p, `${p}\uffff`, limit]);
    return rows.map(toBrief);
  }

  async reverse(zh: string, limit: number): Promise<DictBrief[]> {
    const q = zh.trim(); if (!q) return [];
    const pat = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
    const cols = 'word, phonetic, translation, definition';
    // 先在有词频的词里找（部分索引，按词频走）；不够再扫全表，冷门词和术语也能反查到
    const rows = await this.db.all<BriefRow>(`SELECT ${cols} FROM stardict WHERE frq > 0 AND translation LIKE ? ESCAPE '\\' ORDER BY frq LIMIT 300`, [pat]);
    if (rows.length < limit) {
      const seen = new Set(rows.map(r => r.word));
      const more = await this.db.all<BriefRow>(`SELECT ${cols} FROM stardict WHERE translation LIKE ? ESCAPE '\\' LIMIT ?`, [pat, limit * 4]);
      rows.push(...more.filter(r => !seen.has(r.word)));
    }
    // 稳定排序：同一档里保持词频顺序
    return rows.map(r => ({ r, s: zhMatchScore(r.translation ?? '', q) })).sort((a, b) => a.s - b.s).slice(0, limit).map(x => toBrief(x.r));
  }

  async similar(word: string, limit: number): Promise<DictBrief[]> {
    const w = word.trim().toLowerCase();
    if (w.length < 3 || !/^[a-z][a-z'-]*$/.test(w)) return [];
    const max = w.length <= 4 ? 1 : 2;
    const rows = await this.db.all<BriefRow>(
      'SELECT word, phonetic, translation, definition FROM stardict WHERE frq > 0 AND word LIKE ? AND length(word) BETWEEN ? AND ? ORDER BY frq LIMIT 8000', [`${w[0]}%`, w.length - max, w.length + max]);
    return rows.map(r => ({ r, d: damerauLevenshtein(w, r.word.toLowerCase(), max) })).filter(x => x.d <= max).sort((a, b) => a.d - b.d).slice(0, limit).map(x => toBrief(x.r));
  }

  async extras(word: string): Promise<DictExtras | undefined> {
    const w = word.trim();
    try {
      const a = await this.db.get<AtlasRow>('SELECT word, cefr, tip, examples, collocations, family, synonyms, antonyms FROM word_atlas WHERE word = ? COLLATE NOCASE', [w]);
      const all = await this.db.all<SenseRow>(
        `SELECT s.word, s.pos, s.rank, s.antonyms, y.definition, y.examples, y.members FROM wn_sense s JOIN wn_synset y ON y.id = s.synset
         WHERE s.word = ? COLLATE NOCASE ORDER BY s.rank`, [w]);
      // 大小写不同可能是另一个词（china 瓷器 / China 中国）：有写法完全一样的就只要它；
      // 没有时，小写的查询可以退到大写词头（monday → Monday），反过来不行
      const same = all.filter(r => r.word === w);
      const rows = same.length || w !== w.toLowerCase() ? same : all;
      if (!a && !rows.length) return undefined;
      const senses = rows
        .map(r => ({ pos: r.pos, definition: r.definition, synonyms: (JSON.parse(r.members) as string[]).filter(m => m.toLowerCase() !== w.toLowerCase()), examples: JSON.parse(r.examples) as string[] }))
        .filter(s => s.synonyms.length || s.examples.length);
      const antonyms = [...new Set(rows.flatMap(r => (r.antonyms ? JSON.parse(r.antonyms) as string[] : [])))];
      if (!a && !senses.length && !antonyms.length) return undefined;
      return {
        word: a?.word ?? rows[0]!.word,
        atlas: a ? { cefr: a.cefr ?? undefined, tip: a.tip ?? undefined, examples: JSON.parse(a.examples), collocations: JSON.parse(a.collocations), family: JSON.parse(a.family), synonyms: JSON.parse(a.synonyms), antonyms: JSON.parse(a.antonyms) } : undefined,
        senses,
        antonyms,
      };
    } catch { return undefined; }   // 旧版 dict.db 没有这些表
  }
}

interface AtlasRow extends Record<string, string | number | null> { word: string; cefr: string | null; tip: string | null; examples: string; collocations: string; family: string; synonyms: string; antonyms: string }
interface SenseRow extends Record<string, string | number | null> { word: string; pos: string; rank: number; antonyms: string | null; definition: string; examples: string; members: string }
interface BriefRow extends Record<string, string | number | null> { word: string; phonetic: string | null; translation: string | null; definition: string | null }
export const toBrief = (r: { word: string; phonetic?: string | null; translation?: string | null; definition?: string | null }): DictBrief => ({
  word: r.word, phonetic: r.phonetic ?? undefined, gloss: (r.translation || r.definition || '').trim().split('\n').slice(0, 2).join('；'),
});

/** 中文反查的匹配度，越小越好：某个义项正好是它 0，义项以它开头 1，义项里有它 2，只出现在 [网络] [医] 这类标注行 3 */
function zhMatchScore(translation: string, q: string): number {
  let best = 3;
  for (const line of translation.split('\n')) {
    if (line.trim().startsWith('[')) continue;
    for (const raw of line.split(/[,;，；、]/)) {
      const seg = raw.replace(/^\s*[a-z]+\.\s*/i, '').replace(/[（(][^）)]*[）)]/g, '').trim();
      if (seg === q) return 0;
      if (seg.startsWith(q)) best = Math.min(best, 1);
      else if (seg.includes(q)) best = Math.min(best, 2);
    }
  }
  return best;
}

/** exchange 里带类型的词形和原形（`0:go/1:p`：went 是 go 的变形）；指向自己的不算 */
function parseInflections(ex: string | null, word: string): Pick<DictEntry, 'inflections' | 'base'> {
  const inflections: NonNullable<DictEntry['inflections']> = []; let base: string | undefined;
  for (const part of (ex ?? '').split('/')) {
    const i = part.indexOf(':'); if (i < 1) continue;
    const type = part.slice(0, i); const form = part.slice(i + 1); if (!form) continue;
    if (type === '0') { if (form.toLowerCase() !== word.toLowerCase()) base = form; }
    else if (/^[pdi3rts]$/.test(type)) inflections.push({ type: type as 'p', form });
  }
  return { inflections, base };
}

/** ECDICT exchange 字段：`p:went/d:gone/i:going/3:goes/s:...` → 词形列表（跳过 0:原形 与 1:变形标志） */
export function parseExchange(ex: string | null): string[] {
  if (!ex) return [];
  const out: string[] = [];
  for (const part of ex.split('/')) {
    const i = part.indexOf(':'); if (i < 1) continue;
    const type = part.slice(0, i); const form = part.slice(i + 1);
    if (!form || type === '0' || type === '1' || /^\d/.test(form)) continue;
    out.push(form);
  }
  return out;
}
