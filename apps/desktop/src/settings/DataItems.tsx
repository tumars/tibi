import type { UsageSummary } from '@tibi/core';
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../components/Modal';
import { Switch } from '../components/Switch';
import { errorInfo, isTauri, rpc, type Result } from '../rpc';
import { toast } from '../store/ui';
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
    <div className="item">
      <div><div className="t">{tl('自动备份')}</div><div className="d">{tl('每天一次，保留最近 7 份；手动和恢复前的备份不会自动删。{v0}', { v0: last ? tl('上次：{v0}', { v0: fmtTime(last.created_at) }) : tl('还没有备份') })}</div></div>
      <div className="ctl">
        <Switch label={tl('自动备份')} checked={data?.auto ?? true} onChange={async v => { setData(d => d && { ...d, auto: v }); await rpc.call('settings.set', { patch: { 'backup.auto': v } }).catch(() => undefined); }} />
        <button className="btn sm" disabled={busy || data?.dir_supported === false} onClick={now}>{busy ? tl('正在备份…') : tl('立即备份')}</button>
      </div>
    </div>
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

export function ExportSummaryItem() {
  const [sum, setSum] = useState<UsageSummary>();
  const text = sum ? JSON.stringify(sum, null, 2) : '';
  const open = async () => { try { setSum(await rpc.call('stats.export_summary', {})); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast(tl('已复制')); } catch { toast(tl('复制失败，可以手动选中文字'), { kind: 'err' }); } };
  const save = async () => {
    if (!isTauri()) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = 'tibi-summary.json'; a.click(); return; }
    try { const r = await invoke<{ saved: boolean; path?: string }>('save_text_file', { defaultName: 'tibi-summary.json', text }); if (r.saved) toast(tl('已保存')); } catch (e) { toast(String(e), { kind: 'err' }); }
  };
  return <>
    <div className="item">
      <div><div className="t">{tl('导出学习汇总')}</div><div className="d">{tl('只有计数（导入了几篇、复习了几次等），不含单词和正文。先给你看全部内容，你决定要不要发给作者；Tibi 不会自己上传。')}</div></div>
      <div className="ctl"><button className="btn sm" onClick={open}>{tl('查看并导出')}</button></div>
    </div>
    <Modal open={!!sum} onOpenChange={o => { if (!o) setSum(undefined); }} title={tl('学习汇总（脱敏）')}
      actions={<><button className="btn" onClick={() => setSum(undefined)}>{tl('关闭')}</button><button className="btn" onClick={copy}>{tl('复制')}</button><button className="btn pri" onClick={save}>{tl('另存为…')}</button></>}>
      <pre className="sumjson">{text}</pre>
    </Modal>
  </>;
}
