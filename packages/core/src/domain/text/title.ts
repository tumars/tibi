/**
 * 网页标题清理（M1）：去掉"- 站点名"这类后缀 / 前缀；拿不准时用页面第一个 h1。
 * 例：What is Ownership? - The Rust Programming Language → What is Ownership?
 */
const SEPS = [' - ', ' | ', ' — ', ' – ', ' · ', ' :: ', ' • '];
const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}]+/gu, ' ').trim();

export function cleanTitle(title: string, o: { site?: string; h1?: string; host?: string } = {}): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (!t) return t;
  const site = o.site?.trim();
  for (const sep of SEPS) {
    if (!t.includes(sep)) continue;
    const parts = t.split(sep).map(x => x.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    // 1. 站点名在头或尾
    if (site) {
      if (norm(parts[parts.length - 1]!) === norm(site)) return parts.slice(0, -1).join(sep);
      if (norm(parts[0]!) === norm(site)) return parts.slice(1).join(sep);
    }
    // 2. 第一段就是页面的 h1
    if (o.h1 && norm(parts[0]!) === norm(o.h1)) return parts[0]!;
    if (o.h1 && norm(parts[parts.length - 1]!) === norm(o.h1)) return parts[parts.length - 1]!;
    // 3. 最后一段像域名（example.com、Example Blog 里包含主机名）
    const host = o.host?.replace(/^(www|blog|docs|developer)\./, '').split('.')[0]?.toLowerCase();
    const last = norm(parts[parts.length - 1]!);
    if (host && host.length >= 2 && (last.split(' ').includes(host) || (host.length > 3 && last.replace(/ /g, '').includes(host)))) return parts.slice(0, -1).join(sep);
  }
  return t;
}

/** 正文开头的标题与文章标题相同就去掉（阅读器已经把标题显示在上面） */
export function dropLeadingTitle(markdown: string, title: string): string {
  const m = markdown.match(/^\s*#{1,3}\s+(.+)\n+/);
  if (m && norm(m[1]!) === norm(title)) return markdown.slice(m[0].length);
  return markdown;
}
