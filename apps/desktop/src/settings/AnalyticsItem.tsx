import { useEffect, useState } from 'react';
import { Switch } from '../components/Switch';
import { analyticsEnabled, setUsageAnalytics } from '../lib/analytics';
import { lang, tl } from '../lib/i18n';

export function AnalyticsItem() {
  const [on, setOn] = useState(analyticsEnabled);
  useEffect(() => { const update = () => setOn(analyticsEnabled()); addEventListener('tibi-analytics-change', update); return () => removeEventListener('tibi-analytics-change', update); }, []);
  const title = tl('使用统计');
  const description = lang === 'en' ? 'Off by default. Share feature counts and a random installation ID with Mixpanel (US). No articles, words, chats or recordings. Turn off to clear pending events.' : '默认关闭。开启后向 Mixpanel（美国）发送功能次数与随机安装标识，不发送文章、词句、对话或录屏。关闭会清除待发记录。';
  return <div className="item"><div><div className="t">{title}</div><div className="d">{description} <a href="https://github.com/tumars/tibi/blob/main/PRIVACY.md" target="_blank" rel="noopener noreferrer">{lang === 'en' ? 'Privacy policy' : '隐私说明'}</a></div></div><div className="ctl"><Switch checked={on} onChange={value => { if (setUsageAnalytics(value)) setOn(analyticsEnabled()); }} label={title} /></div></div>;
}
