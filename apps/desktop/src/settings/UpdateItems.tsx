import { useState } from 'react';
import { Switch } from '../components/Switch';
import { tl } from '../lib/i18n';
import { autoCheckOn, checkUpdate, installUpdate, setAutoCheck } from '../lib/update';
import { isTauri } from '../rpc';
import { toast } from '../store/ui';

type State = { k: 'idle' } | { k: 'checking' } | { k: 'latest' } | { k: 'found'; version: string } | { k: 'installing'; version: string; ratio?: number };

/** 设置 → 关于：检查、安装更新，自动检查的开关（T31） */
export function UpdateItems() {
  const [s, setS] = useState<State>({ k: 'idle' });
  const [auto, setAuto] = useState(autoCheckOn);

  const check = async () => {
    if (!isTauri()) return toast(tl('浏览器模式不能更新'));
    setS({ k: 'checking' });
    try {
      const r = await checkUpdate();
      setS(r.available ? { k: 'found', version: r.version } : { k: 'latest' });
    } catch (e) { setS({ k: 'idle' }); toast(tl('检查更新失败：{v0}', { v0: String(e) }), { kind: 'err' }); }
  };
  const install = async (version: string) => {
    setS({ k: 'installing', version });
    try { await installUpdate(ratio => setS({ k: 'installing', version, ratio })); }
    catch (e) { setS({ k: 'idle' }); toast(tl('更新失败：{v0}', { v0: String(e) }), { kind: 'err' }); }
  };

  const desc = s.k === 'checking' ? tl('正在检查…')
    : s.k === 'latest' ? tl('已是最新版本')
    : s.k === 'found' ? tl('有新版本 {v0}。安装前会备份数据，装完 Tibi 自动重启', { v0: s.version })
    : s.k === 'installing' ? (s.ratio === undefined ? tl('正在下载 {v0}…', { v0: s.version }) : tl('正在下载 {v0}（{v1}%）', { v0: s.version, v1: Math.round(s.ratio * 100) }))
    : tl('连接 GitHub 查看有没有新版本');

  return <>
    <div className="item"><div><div className="t">{tl('检查更新')}</div><div className="d" aria-live="polite">{desc}</div></div><div className="ctl">
      {s.k === 'found'
        ? <button className="btn sm pri" onClick={() => void install(s.version)}>{tl('安装并重启')}</button>
        : <button className="btn sm" disabled={s.k === 'checking' || s.k === 'installing'} onClick={() => void check()}>{tl('检查更新')}</button>}
    </div></div>
    <div className="item"><div><div className="t">{tl('自动检查更新')}</div><div className="d">{tl('每天连接一次 GitHub，有新版本时提醒你，不会自动安装')}</div></div><div className="ctl"><Switch label={tl('自动检查更新')} checked={auto} onChange={v => { setAuto(v); setAutoCheck(v); }} /></div></div>
  </>;
}
