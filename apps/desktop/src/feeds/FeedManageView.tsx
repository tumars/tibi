import type { FeedKind, FeedView } from '@tibi/core';
import { Download, Plus, Upload } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Empty } from '../components/Empty';
import { Top } from '../components/Shell';
import { Switch } from '../components/Switch';
import { SettingItem } from '../components/ui';
import { tl } from '../lib/i18n';
import { fmtAgo } from '../lib/util';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';
import { pickOpmlXml, runExportOpml, runImportOpml } from './opmlActions';

export interface FeedManageViewProps {
  kind: FeedKind;
  crumbLabel: string;
  crumbTo: string;
  addLabel: string;
  autoTitle: string;
  autoTip: string;
  emptyTitle: string;
  deletedToast: (title: string) => string;
  renderArt?: (f: FeedView) => ReactNode;
  renderAddModal: (opts: { feeds: FeedView[]; onClose: () => void; onAdded: () => void }) => ReactNode;
}

/** 单条订阅源行：用受控状态同步 props，避免撤销或同步更新后输入框仍停留在旧的 defaultValue */
function FeedRow({
  f,
  renderArt,
  onUpdate,
  onRemove,
}: {
  f: FeedView;
  renderArt?: (f: FeedView) => ReactNode;
  onUpdate: (p: { id: string; title?: string; folder?: string; enabled?: boolean }) => Promise<void>;
  onRemove: (f: FeedView) => Promise<void>;
}) {
  const [title, setTitle] = useState(f.title);
  const [folder, setFolder] = useState(f.folder ?? '');
  useEffect(() => { setTitle(f.title); }, [f.title]);
  useEffect(() => { setFolder(f.folder ?? ''); }, [f.folder]);

  return (
    <div className={`feedrow${f.enabled ? '' : ' off'}`}>
      <Switch label={f.title} checked={f.enabled} onChange={v => void onUpdate({ id: f.id, enabled: v })} />
      {renderArt?.(f)}
      <div className="fmain">
        <input
          className="input ftitle"
          value={title}
          aria-label={tl('名字')}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => {
            const v = title.trim();
            if (!v) setTitle(f.title);
            else if (v !== f.title) void onUpdate({ id: f.id, title: v });
          }}
        />
        <span className="lbl fu">{f.url}</span>
        <span className={`lbl${f.error ? ' bad' : ''}`}>
          {f.error
            ? tl('上次刷新失败：{error}', { error: f.error })
            : f.last_ok_at
              ? tl('{ago}刷新过', { ago: fmtAgo(f.last_ok_at) })
              : tl('尚未刷新')}
        </span>
      </div>
      <input
        className="input ffolder"
        value={folder}
        placeholder={tl('分组')}
        aria-label={tl('分组')}
        onChange={e => setFolder(e.target.value)}
        onBlur={() => {
          if (folder.trim() !== (f.folder ?? '')) void onUpdate({ id: f.id, folder });
        }}
      />
      <button className="linkbtn danger" onClick={() => void onRemove(f)}>{tl('删除')}</button>
    </div>
  );
}

/** 订阅管理与电台管理共用的管理页 */
export function FeedManageView({
  kind,
  crumbLabel,
  crumbTo,
  addLabel,
  autoTitle,
  autoTip,
  emptyTitle,
  deletedToast,
  renderArt,
  renderAddModal,
}: FeedManageViewProps) {
  const [feeds, setFeeds] = useState<FeedView[]>();
  const [auto, setAuto] = useState<boolean>();
  const [adding, setAdding] = useState(false);
  const [opmlBusy, setOpmlBusy] = useState(false);

  const load = useCallback(() => rpc.call('feeds.list', { kind }).then(setFeeds, () => setFeeds([])), [kind]);
  useEffect(() => {
    void load();
    rpc.call('feeds.status', {}).then(s => setAuto(s.auto_refresh), () => undefined);
    return rpc.on('data.changed', d => { if (d.table === 'feeds') void load(); });
  }, [load]);

  const update = async (p: { id: string; title?: string; folder?: string; enabled?: boolean }) => {
    try {
      const f = await rpc.call('feeds.update', p);
      setFeeds(cur => cur?.map(x => (x.id === f.id ? f : x)));
    } catch (e) {
      toast(errorInfo(e).message, { kind: 'err' });
    }
  };

  const remove = async (f: FeedView) => {
    try {
      const r = await rpc.call('feeds.remove', { id: f.id });
      await load();
      toast(deletedToast(f.title), {
        action: {
          label: tl('撤销'),
          run: () => void rpc.call('system.undo', { undo_id: r.undo.undo_id }).then(
            () => load(),
            e => toast(errorInfo(e).message, { kind: 'err' }),
          ),
        },
      });
    } catch (e) {
      toast(errorInfo(e).message, { kind: 'err' });
    }
  };

  const setAutoRefresh = async (v: boolean) => {
    try {
      setAuto((await rpc.call('feeds.configure', { auto_refresh: v })).auto_refresh);
    } catch (e) {
      toast(errorInfo(e).message, { kind: 'err' });
    }
  };

  const importOpml = async () => {
    const xml = await pickOpmlXml();
    if (!xml) return;
    setOpmlBusy(true);
    try {
      const ok = await runImportOpml(xml, kind);
      if (ok) await load();
    } finally {
      setOpmlBusy(false);
    }
  };

  return (
    <>
      <Top
        crumbs={[{ label: crumbLabel, to: crumbTo }, { label: tl('管理') }]}
        right={<div className="feedtop">
          <button className="btn sm" disabled={opmlBusy} onClick={() => void importOpml()}><Upload size={14} />{tl('导入 OPML')}</button>
          <button className="btn sm" disabled={!feeds?.length} onClick={() => void runExportOpml(kind)}><Download size={14} />{tl('导出 OPML')}</button>
          <button className="btn sm pri" onClick={() => setAdding(true)}><Plus />{addLabel}</button>
        </div>}
      />
      <div className="scroll">
        <div className="page feedmanage">
          {auto !== undefined && (
            <div className="group">
              <SettingItem
                title={autoTitle}
                tip={autoTip}
                control={<Switch label={autoTitle} checked={auto} onChange={v => void setAutoRefresh(v)} />}
              />
            </div>
          )}
          {feeds?.length === 0 && (
            <Empty
              image="empty-library"
              title={emptyTitle}
              action={<button className="btn pri" onClick={() => setAdding(true)}>{addLabel}</button>}
            />
          )}
          <div className="feedrows">
            {feeds?.map(f => (
              <FeedRow key={f.id} f={f} renderArt={renderArt} onUpdate={update} onRemove={remove} />
            ))}
          </div>
        </div>
      </div>
      {adding && renderAddModal({
        feeds: feeds ?? [],
        onClose: () => setAdding(false),
        onAdded: () => { setAdding(false); void load(); },
      })}
    </>
  );
}
