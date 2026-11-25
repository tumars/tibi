import { useEffect, useState } from 'react';
import { Switch } from '../components/Switch';
import { SettingItem } from '../components/ui';
import { analyticsEnabled, setUsageAnalytics } from '../lib/analytics';
import { lang, tl } from '../lib/i18n';

export function AnalyticsItem() {
  const [on, setOn] = useState(analyticsEnabled);
  useEffect(() => { const update = () => setOn(analyticsEnabled()); addEventListener('tibi-analytics-change', update); return () => removeEventListener('tibi-analytics-change', update); }, []);
  const title = tl('使用统计');
  const tip = lang === 'en'
    ? 'Off by default. Shares feature counts and a random installation ID with Mixpanel (US). No articles, words, chats, or recordings. Turning off clears pending events.'
    : '默认关闭。开启后向 Mixpanel（美国）发送功能使用频次与随机安装标识，不包含文章、词句、对话或录屏；关闭后清除待发送记录。';
  return (
    <SettingItem
      title={title}
      tip={tip}
      status={<>{lang === 'en' ? 'Off by default · ' : '默认关闭 · '}<a href="https://github.com/tumars/tibi/blob/main/PRIVACY.md" target="_blank" rel="noopener noreferrer">{lang === 'en' ? 'Privacy policy' : '隐私说明'}</a></>}
      control={<Switch checked={on} onChange={value => { if (setUsageAnalytics(value)) setOn(analyticsEnabled()); }} label={title} />}
    />
  );
}
