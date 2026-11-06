import { tl } from '../lib/i18n';

/**
 * Web 版入口（web.html，12）：Core 跑在这个页面里（web/runtime.ts）。
 * 宽屏用桌面界面，窄屏用手机壳；同一时间只开一个标签页（OPFS 的库只能一个地方打开），另一个标签页显示提示。
 */
type Flags = { __TIBI_WEB__?: boolean; __TIBI_MOBILE_UI__?: boolean };
const w = window as Flags;
w.__TIBI_WEB__ = true;
const mobile = matchMedia('(max-width: 760px)').matches;
if (mobile) w.__TIBI_MOBILE_UI__ = true;

/** 拿到就一直拿着，直到标签页关掉 */
function holdTabLock(): Promise<boolean> {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise(resolve => {
    void navigator.locks.request('tibi-core', { ifAvailable: true }, lock => {
      resolve(!!lock);
      return lock ? new Promise<void>(() => undefined) : undefined;
    });
  });
}

function showBusy() {
  const root = document.getElementById('root')!;
  root.innerHTML = '';
  const box = document.createElement('div');
  box.style.cssText = 'max-width:420px;margin:20vh auto 0;padding:0 16px;text-align:center;font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#333';
  const p = document.createElement('p'); p.textContent = tl('Tibi 已经在另一个标签页里打开了。同一时间只能开一个，先关掉那个再回来。');
  const b = document.createElement('button'); b.textContent = tl('重试');
  b.style.cssText = 'margin-top:12px;padding:8px 20px;border-radius:999px;border:0;background:#4f46e5;color:#fff;font:inherit;cursor:pointer';
  b.onclick = () => location.reload();
  box.append(p, b); root.append(box);
}

void (async () => {
  if (!(await holdTabLock())) { showBusy(); return; }
  // 请浏览器别清这个站点的数据（不保证，Safari 仍可能清）
  void navigator.storage?.persist?.().catch(() => undefined);
  // 书里的插图由 Service Worker 从 OPFS 读（public/web-sw.js）
  if ('serviceWorker' in navigator) void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}web-sw.js`).catch(e => console.warn('[tibi] Service Worker 没注册上', e));
  await (mobile ? import('../mobile/main') : import('../main'));
})();
