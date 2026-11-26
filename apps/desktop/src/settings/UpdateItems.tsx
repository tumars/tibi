import { SettingItem } from '../components/ui';
import { tl } from '../lib/i18n';
import { DOWNLOAD_PAGE_URL, isAppStore, type UpdateMode } from '../lib/update';
import { useUpdate } from '../store/update';
import { openLink } from './AuthorItems';

const MODES: [UpdateMode, string][] = [
  ['auto', tl('自动下载')],
  ['notify', tl('仅提醒')],
  ['off', tl('关闭')],
];

/** 设置 → 关于：检查、下载、安装更新，以及自动更新策略（T31，接入全局 useUpdate 状态） */
export function UpdateItems() {
  const s = useUpdate();

  if (isAppStore) return <SettingItem title="App Store" status={tl('请通过 Mac App Store 更新')} />;

  const pct = s.progress.ratio !== undefined ? Math.round(s.progress.ratio * 100) : undefined;
  const statusText =
    s.phase === 'checking' ? tl('正在检查…')
    : s.phase === 'latest' ? tl('已是最新版本')
    : s.phase === 'available' ? tl('发现新版本 {v0}，可后台下载后重启更新', { v0: s.version })
    : s.phase === 'downloading' ? (pct === undefined ? tl('正在后台下载 {v0}…', { v0: s.version }) : tl('正在后台下载 {v0}（{v1}%）', { v0: s.version, v1: pct }))
    : s.phase === 'ready' ? tl('新版本 {v0} 已下载就绪，重启前自动备份数据', { v0: s.version })
    : s.phase === 'backing_up' ? tl('正在备份数据…')
    : s.phase === 'installing' ? tl('正在安装 {v0}，装完 Tibi 自动重启', { v0: s.version })
    : s.phase === 'backup_failed' ? tl('更新前备份失败：{v0}。可取消或跳过本次备份继续更新。', { v0: s.error })
    : s.phase === 'error' ? tl('{v0}，可手动下载安装包。', { v0: s.error })
    : undefined;

  const link = (url: string, label: string) => (
    <a className="btn sm" href={url} target="_blank" rel="noopener noreferrer" onClick={e => void openLink(e)}>{label}</a>
  );

  return <>
    <SettingItem
      title={tl('检查更新')}
      status={statusText ? <span aria-live="polite">{statusText}</span> : undefined}
      control={<>
        {s.phase === 'error' && <>{s.installerUrl && link(s.installerUrl, tl('下载安装包'))}{link(DOWNLOAD_PAGE_URL, tl('官网下载页'))}</>}
        {s.phase === 'backup_failed' ? (
          <>
            <button className="btn sm" onClick={s.cancelBackupFailed}>{tl('取消')}</button>
            <button className="btn sm danger" onClick={() => void s.apply({ skipBackup: true })}>{tl('跳过备份并更新')}</button>
          </>
        ) : s.phase === 'ready' ? (
          <>
            <button className="btn sm" onClick={s.openModal}>{tl('查看详情')}</button>
            {s.installIssue
              ? (s.installerUrl ? link(s.installerUrl, tl('下载安装包')) : link(DOWNLOAD_PAGE_URL, tl('官网下载页')))
              : <button className="btn sm pri" onClick={() => void s.apply()}>{tl('备份并重启')}</button>}
          </>
        ) : s.phase === 'available' ? (
          <>
            <button className="btn sm" onClick={s.openModal}>{tl('查看详情')}</button>
            {s.installIssue
              ? (s.installerUrl ? link(s.installerUrl, tl('下载安装包')) : link(DOWNLOAD_PAGE_URL, tl('官网下载页')))
              : <button className="btn sm pri" onClick={() => void s.download({ silent: false })}>{tl('下载更新')}</button>}
          </>
        ) : s.phase === 'downloading' ? (
          <button className="btn sm" onClick={s.openModal}>{tl('查看进度')}</button>
        ) : (
          <button
            className="btn sm"
            disabled={s.phase === 'checking' || s.phase === 'backing_up' || s.phase === 'installing'}
            onClick={() => void s.check({ manual: true })}
          >
            {s.phase === 'error' ? tl('重试') : tl('检查更新')}
          </button>
        )}
      </>}
    />
    <SettingItem
      title={tl('自动更新')}
      tip={tl('自动下载会在后台检查并下载新版本，完成后提示重启（不会强制自动重启）；仅提醒只通知不自动下载；关闭后不再自动检查更新与公告。')}
      control={
        <div className="seg">
          {MODES.map(([m, label]) => (
            <button key={m} className={s.mode === m ? 'on' : ''} onClick={() => s.setMode(m)}>{label}</button>
          ))}
        </div>
      }
    />
  </>;
}
