import { classifyInput } from '../lib/util';

export type TrayHotkeyPreset = 'off' | 'alt+shift+d' | 'ctrl+alt+d' | 'ctrl+alt+t' | 'alt+space' | 'cmd+shift+l';

export const DEFAULT_TRAY_HOTKEY: TrayHotkeyPreset = 'alt+shift+d';

export const TRAY_HOTKEYS: { id: TrayHotkeyPreset; keys: string }[] = [
  { id: 'off', keys: '' },
  { id: 'alt+shift+d', keys: '⌥⇧D' },
  { id: 'ctrl+alt+d', keys: '⌃⌥D' },
  { id: 'ctrl+alt+t', keys: '⌃⌥T' },
  { id: 'alt+space', keys: '⌥Space' },
  { id: 'cmd+shift+l', keys: '⌘⇧L' },
];

export function hotkeyKeys(preset: string | undefined): string {
  return TRAY_HOTKEYS.find(x => x.id === preset)?.keys ?? '';
}

export type TrayQueryIntent =
  | { kind: 'empty' }
  | { kind: 'url'; url: string; host: string }
  | { kind: 'passage'; text: string }
  | { kind: 'dict'; text: string }
  | { kind: 'ask'; text: string };

export type ClipboardHint =
  | { kind: 'word'; text: string }
  | { kind: 'url'; url: string; host: string };

const ENGLISH_TERM = /^[A-Za-z][A-Za-z0-9'’.-]*(?:\s+[A-Za-z][A-Za-z0-9'’.-]*){0,3}$/;
const SHORT_CJK = /^[\u3400-\u9fff]{1,12}$/;

function parseHttpUrl(raw: string): { url: string; host: string } | null {
  if (!/^https?:\/\/\S+$/i.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return { url: u.href, host: u.host };
  } catch {
    return null;
  }
}

/** 判断顶栏输入框里的意图：网址 → 剪藏；长英文 → 导入/讲解；词或短语/短中文 → 查词；其他 → 问 Tibi */
export function classifyTrayQuery(raw: string): TrayQueryIntent {
  const t = raw.trim();
  if (!t) return { kind: 'empty' };
  const url = parseHttpUrl(t);
  if (url) return { kind: 'url', ...url };
  if (classifyInput(t) === 'text') return { kind: 'passage', text: t };
  const singleLine = !/[\r\n]/.test(t);
  if (singleLine && t.length <= 48 && (ENGLISH_TERM.test(t) || SHORT_CJK.test(t))) {
    return { kind: 'dict', text: t };
  }
  return { kind: 'ask', text: t };
}

/** 剪贴板建议条只认干净的英文单词/短语（<= 40 字符）或 http(s) 网址，避免把大段代码、密码或日志露出来 */
export function classifyClipboardHint(raw: string | null | undefined): ClipboardHint | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t || /[\r\n]/.test(t)) return null;
  const url = parseHttpUrl(t);
  if (url) return { kind: 'url', ...url };
  if (t.length <= 40 && ENGLISH_TERM.test(t) && !/^[A-Z0-9_.-]+$/.test(t)) {
    // 排除纯数字、疑似 token/缩写全大写串（如 API_KEY、UUID）
    const words = t.split(/\s+/);
    if (words.every(w => !/\d/.test(w) && w.length <= 28)) {
      return { kind: 'word', text: t };
    }
  }
  return null;
}
