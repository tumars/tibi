import { tl } from './i18n';

/** ECDICT 字段的显示：词性、考试标签、词形类型 */
const POS_NAMES: Record<string, string> = { n: tl('名词'), v: tl('动词'), j: tl('形容词'), a: tl('形容词'), r: tl('副词'), d: tl('限定词'), i: tl('介词'), p: tl('代词'), c: tl('连词'), m: tl('数词'), u: tl('感叹词'), t: tl('不定式') };
export const EXAM_NAMES: Record<string, string> = { zk: tl('中考'), gk: tl('高考'), cet4: tl('四级'), cet6: tl('六级'), ky: tl('考研'), toefl: tl('托福'), ielts: tl('雅思'), gre: 'GRE' };
export const INFLECTION_NAMES: Record<string, string> = { p: tl('过去式'), d: tl('过去分词'), i: tl('现在分词'), 3: tl('三单'), r: tl('比较级'), t: tl('最高级'), s: tl('复数') };

export interface GlossLine { tag?: string; text: string }

/** 释义一行一个义项组：`n. 跑, 赛跑` 带词性，`[计] 编译程序` 带领域，其余没有标签 */
export function parseGloss(text: string): GlossLine[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = /^([a-z]{1,6}\.)\s*(.*)$/i.exec(l) ?? /^\[([^\]]+)\]\s*(.*)$/.exec(l);
    return m ? { tag: m[1]!, text: m[2]! } : { text: l };
  });
}

/** pos 字段 `n:46/v:54` → 名词 46% · 动词 54%，占比大的在前 */
export function posShares(pos?: string): string {
  if (!pos) return '';
  return pos.split('/').map(p => p.split(':')).filter(p => p[0] && Number(p[1]) > 0).sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(p => `${POS_NAMES[p[0]!] ?? p[0]} ${p[1]}%`).join(' · ');
}

const RECENT_KEY = 'tibi.dict.recent';
export const loadRecentLookups = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; } };
export function rememberLookup(word: string): string[] {
  const list = [word, ...loadRecentLookups().filter(w => w.toLowerCase() !== word.toLowerCase())].slice(0, 20);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* 无存储 */ }
  return list;
}
export function clearRecentLookups() { try { localStorage.removeItem(RECENT_KEY); } catch { /* 无存储 */ } }
