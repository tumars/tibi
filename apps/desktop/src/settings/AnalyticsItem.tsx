import { useEffect, useState } from 'react';
import { Switch } from '../components/Switch';
import { SettingItem } from '../components/ui';
import { analyticsEnabled, setUsageAnalytics, usageAnalyticsBlockReason, USAGE_ANALYTICS_CHANGE } from '../lib/analytics';
import { openExternalLink } from '../lib/external';
import { lang, tl } from '../lib/i18n';

export function AnalyticsItem({ firstRun = false }: { firstRun?: boolean }) {
  const [on, setOn] = useState(analyticsEnabled);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    const update = () => { setOn(analyticsEnabled()); setSaveFailed(false); };
    window.addEventListener(USAGE_ANALYTICS_CHANGE, update);
    return () => window.removeEventListener(USAGE_ANALYTICS_CHANGE, update);
  }, []);

  const blocked = usageAnalyticsBlockReason();
  if (firstRun && blocked) return null;
  const title = tl('使用统计');
  const summary = lang === 'en'
    ? 'Optionally share feature usage and a random ID with Mixpanel (US).'
    : '可选。向 Mixpanel（美国）分享功能使用情况和随机标识。';
  const tip = summary + (lang === 'en'
    ? ' Turning it off clears the local ID and pending events.'
    : ' 关闭后清除本机统计标识和待发记录。');
  let state = on ? (lang === 'en' ? 'On' : '已开启') : (lang === 'en' ? 'Off' : '已关闭');
  if (blocked === 'privacy') state = lang === 'en' ? 'Paused by browser privacy settings' : '浏览器隐私设置已暂停统计';
  else if (blocked === 'environment') state = lang === 'en' ? 'Unavailable in this build' : '当前构建未启用统计';
  else if (saveFailed) state = lang === 'en' ? 'Could not save your choice' : '无法保存你的选择';

  const row = (
    <SettingItem
      title={title}
      tip={firstRun ? undefined : tip}
      status={<>{firstRun && <>{summary}<br /></>}{state} · <a href="https://github.com/tumars/tibi/blob/main/PRIVACY.md" target="_blank" rel="noopener noreferrer" onClick={e => void openExternalLink(e)}>{lang === 'en' ? 'Privacy policy' : '隐私说明'}</a></>}
      control={<Switch checked={on} disabled={!!blocked} onChange={value => { if (!setUsageAnalytics(value)) setSaveFailed(true); }} label={title} />}
    />
  );
  return firstRun ? <div className="group card menu">{row}</div> : row;
}
