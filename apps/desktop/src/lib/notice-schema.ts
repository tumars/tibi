export type NoticePlatform = 'macos' | 'windows' | 'linux' | 'android' | 'ios';
export type Text = string | { zh: string; en?: string };
export interface Notice {
  id: string;
  message: Text;
  /** 只给这些平台看；不写是全部 */
  platforms?: NoticePlatform[];
  /** 只给低于这个版本的看，每天提醒一次（催升级用） */
  below?: string;
  /** 这天之后不再显示（YYYY-MM-DD，含当天） */
  until?: string;
  /** 按钮：网址或 tibi:// 深链；label 不写时是"去看看" */
  url?: string;
  label?: Text;
}
const PLATFORMS: NoticePlatform[] = ['macos', 'windows', 'linux', 'android', 'ios'];
const isText = (v: unknown): v is Text => typeof v === 'string' ? !!v.trim() : !!v && typeof v === 'object' && typeof (v as { zh?: unknown }).zh === 'string' && !!(v as { zh: string }).zh.trim();
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const VER = /^\d+(\.\d+){0,2}$/;

/** 校验 notice.json；有一条写错就整个文件不用（发布前 test/notice.test.ts 会先拦下） */
export function parseNotices(raw: unknown): Notice[] {
  const list = (raw as { notices?: unknown })?.notices;
  if (!Array.isArray(list)) throw new Error('notice.json 要有 notices 数组');
  const ids = new Set<string>();
  return list.map((n: Partial<Notice>, i) => {
    const at = `notices[${i}]`;
    if (typeof n?.id !== 'string' || !n.id.trim()) throw new Error(`${at}.id 要是非空字符串`);
    if (ids.has(n.id)) throw new Error(`${at}.id 重复：${n.id}`);
    ids.add(n.id);
    if (!isText(n.message)) throw new Error(`${at}.message 要是字符串或 { zh, en }`);
    if (n.platforms !== undefined && (!Array.isArray(n.platforms) || !n.platforms.every(p => PLATFORMS.includes(p)))) throw new Error(`${at}.platforms 只能是 ${PLATFORMS.join(' / ')}`);
    if (n.below !== undefined && !(typeof n.below === 'string' && VER.test(n.below))) throw new Error(`${at}.below 要是 0.2.0 这样的版本号`);
    if (n.until !== undefined && !(typeof n.until === 'string' && DAY.test(n.until))) throw new Error(`${at}.until 要是 YYYY-MM-DD`);
    if (n.url !== undefined && !(typeof n.url === 'string' && /^(https:\/\/|tibi:\/\/)/.test(n.url))) throw new Error(`${at}.url 要是 https:// 或 tibi:// 开头`);
    if (n.label !== undefined && !isText(n.label)) throw new Error(`${at}.label 要是字符串或 { zh, en }`);
    return n as Notice;
  });
}

/** a 比 b 旧；只比数字部分（0.1.0-beta 当 0.1.0） */
export function olderThan(a: string, b: string): boolean {
  const pa = a.split(/[.+-]/).slice(0, 3).map(Number), pb = b.split(/[.+-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x < y; }
  return false;
}
