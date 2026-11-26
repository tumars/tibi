import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, ArrowUpCircle, CheckCircle2, Download, Loader2, RotateCw, Sparkles, X } from 'lucide-react';
import { Alert } from './ui';
import { tl } from '../lib/i18n';
import { Markdown } from '../lib/md';
import { DOWNLOAD_PAGE_URL, formatBytes, isAppStore } from '../lib/update';
import { isTauri } from '../rpc';
import { openLink } from '../settings/AuthorItems';
import { useUpdate } from '../store/update';

const ACTIVE_PHASES = new Set(['available', 'downloading', 'ready', 'backing_up', 'installing', 'backup_failed', 'error']);

export function useHasUpdateIndicator(): boolean {
  return useUpdate(s => !isAppStore && isTauri() && ACTIVE_PHASES.has(s.phase));
}

/** 左侧栏底部常驻更新胶囊（参考 Codex / Cursor 的 Sidebar Pill，展开态为紧凑胶囊，折叠态为带圆点图标） */
export function UpdatePill() {
  const phase = useUpdate(s => s.phase);
  const version = useUpdate(s => s.version);
  const progress = useUpdate(s => s.progress);
  const pillDismissedFor = useUpdate(s => s.pillDismissedFor);
  const openModal = useUpdate(s => s.openModal);

  if (isAppStore || !isTauri()) return null;
  if (!ACTIVE_PHASES.has(phase)) return null;
  // 进行中（下载 / 备份 / 安装）始终保留进度入口；其余状态若本轮已点「稍后提醒」则收起胶囊（设置图标仍保留圆点）
  const isWorking = phase === 'downloading' || phase === 'backing_up' || phase === 'installing';
  if (!isWorking && version && pillDismissedFor === version) return null;

  const pct = progress.ratio !== undefined ? Math.round(progress.ratio * 100) : undefined;
  const tone =
    phase === 'ready' ? 'ready'
    : phase === 'downloading' || phase === 'backing_up' || phase === 'installing' ? 'busy'
    : phase === 'backup_failed' || phase === 'error' ? 'warn'
    : 'avail';

  const label =
    phase === 'ready' ? tl('重启以更新 {v0}', { v0: version })
    : phase === 'downloading' ? (pct !== undefined ? tl('下载更新 {v0}%', { v0: pct }) : tl('正在下载更新…'))
    : phase === 'backing_up' ? tl('正在备份数据…')
    : phase === 'installing' ? tl('正在安装更新…')
    : phase === 'backup_failed' ? tl('更新备份失败')
    : phase === 'error' ? tl('更新失败')
    : tl('发现新版本 {v0}', { v0: version });

  const actionHint =
    phase === 'ready' ? tl('重启')
    : phase === 'available' ? tl('查看')
    : phase === 'backup_failed' || phase === 'error' ? tl('处理')
    : undefined;

  const Icon =
    phase === 'ready' ? RotateCw
    : phase === 'downloading' ? Download
    : phase === 'backing_up' || phase === 'installing' ? Loader2
    : phase === 'backup_failed' || phase === 'error' ? AlertTriangle
    : ArrowUpCircle;

  return (
    <button
      type="button"
      className={`upd-pill ${tone}`}
      onClick={openModal}
      title={label}
      aria-label={label}
    >
      <span className="upd-pill-ic">
        <Icon size={15} className={phase === 'backing_up' || phase === 'installing' ? 'ttsspin' : undefined} />
        <i className="upd-pill-dot" aria-hidden="true" />
      </span>
      <span className="upd-pill-txt hide-c">{label}</span>
      {actionHint && <span className="upd-pill-act hide-c">{actionHint}</span>}
      {phase === 'downloading' && (
        <span className="upd-pill-bar hide-c" aria-hidden="true">
          <i style={{ width: `${pct ?? 18}%` }} className={pct === undefined ? 'indet' : undefined} />
        </span>
      )}
    </button>
  );
}

