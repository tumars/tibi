import { useState } from 'react';
import { Switch } from '../components/Switch';
import { SettingItem } from '../components/ui';
import { tl } from '../lib/i18n';
import { autoCheckOn, BackupFailed, checkUpdate, installUpdate, installerDownloadUrl, isAppStore, DOWNLOAD_PAGE_URL, setAutoCheck, type InstallStage } from '../lib/update';
import { isTauri } from '../rpc';
import { openLink } from './AuthorItems';

type State = { k: 'idle' } | { k: 'checking' } | { k: 'latest' } | { k: 'found'; version: string } | { k: 'installing'; version: string; stage: InstallStage } | { k: 'backup_failed'; version: string; reason: string } | { k: 'failed'; reason: string; installer?: string };

/** 设置 → 关于：检查、安装更新，自动检查的开关（T31） */
export function UpdateItems() {
  const [s, setS] = useState<State>({ k: 'idle' });
  const [auto, setAuto] = useState(autoCheckOn);

  if (isAppStore) return <SettingItem title="App Store" status={tl('请通过 Mac App Store 更新')} />;

  const check = async () => {
    if (!isTauri()) return setS({ k: 'failed', reason: tl('浏览器模式不能更新') });
    setS({ k: 'checking' });
    try {
      const r = await checkUpdate();
      setS(r.available ? { k: 'found', version: r.version } : { k: 'latest' });
    } catch (e) { await fail(tl('检查更新失败：{v0}', { v0: String(e) })); }
  };
  // 应用内更新走不通时给手动下载入口，安装包按这台电脑的系统和芯片来
  const fail = async (reason: string) => setS({ k: 'failed', reason, installer: await installerDownloadUrl().catch(() => undefined) });
  const install = async (version: string, skipBackup = false) => {
    setS({ k: 'installing', version, stage: { stage: 'downloading' } });
    try { await installUpdate(stage => setS({ k: 'installing', version, stage }), { skipBackup }); }
    catch (e) {
      if (e instanceof BackupFailed) { setS({ k: 'backup_failed', version, reason: e.message }); return; }
      await fail(tl('更新失败：{v0}', { v0: String(e) }));
    }
  };
  const installingDesc = (version: string, st: InstallStage) => st.stage === 'backing_up' ? tl('正在备份数据…')
    : st.stage === 'installing' ? tl('正在安装 {v0}，装完 Tibi 自动重启', { v0: version })
    : st.ratio === undefined ? tl('正在下载 {v0}…', { v0: version }) : tl('正在下载 {v0}（{v1}%）', { v0: version, v1: Math.round(st.ratio * 100) });

  const statusText = s.k === 'checking' ? tl('正在检查…')
    : s.k === 'latest' ? tl('已是最新版本')
    : s.k === 'found' ? tl('发现新版本 {v0}，安装前自动备份并重启', { v0: s.version })
    : s.k === 'installing' ? installingDesc(s.version, s.stage)
    : s.k === 'backup_failed' ? tl('更新前备份失败：{v0}。可取消或跳过本次备份继续更新。', { v0: s.reason })
    : s.k === 'failed' ? tl('{v0}，可手动下载安装包。', { v0: s.reason })
    : undefined;
  const link = (url: string, label: string) => <a className="btn sm" href={url} target="_blank" rel="noopener noreferrer" onClick={e => void openLink(e)}>{label}</a>;

  return <>
    <SettingItem
      title={tl('检查更新')}
      status={statusText ? <span aria-live="polite">{statusText}</span> : undefined}
      control={<>
        {s.k === 'failed' && <>{s.installer && link(s.installer, tl('下载安装包'))}{link(DOWNLOAD_PAGE_URL, tl('官网下载页'))}</>}
        {s.k === 'backup_failed'
          ? <><button className="btn sm" onClick={() => setS({ k: 'found', version: s.version })}>{tl('取消')}</button><button className="btn sm danger" onClick={() => void install(s.version, true)}>{tl('跳过备份并更新')}</button></>
          : s.k === 'found'
          ? <button className="btn sm pri" onClick={() => void install(s.version)}>{tl('安装并重启')}</button>
          : <button className="btn sm" disabled={s.k === 'checking' || s.k === 'installing'} onClick={() => void check()}>{tl('检查更新')}</button>}
      </>}
    />
    <SettingItem
      title={tl('自动检查更新')}
      tip={tl('每日检查一次新版本与公告，发现更新时仅提醒，不会自动安装。')}
      control={<Switch label={tl('自动检查更新')} checked={auto} onChange={v => { setAuto(v); setAutoCheck(v); }} />}
    />
  </>;
}
