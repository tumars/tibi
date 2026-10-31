import type { DictEntry } from '../types.js';

/**
 * 词典接口（01 §8：dict.db / ECDICT 只读）。
 * core-node 用 better-sqlite3 打开 dict.db 实现；没有词典时用 NullDict，查词返回空、词形还原退化为规则。
 */
export interface Dict {
  /** 按词头精确查（小写） */
  lookup(word: string): Promise<DictEntry | undefined>;
  /** 词形还原：返回候选原形，rank 小的在前（left → leave / left）；没有记录时返回 [] */
  lemmas(form: string): Promise<string[]>;
  /** 词频排名（frq / bnc，越小越常见）；没有时 undefined。预标注规则用 */
  frequencyRank(lemma: string): Promise<number | undefined>;
  /** 批量取词频，减少往返；默认逐个调用 */
  frequencyRanks?(lemmas: string[]): Promise<Map<string, number>>;
  /** 词典例句（有的话）；M1 词典例句来自 ECDICT 没有的字段，先返回 [] */
  examples?(word: string): Promise<{ en: string; zh?: string }[]>;
}

export class NullDict implements Dict {
  async lookup() { return undefined; }
  async lemmas() { return []; }
  async frequencyRank() { return undefined; }
}