/** 全局更新详情弹窗 + 升级后首次启动的「更新内容」弹窗 */
export function UpdateModal() {
  const s = useUpdate();

  const manualLink = (url: string, label: string, primary = false) => (
    <a className={`btn sm${primary ? ' pri' : ''}`} href={url} target="_blank" rel="noopener noreferrer" onClick={e => void openLink(e)}>
      {label}
    </a>
  );

  // 刚完成升级重启进入新版本，用户点了「查看更新内容」
  if (s.whatsNew) {
    return (
      <Dialog.Root open onOpenChange={o => { if (!o) s.closeWhatsNew(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-ov" />
          <Dialog.Content className="modal upd-modal" aria-describedby={undefined}>
            <div className="upd-head">
              <span className="upd-ic ok"><Sparkles size={18} /></span>
              <div className="upd-head-t">
                <Dialog.Title asChild><h3>{tl('已更新到 Tibi {v0}', { v0: s.whatsNew.version })}</h3></Dialog.Title>
              </div>
              <button type="button" className="ibtn" aria-label={tl('关闭')} onClick={s.closeWhatsNew}><X size={15} /></button>
            </div>
            {s.whatsNew.notes && (
              <div className="upd-notes"><Markdown text={s.whatsNew.notes} /></div>
            )}
            <div className="acts">
              <button type="button" className="btn pri sm" onClick={s.closeWhatsNew}>{tl('知道了')}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (!s.modalOpen) return null;

  const pct = s.progress.ratio !== undefined ? Math.round(s.progress.ratio * 100) : undefined;
  const busy = s.phase === 'checking' || s.phase === 'backing_up' || s.phase === 'installing';
  const isWin = s.platform === 'windows';

  const title =
    s.phase === 'checking' ? tl('正在检查更新…')
    : s.phase === 'latest' ? tl('已是最新版本')
    : s.phase === 'ready' ? tl('Tibi {v0} 已准备就绪', { v0: s.version })
    : s.phase === 'downloading' ? tl('正在下载 Tibi {v0}', { v0: s.version })
    : s.phase === 'backing_up' ? tl('正在备份数据…')
    : s.phase === 'installing' ? tl('正在安装 Tibi {v0}…', { v0: s.version })
    : s.phase === 'backup_failed' ? tl('更新前备份失败')
    : s.phase === 'error' ? tl('更新遇到问题')
    : s.version ? tl('发现新版本 Tibi {v0}', { v0: s.version })
    : tl('检查更新');

  const headTone =
    s.phase === 'ready' || s.phase === 'latest' ? 'ok'
    : s.phase === 'backup_failed' || s.phase === 'error' ? 'warn'
    : 'accent';

  const HeadIcon =
    s.phase === 'checking' || s.phase === 'backing_up' || s.phase === 'installing' ? Loader2
    : s.phase === 'latest' ? CheckCircle2
    : s.phase === 'ready' ? RotateCw
    : s.phase === 'downloading' ? Download
    : s.phase === 'backup_failed' || s.phase === 'error' ? AlertTriangle
    : ArrowUpCircle;

  const issueText =
    s.installIssue === 'mounted_volume'
      ? tl('当前 Tibi 正直接从磁盘镜像（DMG）中运行，无法原位替换更新。请先将 Tibi 拖入「应用程序」文件夹，或手动下载最新安装包。')
      : s.installIssue === 'translocated'
      ? tl('当前 Tibi 运行在系统临时安全目录（如「下载」文件夹），无法原位替换更新。请先移入「应用程序」文件夹，或手动下载最新安装包。')
      : undefined;

  const progressText = (() => {
    if (s.phase === 'backing_up') return tl('正在备份当前数据，完成后自动安装…');
    if (s.phase === 'installing') return isWin ? tl('正在启动安装程序，Tibi 即将退出并完成更新…') : tl('正在安装更新，完成后 Tibi 将自动重启…');
    if (s.phase === 'downloading') {
      if (s.progress.got !== undefined && s.progress.total) {
        return tl('已下载 {v0} / {v1}（{v2}%）', { v0: formatBytes(s.progress.got), v1: formatBytes(s.progress.total), v2: pct ?? 0 });
      }
      if (s.progress.got !== undefined && s.progress.got > 0) {
        return tl('已下载 {v0}…', { v0: formatBytes(s.progress.got) });
      }
      return tl('正在连接分发源并下载更新包…');
    }
    return undefined;
  })();

  return (
    <Dialog.Root open={s.modalOpen} onOpenChange={o => { if (!o && s.phase !== 'backing_up' && s.phase !== 'installing') s.closeModal(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-ov" />
        <Dialog.Content className="modal upd-modal" aria-describedby={undefined}>
          <div className="upd-head">
            <span className={`upd-ic ${headTone}`}>
              <HeadIcon size={18} className={busy ? 'ttsspin' : undefined} />
            </span>
            <div className="upd-head-t">
              <Dialog.Title asChild><h3>{title}</h3></Dialog.Title>
              {(s.currentVersion || s.version || s.date) && (
                <div className="upd-meta">
                  {s.currentVersion && s.version ? <span>{s.currentVersion} → {s.version}</span>
                    : s.currentVersion ? <span>{tl('当前版本 {v0}', { v0: s.currentVersion })}</span> : null}
                  {s.date && <span>· {s.date}</span>}
                </div>
              )}
            </div>
            {s.phase !== 'backing_up' && s.phase !== 'installing' && (
              <button type="button" className="ibtn" aria-label={tl('关闭')} onClick={s.closeModal}><X size={15} /></button>
            )}
          </div>

          {s.phase === 'latest' && (
            <p className="upd-desc">{tl('你使用的已是最新版本，无需更新。')}</p>
          )}

          {issueText && (
            <Alert tone="warning" compact>{issueText}</Alert>
          )}

          {s.phase === 'backup_failed' && (
            <Alert tone="warning" compact title={tl('未能完成更新前备份')}>
              {tl('{v0}。安装包已保留在本地，可取消或跳过本次备份继续更新。', { v0: s.error ?? '' })}
            </Alert>
          )}

          {s.phase === 'error' && (
            <Alert tone="danger" compact>{s.error || tl('更新失败，请稍后重试或手动下载安装包。')}</Alert>
          )}

          {s.notes && s.phase !== 'latest' && (
            <div className="upd-notes"><Markdown text={s.notes} /></div>
          )}

          {progressText && (
            <div className="upd-prog">
              <div className="upd-prog-bar">
                <i
                  style={{ width: `${s.phase === 'downloading' ? (pct ?? 20) : 100}%` }}
                  className={s.phase === 'downloading' && pct === undefined ? 'indet' : s.phase !== 'downloading' ? 'pulse' : undefined}
                />
              </div>
              <div className="upd-prog-txt" aria-live="polite">{progressText}</div>
            </div>
          )}

          {s.phase === 'ready' && !issueText && (
            <p className="upd-hint">
              {isWin
                ? tl('更新包已下载并完成签名验证。重启前会自动备份数据，随后拉起安装程序完成更新。')
                : tl('更新包已下载并完成签名验证。重启前会自动备份数据，几秒即可回到当前状态。')}
            </p>
          )}

          <div className="acts upd-acts">
            <div className="upd-acts-l">
              {(s.phase === 'available' || s.phase === 'ready') && s.version && (
                <button type="button" className="linkbtn" onClick={() => s.skipVersion(s.version!)}>
                  {tl('跳过此版本')}
                </button>
              )}
            </div>
            <div className="upd-acts-r">
              {s.phase === 'checking' && (
                <button type="button" className="btn sm" onClick={s.closeModal}>{tl('关闭')}</button>
              )}
              {s.phase === 'latest' && (
                <button type="button" className="btn pri sm" onClick={s.closeModal}>{tl('好')}</button>
              )}
              {s.phase === 'available' && (
                issueText ? (
                  <>
                    <button type="button" className="btn sm" onClick={s.dismissPill}>{tl('稍后')}</button>
                    {s.installerUrl ? manualLink(s.installerUrl, tl('下载安装包'), true) : manualLink(DOWNLOAD_PAGE_URL, tl('官网下载页'), true)}
                  </>
                ) : (
                  <>
                    <button type="button" className="btn sm" onClick={s.dismissPill}>{tl('稍后提醒')}</button>
                    <button type="button" className="btn pri sm" onClick={() => void s.download({ silent: false })}>{tl('下载更新')}</button>
                  </>
                )
              )}
              {s.phase === 'downloading' && (
                <button type="button" className="btn pri sm" onClick={s.closeModal}>{tl('后台下载')}</button>
              )}
              {s.phase === 'ready' && (
                issueText ? (
                  <>
                    <button type="button" className="btn sm" onClick={s.dismissPill}>{tl('稍后')}</button>
                    {s.installerUrl ? manualLink(s.installerUrl, tl('下载安装包'), true) : manualLink(DOWNLOAD_PAGE_URL, tl('官网下载页'), true)}
                  </>
                ) : (
                  <>
                    <button type="button" className="btn sm" onClick={s.dismissPill}>{tl('稍后重启')}</button>
                    <button type="button" className="btn pri sm" autoFocus onClick={() => void s.apply()}>{tl('备份并重启')}</button>
                  </>
                )
              )}
              {s.phase === 'backup_failed' && (
                <>
                  <button type="button" className="btn sm" onClick={s.cancelBackupFailed}>{tl('取消')}</button>
                  <button type="button" className="btn sm danger" onClick={() => void s.apply({ skipBackup: true })}>{tl('跳过备份并更新')}</button>
                </>
              )}
              {s.phase === 'error' && (
                <>
                  {s.installerUrl && manualLink(s.installerUrl, tl('下载安装包'))}
                  {manualLink(DOWNLOAD_PAGE_URL, tl('官网下载页'))}
                  <button type="button" className="btn pri sm" onClick={() => void (s.version ? s.download({ silent: false }) : s.check({ manual: true }))}>
                    {tl('重试')}
                  </button>
                </>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
