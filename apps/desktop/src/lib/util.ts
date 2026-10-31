import type { Status } from '@tibi/core';

/** 词状态 → 着色 class（03 §6：生词荧光笔、学习中渐浅、待确认虚线；5 / 97 / 98 / 无行不标） */
export function wordClass(status: Status | undefined): string {
  if (status === undefined || status === 5 || status === 97 || status === 98) return 'w';
  if (status === 99) return 'w s99';
  return `w s${status}`;
}

export const STATUS_NAMES: Record<number, string> = { 0: '生词', 1: '见过', 2: '眼熟', 3: '认得', 4: '熟悉', 5: '掌握', 97: '已知', 98: '忽略', 99: '待确认' };
export const GENRE_NAMES: Record<string, string> = { tech: '技术', news: '新闻', lit: '文学', academic: '学术', general: '一般' };

export function fmtMinutes(n: number) { return n < 1 ? '不到 1 分钟' : `约 ${Math.round(n)} 分钟`; }
export function fmtPct(n: number) { return `${Math.round(n * 100)}%`; }
export function fmtDate(ts?: number) { if (!ts) return ''; const d = new Date(ts); return `${d.getMonth() + 1} 月 ${d.getDate()} 日`; }
export function fmtAgo(ts?: number) {
  if (!ts) return '';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return '刚刚'; if (s < 3600) return `${Math.floor(s / 60)} 分钟前`; if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  const d = Math.floor(s / 86400); return d < 30 ? `${d} 天前` : fmtDate(ts);
}

/** 首页输入框的判断（R13）：网址或长段英文 → 导入；其余 → 问 Tibi */
export function classifyInput(text: string): 'url' | 'text' | 'ask' {
  const t = text.trim();
  if (/^https?:\/\/\S+$/i.test(t)) return 'url';
  if (t.length > 160) { const en = (t.match(/[A-Za-z]/g) ?? []).length; if (en / t.replace(/\s/g, '').length > 0.6) return 'text'; }
  return 'ask';
}

export function throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t = 0; let timer: ReturnType<typeof setTimeout> | undefined; let last: A | undefined;
  return (...a: A) => { last = a; const now = Date.now(); if (now - t >= ms) { t = now; fn(...a); } else if (!timer) timer = setTimeout(() => { timer = undefined; t = Date.now(); fn(...last!); }, ms - (now - t)); };
}

export function speak(text: string, lang = 'en-US') {
  try { const u = new SpeechSynthesisUtterance(text); u.lang = lang; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* 无语音 */ }
}
