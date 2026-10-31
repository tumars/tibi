import type { Database, Dict, DictEntry } from '@tibi/core';

/**
 * dict.db（ECDICT）上的词典实现（01 §8）。表：stardict（ECDICT 原表）、lemma_map(form, lemma, rank)（入库脚本预生成）。
 */
interface StardictRow extends Record<string, string | number | null> { word: string; phonetic: string | null; definition: string | null; translation: string | null; pos: string | null; collins: number | null; oxford: number | null; tag: string | null; bnc: number | null; frq: number | null; exchange: string | null }

export class SqliteDict implements Dict {
  constructor(private readonly db: Database) {}

  async lookup(word: string): Promise<DictEntry | undefined> {
    const w = word.toLowerCase().trim();
    const r = await this.db.get<StardictRow>('SELECT word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange FROM stardict WHERE word = ? COLLATE NOCASE LIMIT 1', [w]);
    if (!r) return undefined;
    return {
      word: r.word, phonetic: r.phonetic ?? undefined, translation: (r.translation ?? '').replace(/\\n/g, '\n'), definition: r.definition?.replace(/\\n/g, '\n') ?? undefined, pos: r.pos ?? undefined,
      collins: r.collins ?? undefined, oxford: !!r.oxford, exam: (r.tag ?? '').split(/\s+/).filter(Boolean),
      frequency: r.frq || r.bnc || undefined, forms: parseExchange(r.exchange),
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
    for (let i = 0; i < lemmas.length; i += 400) {
      const chunk = lemmas.slice(i, i + 400);
      const rows = await this.db.all<{ word: string; frq: number | null; bnc: number | null }>(`SELECT word, frq, bnc FROM stardict WHERE word IN (${chunk.map(() => '?').join(',')})`, chunk);
      for (const r of rows) { const v = r.frq || r.bnc; if (v) out.set(r.word.toLowerCase(), v); }
    }
    return out;
  }
}

/** ECDICT exchange 字段：`p:went/d:gone/i:going/3:goes/s:...` → 词形列表 */
export function parseExchange(ex: string | null): string[] {
  if (!ex) return [];
  return ex.split('/').map(s => s.split(':')[1]).filter((s): s is string => !!s && !/^\d/.test(s));
}
