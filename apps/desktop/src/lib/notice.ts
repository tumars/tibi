import { isTauri } from '../rpc';
import { toast } from '../store/ui';
import { openDeepLink } from './deeplink';
import { lang, tl } from './i18n';

/**
 * Tibi 的公告：仓库根目录的 notice.json，推到 main 后同步到国内源（notice-cn.yml）。
 * 和检查更新一起每天看一次，先查国内源、连不上再查 GitHub；经 http 插件取，不受 CORS 限制。
 * 一般的公告每条只提醒一次；写了 below 的（"该升级了"）每天提醒一次，装了新版本就不再出现。
 */
const SEEN = 'tibi.notice.seen';
const LAST = 'tibi.notice.last';
const HOUR = 3600_000;
// 这两个地址同时写在 capabilities 的 http:default 里，改这里要一起改
const SOURCES = ['https://dl.ferecord.com/notice.json', 'https://raw.githubusercontent.com/tumars/tibi/main/notice.json'];

export type NoticePlatform = 'macos' | 'windows' | 'linux' | 'android' | 'ios';
type Text = string | { zh: string; en?: string };
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
export interface ShownNotice { id: string; text: string; urgent: boolean; url?: string; label?: string }
export interface NoticeCtx { version: string; platform: NoticePlatform; today: string; seen: Record<string, string> }

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

const textOf = (t: Text) => typeof t === 'string' ? t : (lang === 'en' && t.en) || t.zh;

/** 这台设备今天该看的公告 */
export function pickNotices(list: Notice[], ctx: NoticeCtx): ShownNotice[] {
  return list.filter(n => {
    if (n.platforms && !n.platforms.includes(ctx.platform)) return false;
    if (n.until && ctx.today > n.until) return false;
    if (n.below && !olderThan(ctx.version, n.below)) return false;
    const seen = ctx.seen[n.id];
    return n.below ? seen !== ctx.today : !seen;
  }).map(n => ({ id: n.id, text: textOf(n.message), urgent: !!n.below, url: n.url, label: n.label && textOf(n.label) }));
}

/** iPad 的 UA 也写 Macintosh，手机壳（Core 在 WebView 里）里就当 iOS */
export function currentPlatform(ua = navigator.userAgent, mobile = !!(globalThis as { __TIBI_LOCAL_CORE__?: boolean }).__TIBI_LOCAL_CORE__): NoticePlatform {
  if (/Android/.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && mobile)) return 'ios';
  if (/Mac/.test(ua)) return 'macos';
  if (/Windows/.test(ua)) return 'windows';
  return 'linux';
}

async function fetchNotices(): Promise<Notice[]> {
  const { fetch } = await import('@tauri-apps/plugin-http');
  let err: unknown;
  for (const url of SOURCES) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return parseNotices(await r.json());
    } catch (e) { err = e; } finally { clearTimeout(t); }
  }
  throw err;
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const readSeen = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(SEEN) ?? '{}') as Record<string, string>; } catch { return {}; } };

/** 用提示条显示：催升级的留 60 秒，一般的 15 秒 */
export function presentNotice(n: ShownNotice) {
  const url = n.url;
  const run = url && (() => {
    if (url.startsWith('tibi://')) { openDeepLink(url); return; }
    void import('@tauri-apps/plugin-opener').then(o => o.openUrl(url)).catch(e => toast(String(e), { kind: 'err' }));
  });
  toast(n.text, { ms: n.urgent ? 60_000 : 15_000, ...(run ? { action: { label: n.label || tl('去看看'), run } } : {}) });
}

/** 每天查一次公告（enabled 关着就不查）；查不到不打扰，第二天再试。返回停止函数 */
export function startNoticeCheck(show: (n: ShownNotice) => void, enabled: () => boolean = () => true): () => void {
  if (!isTauri()) return () => undefined;
  const tick = async () => {
    if (!enabled()) return;
    const day = today();
    let last = ''; try { last = localStorage.getItem(LAST) ?? ''; } catch { /* */ }
    if (last === day) return;
    try { localStorage.setItem(LAST, day); } catch { /* */ }
    const got = await Promise.all([fetchNotices(), import('@tauri-apps/api/app').then(a => a.getVersion())]).catch(() => undefined);
    if (!got) return;
    const [list, version] = got;
    const seen = readSeen();
    const shown = pickNotices(list, { version, platform: currentPlatform(), today: day, seen });
    // 已经不在 notice.json 里的条目就不用记了
    const next: Record<string, string> = {};
    for (const n of list) { const d = seen[n.id]; if (d) next[n.id] = d; }
    for (const n of shown) next[n.id] = day;
    try { localStorage.setItem(SEEN, JSON.stringify(next)); } catch { /* */ }
    shown.forEach(show);
  };
  const first = setTimeout(() => void tick(), 20_000);
  const h = setInterval(() => void tick(), HOUR);
  return () => { clearTimeout(first); clearInterval(h); };
}
