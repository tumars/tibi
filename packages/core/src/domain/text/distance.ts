/** Damerau-Levenshtein 编辑距离（相邻字母对调算 1 步）；传入 max 时超过上限提前返回 max + 1 */
export function damerauLevenshtein(a: string, b: string, max?: number): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (max !== undefined && Math.abs(m - n) > max) return max + 1;
  if (!m) return max !== undefined ? Math.min(n, max + 1) : n;
  if (!n) return max !== undefined ? Math.min(m, max + 1) : m;
  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= n; j++) {
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v);
      if (v < low) low = v;
    }
    if (max !== undefined && low > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  const res = prev[n]!;
  return max !== undefined ? Math.min(res, max + 1) : res;
}
