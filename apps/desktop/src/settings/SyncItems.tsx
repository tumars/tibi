import { useCallback, useEffect, useState } from 'react';
import { Badge, SettingItem } from '../components/ui';
import { tl } from '../lib/i18n';
import { storeSecret } from '../lib/providers';
import { isAppStore } from '../lib/update';
import { fmtAgo } from '../lib/util';
import { errorInfo, isTauri, isWeb, rpc } from '../rpc';
import type { SyncBackendCfg, SyncStatus } from '../rpc/methods';
import { toast } from '../store/ui';

/**
 * 设置 → 数据 → 同步（08 §10）：关闭 → 选位置并检查 → 新建或加入资料库 → 已开启（状态、立即同步、设备、停止）。
 * 后端：iCloud Drive（Mac，需要签名版本）、文件夹（Dropbox、OneDrive、NAS 等任意本地文件夹）、WebDAV（坚果云、Nextcloud、群晖）。
 */
type Kind = SyncBackendCfg['kind'];
const KIND_LABEL: Record<Kind, string> = { icloud: 'iCloud Drive', folder: tl('文件夹'), webdav: 'WebDAV' };
const PW_REF = 'sync.webdav';
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const PLATFORM: Record<string, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux', ios: 'iPhone', android: 'Android', web: tl('网页版'), test: 'test' };
// Web 版和 App Store 版只有 WebDAV（12 §2、13）
const KINDS: Kind[] = isWeb() || isAppStore ? ['webdav'] : (['icloud', 'folder', 'webdav'] as Kind[]).filter(k => k !== 'icloud' || isMac);

