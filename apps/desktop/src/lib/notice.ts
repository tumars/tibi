import { isTauri } from '../rpc';
import { toast } from '../store/ui';
import { openDeepLink } from './deeplink';
import { lang, tl } from './i18n';
import { olderThan, parseNotices, type Notice, type NoticePlatform, type Text } from './notice-schema';
export { olderThan, parseNotices, type Notice, type NoticePlatform } from './notice-schema';

/**
 * Tibi 的公告：notice.json 直接发布到腾讯云 COS，也可由 notice-cn.yml 自动发布。
 * 和检查更新一起每天看一次，只访问自己的分发域名；经 http 插件取，不受 CORS 限制。
 * 一般的公告每条只提醒一次；写了 below 的（"该升级了"）每天提醒一次，装了新版本就不再出现。
 */
const SEEN = 'tibi.notice.seen';
const LAST = 'tibi.notice.last';
const HOUR = 3600_000;
// 这个地址同时写在 capabilities 的 http:default 里，改这里要一起改
const SOURCE = 'https://dl.ferecord.com/notice.json';

export interface ShownNotice { id: string; text: string; urgent: boolean; url?: string; label?: string }
export interface NoticeCtx { version: string; platform: NoticePlatform; today: string; seen: Record<string, string> }

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
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch(SOURCE, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`${SOURCE}: ${r.status}`);
    return parseNotices(await r.json());
  } finally { clearTimeout(t); }
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
