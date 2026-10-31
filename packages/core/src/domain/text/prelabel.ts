/**
 * 自动预标注（00 §3.1 第 4 步，中间带规则的唯一定义处）：
 * 估算词汇量为 N 时，
 *   - 词频排名 ≤ N          → 默认视为已知：不建 terms 行、不着色（点开也不写入，R5）；
 *   - N < 排名 ≤ N + 3000   → "可能不认识"：status 99 待确认（虚线，用户在词卡上一键确认）；
 *   - 排名 > N + 3000 或没有词频 → 默认视为生词：status 0。
 * 例：N = 6000 时，前 6000 已知，6000–9000 待确认，9000 以上生词。
 */
export const UNSURE_BAND = 3000;

export type Prelabel = 'known' | 'unsure' | 'new';

export function prelabel(rank: number | undefined, vocab_estimate: number): Prelabel {
  const N = Math.max(0, vocab_estimate | 0);
  if (rank === undefined || rank <= 0) return 'new';
  if (rank <= N) return 'known';
  if (rank <= N + UNSURE_BAND) return 'unsure';
  return 'new';
}

export const PRELABEL_STATUS: Record<Prelabel, 0 | 99 | undefined> = { known: undefined, unsure: 99, new: 0 };

/** 词汇量估算 → CEFR（00 §3.9 自评档位的反推，用于难度标签） */
export function cefrOfEstimate(n: number): string {
  if (n < 2500) return 'A2';
  if (n < 4500) return 'B1';
  if (n < 7000) return 'B2';
  if (n < 10000) return 'C1';
  return 'C2';
}

/** 生词率 → 对这个用户的难度（学习区约 2–5%，00 §3.1） */
export function difficultyOfRatio(unknown_ratio: number): 'ok' | 'mid' | 'hard' {
  if (unknown_ratio <= 0.05) return 'ok';
  if (unknown_ratio <= 0.08) return 'mid';
  return 'hard';
}

/** 文章的预估 CEFR：按生词率和用户水平粗算（本地规则，不调模型） */
export function cefrOfDocument(unknown_ratio: number, vocab_estimate: number): string {
  const base = ['A2', 'B1', 'B2', 'C1', 'C2'];
  let i = base.indexOf(cefrOfEstimate(vocab_estimate));
  if (unknown_ratio > 0.08) i += 1; else if (unknown_ratio < 0.015) i -= 1;
  return base[Math.max(0, Math.min(base.length - 1, i))]!;
}