export function SyncItems() {
  const [st, setSt] = useState<SyncStatus>();
  const [setup, setSetup] = useState(false);
  const [kind, setKind] = useState<Kind>(KINDS[0]!);
  const [path, setPath] = useState('');
  const [dav, setDav] = useState({ url: '', user: '', pw: '' });
  const [probe, setProbe] = useState<{ text: string; ready: boolean; join: boolean }>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { rpc.call('sync.status', {}).then(setSt, () => undefined); }, []);
  useEffect(() => { load(); return rpc.on('sync.update', () => load()); }, [load]);
  useEffect(() => { setProbe(undefined); }, [kind, path, dav.url, dav.user, dav.pw]);

  const cfg = (): SyncBackendCfg | undefined => {
    if (kind === 'icloud') return { kind };
    if (kind === 'folder') return path.trim() ? { kind, path: path.trim() } : undefined;
    return dav.url.trim() && dav.user.trim() ? { kind, url: dav.url.trim(), user: dav.user.trim(), password_ref: PW_REF } : undefined;
  };
  const pickFolder = async () => {
    if (!isTauri()) { toast(tl('浏览器开发模式不能选文件夹，直接填路径')); return; }
    const { invoke } = await import('@tauri-apps/api/core');
    const r = await invoke<{ path?: string }>('pick_folder'); if (r.path) setPath(r.path);
  };
  const check = async () => {
    const c = cfg(); if (!c) { toast(kind === 'webdav' ? tl('填好地址、账号和应用密码') : tl('先选一个文件夹')); return; }
    if (c.kind === 'webdav' && dav.pw) {
      const ok = await storeSecret(PW_REF, dav.pw).catch(() => false);
      if (!ok && (isTauri() || isWeb())) { toast(tl('应用密码没能保存'), { kind: 'err' }); return; }
    }
    setBusy(true); setProbe({ text: tl('正在检查…'), ready: false, join: false });
    try {
      const r = await rpc.call('sync.probe', { backend: c });
      if (!r.ok) setProbe({ text: r.error?.message ?? tl('连不上'), ready: false, join: false });
      else if (r.library) setProbe({ text: tl('找到已有的 Tibi 资料库：{n} 台设备 · {ago}更新。加入后两边的数据会合并，不会覆盖。', { n: r.library.devices, ago: fmtAgo(r.library.updated_at) }), ready: true, join: true });
      else setProbe({ text: tl('这里还没有 Tibi 资料库。开启后会新建一个，这台电脑上的数据作为第一批放进去。'), ready: true, join: false });
    } catch (e) { setProbe({ text: errorInfo(e).message, ready: false, join: false }); }
    finally { setBusy(false); }
  };
  const enable = async () => {
    const c = cfg(); if (!c) return;
    setBusy(true);
    try { setSt(await rpc.call('sync.enable', { backend: c })); setSetup(false); toast(tl('同步已开启')); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
    finally { setBusy(false); }
  };
  const now = async () => { try { setSt(await rpc.call('sync.now', {})); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };
  const stop = async () => { try { await rpc.call('sync.disable', {}); load(); toast(tl('已停止同步。这台电脑上的数据保留，云盘里的文件不删')); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };
  const remove = async (id: string) => { try { setSt(await rpc.call('sync.removeDevice', { device_id: id })); toast(tl('已移除。它再上线时会按新设备重新同步')); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };

  if (!st) return null;
  if (st.enabled) {
    const stateLine = st.state === 'syncing' ? <><i className="sdot run" />{tl('正在同步…')}</>
      : st.state === 'error' ? <><i className="sdot err" />{st.error?.message ?? tl('同步失败')}</>
      : <><i className="sdot" />{st.last_synced_at ? tl('已同步 · {ago}', { ago: fmtAgo(st.last_synced_at) }) : tl('还没有同步过')}{st.pending ? tl(' · {n} 条改动待推送', { n: st.pending }) : ''}</>;
    return <>
      <SettingItem
        title={tl('同步')}
        badge={st.backend && <Badge tone="accent">{KIND_LABEL[st.backend.kind]}</Badge>}
        status={stateLine}
        control={<button className="btn sm" disabled={st.state === 'syncing'} onClick={() => void now()}>{st.state === 'error' ? tl('重试') : tl('立即同步')}</button>}
      />
      <SettingItem title={tl('设备')}>
        <div className="sdev">
          <div><b style={{ fontWeight: 500 }}>{st.device?.name || tl('这台电脑')}</b><span>{tl('本机')}</span></div>
          {st.peers.filter(p => !p.removed).map(p => <div key={p.id}><b style={{ fontWeight: 500 }}>{p.name}</b><span>{PLATFORM[p.platform] ?? p.platform}{p.last_seen_at ? ` · ${fmtAgo(p.last_seen_at)}` : ''}</span><button className="linkbtn danger" onClick={() => void remove(p.id)}>{tl('移除')}</button></div>)}
        </div>
      </SettingItem>
      <SettingItem
        title={tl('停止同步')}
        tip={tl('停止后保留本机数据，云端同步文件不会删除。')}
        control={<button className="btn sm danger" onClick={() => void stop()}>{tl('停止')}</button>}
      />
    </>;
  }
  if (!setup) return (
    <SettingItem
      title={tl('同步')}
      tip={isWeb() ? tl('通过个人 WebDAV 云盘与桌面端、移动端同步；网页版经中转连接，中转不留存任何内容。') : isAppStore ? tl('通过个人 WebDAV 云盘同步，不经过第三方服务器。') : tl('通过个人 iCloud Drive、WebDAV 云盘或共享文件夹跨设备同步，不经过第三方服务器。')}
      status={tl('未开启')}
      control={<button className="btn sm pri" onClick={() => setSetup(true)}>{tl('开启同步')}</button>}
    />
  );
  return <>
    <SettingItem
      title={tl('同步')}
      tip={tl('同步文件明文保存在所选存储位置。')}
      control={<div className="seg">{KINDS.map(k => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}</div>}
    />
    {kind === 'icloud' && <div className="item"><div><div className="d">{tl('使用 iCloud Drive 专属目录与 iOS 端同步，需开启系统 iCloud Drive。')}</div></div><div className="ctl" /></div>}
    {kind === 'folder' && <div className="pform"><span>{tl('文件夹')}</span><div style={{ display: 'flex', gap: 8 }}><input className="input" style={{ flex: 1 }} value={path} onChange={e => setPath(e.target.value)} placeholder={tl('例如 Dropbox 或 OneDrive 中的共享文件夹')} /><button className="btn sm" onClick={() => void pickFolder()}>{tl('选择…')}</button></div></div>}
    {kind === 'webdav' && <div className="pform">
      <span>{tl('地址')}</span><input className="input" value={dav.url} onChange={e => setDav({ ...dav, url: e.target.value })} placeholder="https://dav.jianguoyun.com/dav/Tibi" />
      <span>{tl('账号')}</span><input className="input" value={dav.user} onChange={e => setDav({ ...dav, user: e.target.value })} placeholder={tl('邮箱或用户名')} />
      <span>{tl('应用密码')}</span><input className="input" type="password" value={dav.pw} onChange={e => setDav({ ...dav, pw: e.target.value })} placeholder={tl('在云盘安全设置中生成')} />
    </div>}
    <div className="item"><div><div className="d">{probe?.text ?? tl('请先检查目标位置是否已有资料库。')}</div></div>
      <div className="ctl"><button className="btn sm" onClick={() => { setSetup(false); setProbe(undefined); }}>{tl('取消')}</button>
        {probe?.ready ? <button className="btn sm pri" disabled={busy} onClick={() => void enable()}>{probe.join ? tl('加入') : tl('新建并开启')}</button>
          : <button className="btn sm pri" disabled={busy} onClick={() => void check()}>{tl('检查')}</button>}</div></div>
  </>;
}
