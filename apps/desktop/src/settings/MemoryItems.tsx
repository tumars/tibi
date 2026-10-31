import type { Memory } from '@tibi/core';
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../components/Modal';
import { Switch } from '../components/Switch';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';

/**
 * 设置 → 记忆（00 §3.7）：Tibi 记住的内容，注明来源与日期；可逐条改、删（可撤销），暂停写入新记忆，清空全部（可撤销）。
 * Tibi 写入新记忆前按权限模式先问你（对话里的审批卡）。
 */
const TYPE: Record<Memory['type'], string> = { profile: '关于你', procedural: '你的要求', semantic: '它知道的', episodic: '经历' };
const undoToast = (msg: string, undo_id: string, after: () => void) => toast(msg, { action: { label: '撤销', run: () => { void rpc.call('system.undo', { undo_id }).then(() => { toast('已撤销'); after(); }, e => toast(errorInfo(e).message, { kind: 'err' })); } } });

export function MemoryItems() {
  const [items, setItems] = useState<Memory[]>();
  const [paused, setPaused] = useState(false);
  const [edit, setEdit] = useState<{ id: string; text: string }>();
  const [clear, setClear] = useState(false);
  const load = useCallback(() => {
    rpc.call('memory.list', {}).then(setItems, () => setItems([]));
    rpc.call('settings.get', { keys: ['memory.paused'] }).then(s => setPaused(!!s['memory.paused']), () => undefined);
  }, []);
  useEffect(() => { load(); return rpc.on('data.changed', d => { if (d.table === 'memories') load(); }); }, [load]);

  const save = async () => {
    if (!edit) return; const text = edit.text.trim(); setEdit(undefined);
    if (!text) return;
    try { await rpc.call('memory.update', { id: edit.id, content: text }); load(); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const del = async (m: Memory) => {
    try { const u = await rpc.call('memory.delete', { id: m.id }); load(); undoToast('已删除这条记忆', u.undo_id, load); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const doClear = async () => {
    setClear(false);
    try { const u = await rpc.call('memory.clear', {}); load(); undoToast('已清空全部记忆', u.undo_id, load); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const groups = (Object.keys(TYPE) as Memory['type'][]).map(t => [t, (items ?? []).filter(m => m.type === t && m.status === 'active')] as const).filter(([, l]) => l.length);

  return <>
    <div className="item">
      <div><div className="t">暂停记住新的事</div><div className="d">打开后 Tibi 不再写入新记忆，已有的照常使用。Tibi 想记住什么时会先问你（按权限模式）。</div></div>
      <div className="ctl"><Switch label="暂停记住新的事" checked={paused} onChange={async v => { setPaused(v); await rpc.call('memory.pause', { paused: v }).catch(e => toast(errorInfo(e).message, { kind: 'err' })); }} /></div>
    </div>
    {items && !groups.length && <div className="item"><div className="d">Tibi 还没有记住什么。对话里说"记住……"，或者让它整理记忆（M5）。</div></div>}
    {groups.map(([t, list]) => <div key={t} className="item col">
      <div className="t">{TYPE[t]}</div>
      <div className="memlist">{list.map(m => <div key={m.id} className="mem">
        {edit?.id === m.id
          ? <input className="input" autoFocus value={edit.text} onChange={e => setEdit({ id: m.id, text: e.target.value })} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEdit(undefined); }} />
          : <button className="memc" title="点一下修改" onClick={() => setEdit({ id: m.id, text: m.content })}>{m.content}</button>}
        <span className="lbl">{m.source.label} · {new Date(m.updated_at).toLocaleDateString('zh-CN')}</span>
        <button className="linkbtn" onClick={() => del(m)}>删除</button>
      </div>)}</div>
    </div>)}
    {!!items?.length && <div className="item"><div><div className="t">清空全部记忆</div><div className="d">可以撤销。</div></div><div className="ctl"><button className="btn sm" onClick={() => setClear(true)}>清空</button></div></div>}
    <Modal open={clear} onOpenChange={setClear} title="清空 Tibi 的全部记忆？" actions={<><button className="btn" onClick={() => setClear(false)}>取消</button><button className="btn pri" onClick={doClear}>清空</button></>}>
      <p>Tibi 会忘掉关于你的身份、兴趣和你提过的要求。之后可以在提示里撤销。</p>
    </Modal>
  </>;
}
