import type { CardType, PracticeMode, Rating, Status } from '../../types.js';

/**
 * 评分规则（G1，00 §3.3）：用户只管答题，评分交给系统。
 * 阈值按题型：选义 > 9 秒、填空 > 15 秒算慢；填空 6 秒内又快又对算轻松；用了提示最高为模糊。
 */
const SLOW_MS: Record<CardType | PracticeMode, number> = { choice: 9_000, cloze: 15_000, recognize: 0, dictation: 15_000, spell: 20_000, confusable: 9_000, produce: 0 };
const FAST_MS: Partial<Record<CardType | PracticeMode, number>> = { cloze: 6_000, spell: 6_000 };

export function normalizeAnswer(s: string): string {
  return s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'\- ]/g, '').replace(/\s+/g, ' ').trim();
}

/** 编辑距离（相邻两个字母写反算 1 步，Damerau 最优串对齐） */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => { const r = new Array<number>(n + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[m]![n]!;
}

export interface Judged { correct: boolean; near_miss: boolean; distance?: number }

/** 输入题判定：正确 / 差一点（拼写相近、仅大小写或词形差异）/ 不对 */
export function judgeTyped(expected: string[], answer: string): Judged {
  const a = normalizeAnswer(answer);
  if (!a) return { correct: false, near_miss: false };
  const forms = expected.map(normalizeAnswer).filter(Boolean);
  if (forms.includes(a)) return { correct: true, near_miss: false, distance: 0 };
  let best = Infinity;
  for (const f of forms) best = Math.min(best, levenshtein(a, f));
  // 允许的"差一点"：编辑距离 ≤ 1，或长词 ≤ 2（≥ 10 个字母）
  const tol = Math.max(...forms.map(f => f.length)) >= 10 ? 2 : 1;
  if (best <= tol) return { correct: true, near_miss: true, distance: best };
  return { correct: false, near_miss: false, distance: best };
}

export interface GradeInput { card_type: CardType | PracticeMode; correct: boolean; near_miss: boolean; hints: number; duration_ms: number; self_rating?: Rating }

/** 系统评分 + 理由（G1） */
export function gradeAnswer(i: GradeInput): { rating: Rating; reason: string } {
  const sec = Math.round(i.duration_ms / 1000);
  if (i.card_type === 'recognize' || i.card_type === 'produce') {
    const r = i.self_rating ?? (i.correct ? 3 : 1);
    return { rating: r, reason: '自评' };
  }
  if (!i.correct) return { rating: 1, reason: '答错了' };
  if (i.hints > 0) return { rating: 2, reason: `答对，用了 ${i.hints} 次提示` };
  if (i.near_miss) return { rating: 2, reason: '差一点，拼写相近' };
  const slow = SLOW_MS[i.card_type];
  if (slow && i.duration_ms > slow) return { rating: 2, reason: `答对，但用了 ${sec} 秒` };
  const fast = FAST_MS[i.card_type];
  if (fast && i.duration_ms <= fast) return { rating: 4, reason: `答对，用时 ${sec} 秒，又快又准` };
  return { rating: 3, reason: `答对，用时 ${sec} 秒` };
}

/**
 * 评分与熟练度联动（00 §3.3）：忘了降一档；模糊不变；记得升一档；轻松升一档（生词 / 见过 / 眼熟时升两档）。
 * 复习过一次后至少是"见过"；稳定性 ≥ 60 天才可能升到"掌握"。只对 0–5 生效。
 */
export function nextStatus(current: Status, rating: Rating, stability: number): Status {
  if (current > 5) return current;
  const cap = stability >= 60 ? 5 : 4;
  let s: number = current;
  if (rating === 1) s = current - 1;
  else if (rating === 3) s = current + 1;
  else if (rating === 4) s = current + (current <= 2 ? 2 : 1);
  s = Math.max(1, Math.min(cap, s));
  if (rating === 2) s = Math.max(1, Math.min(current, cap));
  return s as Status;
}

export const STATUS_NAME: Record<number, string> = { 0: '生词', 1: '见过', 2: '眼熟', 3: '认得', 4: '熟悉', 5: '掌握', 97: '已知', 98: '忽略' };
export const RATING_NAME: Record<Rating, string> = { 1: '忘了', 2: '模糊', 3: '记得', 4: '轻松' };
