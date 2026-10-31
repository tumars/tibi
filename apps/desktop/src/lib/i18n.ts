import en from '../locales/en.json';

/**
 * 界面语言（M6，T25）：源码里直接写中文，用 tl('中文原文', { 变量 }) 包起来；中文原文就是键。
 * 英文在 locales/en.json（{ "中文原文": "English" }），缺的条目显示中文。占位符写成 {name}。
 * 语言在启动时定下来（localStorage 的 tibi.lang，默认中文）；切换后重新载入界面，所以模块顶层的常量也能用 tl。
 * 改了界面文案后跑 pnpm --filter @tibi/desktop i18n:check 看哪些串还没翻。
 * Core 产生的文字（任务标题、错误、AI 内容）不经过这里，仍是中文（T25）。
 */
export type Lang = 'zh' | 'en';
const KEY = 'tibi.lang';
const DICTS: Record<Lang, Record<string, string> | null> = { zh: null, en: en as Record<string, string> };

export const lang: Lang = (() => {
  try { const v = localStorage.getItem(KEY); if (v === 'zh' || v === 'en') return v; } catch { /* 无存储 */ }
  return 'zh';
})();
try { document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'; } catch { /* 非浏览器 */ }

export function tl(s: string, vars?: Record<string, string | number | undefined | null>): string {
  const out = DICTS[lang]?.[s] || s;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? '') : m)) : out;
}

export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* 无存储 */ }
  location.reload();
}

/** 日期、数字格式用的 locale */
export const locale = lang === 'en' ? 'en-US' : 'zh-CN';
