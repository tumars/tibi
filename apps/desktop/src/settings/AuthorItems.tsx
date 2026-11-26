import { SettingItem } from '../components/ui';
import { openExternalLink } from '../lib/external';
import { tl } from '../lib/i18n';

// 这些地址同时写在 capabilities/default.json 的 opener:allow-open-url 里（mailto 走 mailto:*），改这里要一起改
const LINKS = [['Twitter', 'https://x.com/Tumars'], ['GitHub', 'https://github.com/tumars'], [tl('个人站点'), 'https://www.ferecord.com/'], [tl('邮箱'), 'mailto:menghui9898@gmail.com']] as const;

/** WebView 里 target="_blank" 打不开，桌面端交给系统浏览器；地址要在 capabilities 的白名单里 */
export const openLink = openExternalLink;

/** 设置 → 关于：作者 */
export function AuthorItems() {
  return (
    <SettingItem
      title="Tumars"
      status={tl('90 后程序员')}
      control={<>{LINKS.map(([label, url]) => <a key={url} className="btn sm" href={url} target="_blank" rel="noopener noreferrer" onClick={e => void openLink(e)}>{label}</a>)}</>}
    />
  );
}

/** 设置 → 关于：捐赠 */
export function DonateItems() {
  return (
    <div className="item col"><div className="d" style={{ marginTop: 0 }}>{tl('Tibi 免费开源，欢迎扫码支持开发。')}</div>
      <div className="donate">
        <figure><img src="/donate/alipay.webp" alt={tl('支付宝收款码')} /><figcaption>{tl('支付宝')}</figcaption></figure>
        <figure><img src="/donate/wechat.webp" alt={tl('微信收款码')} /><figcaption>{tl('微信')}</figcaption></figure>
      </div>
    </div>
  );
}
