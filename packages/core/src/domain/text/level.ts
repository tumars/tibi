/**
 * 文本级别（与用户无关，00 §3.1）：只看词频。数一段文字里排在常用 3000 词以外（或词频表里没有）的词占多少，
 * 粗略对到 CEFR。不再按"对这个用户的生词率"算难度——Tibi 不估用户的词汇量，生词只有用户自己标的那些。
 */
export const COMMON_RANK = 3000;

const LEVELS: [number, string][] = [[0.04, 'A2'], [0.07, 'B1'], [0.1, 'B2'], [0.14, 'C1']];

/** 罕见词占比 → CEFR（A2–C2） */
export function levelOfRatio(rare_ratio: number): string {
  for (const [max, lv] of LEVELS) if (rare_ratio < max) return lv;
  return 'C2';
}

/** 这个词频算不算罕见：没有词频（专业词、拼写变体）也算 */
export function isRare(rank: number | undefined): boolean {
  return rank === undefined || rank <= 0 || rank > COMMON_RANK;
}
