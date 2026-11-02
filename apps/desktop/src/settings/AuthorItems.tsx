import type { MouseEvent } from 'react';
import { tl } from '../lib/i18n';
import { isTauri } from '../rpc';
import { toast } from '../store/ui';

// 这三个地址同时写在 capabilities/default.json 的 opener:allow-open-url 里，改这里要一起改
const LINKS = [['Twitter', 'https://x.com/Tumars'], ['GitHub', 'https://github.com/tumars'], [tl('个人站点'), 'https://www.ferecord.com/']] as const;

/** WebView 里 target="_blank" 打不开，桌面端交给系统浏览器；地址要在 capabilities 的白名单里 */
export const openLink = async (e: MouseEvent<HTMLAnchorElement>) => {
  if (!isTauri()) return;
  e.preventDefault();
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(e.currentTarget.href).catch(err => toast(String(err), { kind: 'err' }));
};

/** 设置 → 关于：作者 */
export function AuthorItems() {
  return (
    <div className="item"><div><div className="t">Tumars</div><div className="d">{tl('90 后程序员')}</div></div><div className="ctl">
      {LINKS.map(([label, url]) => <a key={url} className="btn sm" href={url} target="_blank" rel="noopener noreferrer" onClick={e => void openLink(e)}>{label}</a>)}
    </div></div>
  );
}

/** 设置 → 关于：捐赠 */
export function DonateItems() {
  return (
    <div className="item col"><div className="d" style={{ marginTop: 0 }}>{tl('Tibi 免费开源。如果它帮到了你，可以扫码请作者喝杯咖啡')}</div>
      <div className="donate">
        <figure><img src="/donate/alipay.webp" alt={tl('支付宝收款码')} /><figcaption>{tl('支付宝')}</figcaption></figure>
        <figure><img src="/donate/wechat.webp" alt={tl('微信收款码')} /><figcaption>{tl('微信')}</figcaption></figure>
      </div>
    </div>
  );
}
