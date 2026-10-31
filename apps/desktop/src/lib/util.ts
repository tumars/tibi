import type { Status } from '@tibi/core';
import { tl } from './i18n';

/** 词状态 → 着色 class（03 §6：生词荧光笔、学习中渐浅、待确认虚线；5 / 97 / 98 / 无行不标） */
export function wordClass(status: Status | undefined): string {
  if (status === undefined || status === 5 || status === 97 || status === 98) return 'w';
  if (status === 99) return 'w s99';
  return `w s${status}`;
}

export const STATUS_NAMES: Record<number, string> = { 0: tl('生词'), 1: tl('见过'), 2: tl('眼熟'), 3: tl('认得'), 4: tl('熟悉'), 5: tl('掌握'), 97: tl('已知'), 98: tl('忽略'), 99: tl('待确认') };
export const GENRE_NAMES: Record<string, string> = { tech: tl('技术'), news: tl('新闻'), lit: tl('文学'), academic: tl('学术'), general: tl('一般') };

export function fmtMinutes(n: number) { return n < 1 ? tl('不到 1 分钟') : tl('约 {v0} 分钟', { v0: Math.round(n) }); }
export function fmtPct(n: number) { return `${Math.round(n * 100)}%`; }
export function fmtDate(ts?: number) { if (!ts) return ''; const d = new Date(ts); return tl('{v0} 月 {v1} 日', { v0: d.getMonth() + 1, v1: d.getDate() }); }
export function fmtAgo(ts?: number) {
  if (!ts) return '';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return tl('刚刚'); if (s < 3600) return tl('{v0} 分钟前', { v0: Math.floor(s / 60) }); if (s < 86400) return tl('{v0} 小时前', { v0: Math.floor(s / 3600) });
  const d = Math.floor(s / 86400); return d < 30 ? tl('{d} 天前', { d }) : fmtDate(ts);
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

/** 单词发音、句子朗读：走设置里选的引擎（系统语音 / Kokoro，lib/tts） */
export function speak(text: string) {
  void import('./tts').then(t => t.say(text));
}
