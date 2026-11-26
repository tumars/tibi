import type { UsageSummary } from '@tibi/core';
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../components/Modal';
import { Switch } from '../components/Switch';
import { SettingItem } from '../components/ui';
import { errorInfo, isTauri, rpc, type Result } from '../rpc';
import { toast } from '../store/ui';
import { copyToClipboard } from '../lib/external';
import { saveText } from '../lib/files';
import { locale, tl } from '../lib/i18n';

/**
 * 设置 → 数据：自动备份与恢复、导出学习汇总（00 §3.7；M1 成功标准 §6：只有计数，用户看过后自己发给作者，不上报）。
 */
const REASON: Record<string, string> = { auto: tl('自动'), manual: tl('手动'), before_reset: tl('重置前'), before_restore: tl('恢复前'), before_update: tl('更新前') };
const fmtTime = (t: number) => new Date(t).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtSize = (n: number) => n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export function BackupItems() {
  const [data, setData] = useState<Result<'system.backups'>>();
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<{ path: string; created_at: number }>();
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(() => { rpc.call('system.backups', {}).then(setData, () => undefined); }, []);
  useEffect(load, [load]);

  const now = async () => {
    setBusy(true);
    try { const r = await rpc.call('system.backup', {}); toast(tl('已备份 · {v0}', { v0: fmtSize(r.size) })); load(); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
    setBusy(false);
  };
  const doRestore = async () => {
    const r = restore; setRestore(undefined); if (!r) return;
    if (!isTauri()) { toast(tl('浏览器模式不能恢复：要先停下 Core 再换文件')); return; }
    try { await invoke('restore_backup', { path: r.path }); toast(tl('已恢复。恢复前的数据也备份了一份')); setTimeout(() => location.reload(), 600); }
    catch (e) { toast(String(e), { kind: 'err' }); }
  };
  const items = data?.items ?? [];
  const last = items.find(i => i.reason === 'auto') ?? items[0];
  const shown = showAll ? items : items.slice(0, 3);

  return <>
    <SettingItem
      title={tl('自动备份')}
      tip={tl('每日自动备份一次并保留最近 7 份；手动及恢复前备份不会自动清理。')}
      status={last ? tl('上次备份：{v0}', { v0: fmtTime(last.created_at) }) : tl('暂无备份')}
      control={<>
        <Switch label={tl('自动备份')} checked={data?.auto ?? true} onChange={async v => { setData(d => d && { ...d, auto: v }); await rpc.call('settings.set', { patch: { 'backup.auto': v } }).catch(() => undefined); }} />
        <button className="btn sm" disabled={busy || data?.dir_supported === false} onClick={now}>{busy ? tl('正在备份…') : tl('立即备份')}</button>
      </>}
    />
    {items.length > 0 && <div className="item col">
      <div className="t">{tl('备份')}</div>
      <div className="bklist">
        {shown.map(b => <div key={b.path} className="bk">
          <span>{fmtTime(b.created_at)}</span><span className="tagc">{REASON[b.reason] ?? b.reason}</span><span className="lbl">{fmtSize(b.size)}</span><span className="sp" />
          <button className="linkbtn" onClick={async () => { if (!isTauri()) return toast(tl('浏览器模式不能打开')); await invoke('open_path', { path: b.path }).catch(e => toast(String(e), { kind: 'err' })); }}>{tl('在文件夹中显示')}</button>
          <button className="linkbtn" onClick={() => setRestore(b)}>{tl('恢复')}</button>
        </div>)}
        {items.length > 3 && <button className="linkbtn" onClick={() => setShowAll(!showAll)}>{showAll ? tl('收起') : tl('全部 {length} 份', { length: items.length })}</button>}
      </div>
    </div>}
    <Modal open={!!restore} onOpenChange={o => { if (!o) setRestore(undefined); }} title={tl('从这份备份恢复？')}
      actions={<><button className="btn" onClick={() => setRestore(undefined)}>{tl('取消')}</button><button className="btn pri" onClick={doRestore}>{tl('恢复')}</button></>}>
      <p>{tl('回到 {time} 的状态，之后的阅读、生词和复习记录会被替换。恢复前会先把现在的数据再备份一份，可以随时换回来。', { time: restore ? fmtTime(restore.created_at) : '' })}</p>
    </Modal>
  </>;
}

export function MediaCacheItem() {
  const [info, setInfo] = useState<Result<'system.mediaCache'>>();
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { rpc.call('system.mediaCache', {}).then(setInfo, () => undefined); }, []);
  useEffect(load, [load]);

  const clear = async () => {
    setBusy(true);
    try {
      const r = await rpc.call('system.clearMediaCache', {});
      toast(r.freed_bytes > 0 ? tl('已清理电台音频缓存 · {v0}', { v0: fmtSize(r.freed_bytes) }) : tl('电台音频缓存已经是空的'));
      load();
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
    setBusy(false);
  };

  if (info && !info.supported) return null;
  const used = info ? (info.bytes > 0 ? `${fmtSize(info.bytes)}（${tl('{n} 个文件', { n: info.files })}）` : tl('0 MB')) : '—';

  return (
    <SettingItem
      title={tl('电台音频缓存')}
      tip={tl('单集音频自动缓存在本机（上限 2 GB）；清理仅删除音频文件，不影响逐字稿、生词与学习记录。')}
      status={tl('当前占用：{used}', { used })}
      control={<button className="btn sm danger" disabled={busy || !info || info.bytes === 0} onClick={() => void clear()}>{busy ? tl('清理中…') : tl('清理缓存')}</button>}
    />
  );
}

export function ExportSummaryItem() {
  const [sum, setSum] = useState<UsageSummary>();
  const text = sum ? JSON.stringify(sum, null, 2) : '';
  const open = async () => { try { setSum(await rpc.call('stats.export_summary', {})); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };
  const copy = () => void copyToClipboard(text, { errorMsg: tl('复制失败，可以手动选中文字') });
  const save = async () => {
    try {
      const saved = await saveText('tibi-summary.json', text, 'application/json');
      if (saved && isTauri()) toast(tl('已保存'));
    } catch (e) { toast(String(e), { kind: 'err' }); }
  };
  return <>
    <SettingItem
      title={tl('导出学习汇总')}
      tip={tl('仅含脱敏统计计数，不含文章正文与生词；预览确认后由您自行保存，不自动上传。')}
      control={<button className="btn sm" onClick={open}>{tl('查看并导出')}</button>}
    />
    <Modal open={!!sum} onOpenChange={o => { if (!o) setSum(undefined); }} title={tl('学习汇总（脱敏）')}
      actions={<><button className="btn" onClick={() => setSum(undefined)}>{tl('关闭')}</button><button className="btn" onClick={copy}>{tl('复制')}</button><button className="btn pri" onClick={save}>{tl('另存为…')}</button></>}>
      <pre className="sumjson">{text}</pre>
    </Modal>
  </>;
}
