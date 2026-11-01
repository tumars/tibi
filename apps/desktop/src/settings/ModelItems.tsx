import type { Provider } from '@tibi/core';
import { useEffect, useState } from 'react';
import { tl } from '../lib/i18n';
import { saveProvider } from '../lib/providers';
import { errorInfo, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';

/** 设置 → 模型（00 §3.7）：连接的服务、两档模型 */
export function ModelItems() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [editing, setEditing] = useState<Partial<Provider> & { key?: string }>();
  useEffect(() => { rpc.call('providers.list', {}).then(setProviders, () => undefined); }, []);

  const onSaveProvider = async () => {
    if (!editing) return;
    try {
      const { provider: p, keyStored } = await saveProvider(editing);
      if (editing.key && !keyStored) toast(tl('浏览器模式不能写钥匙串。dev 下用环境变量 TIBI_SECRET_<REF>'));
      setProviders(ps => ps.some(x => x.id === p.id) ? ps.map(x => x.id === p.id ? p : x) : [...ps, p]); setEditing(undefined); toast(tl('已保存'));
      void useCore.getState().refresh();
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const testProvider = async (id: string) => {
    try { const r = await rpc.call('providers.test', { id }); toast(r.ok ? tl('连接成功{v0}', { v0: r.latency_ms ? ` · ${r.latency_ms} ms` : '' }) : tl('连接失败：{v0}', { v0: r.error ?? '' }), { kind: r.ok ? undefined : 'err' }); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  return <>
    {providers.map(p => <div key={p.id} className="prov"><div><div className="t" style={{ fontSize: 14, fontWeight: 500 }}>{p.name} <span className="tagc">{p.tier === 'deep' ? tl('深入') : tl('快速')}{p.is_default ? tl(' · 默认') : ''}</span> <span className="tagc" style={{ color: p.has_secret ? 'var(--ok)' : 'var(--ink-3)' }}>{p.has_secret ? tl('已配置密钥') : tl('未配置密钥')}</span></div><div className="lbl">{p.model}{p.base_url ? ` · ${p.base_url}` : ''}</div></div><div className="ctl"><button className="btn sm" onClick={() => testProvider(p.id)}>{tl('测试连接')}</button><button className="btn sm" onClick={() => setEditing({ ...p })}>{tl('编辑')}</button></div></div>)}
    {!providers.length && !editing && <div className="item"><div><div className="t">{tl('还没有连接模型')}</div><div className="d">{tl('不连模型时查词、标注、复习照常。导入文章的总结、语境释义需要模型。')}</div></div><div className="ctl"><button className="btn sm pri" onClick={() => setEditing({ name: 'DeepSeek', kind: 'llm', protocol: 'openai_compatible', base_url: 'https://api.deepseek.com', model: 'deepseek-flash', tier: 'fast', is_default: true })}>{tl('连接 DeepSeek')}</button><button className="btn sm" onClick={() => setEditing({ name: '', kind: 'llm', protocol: 'openai_compatible', base_url: '', model: '', tier: 'fast', is_default: !providers.length })}>{tl('其他兼容服务')}</button></div></div>}
    {editing && <div className="pform">
      <span>{tl('名称')}</span><input className="input" value={editing.name ?? ''} onChange={e => setEditing({ ...editing, name: e.target.value })} />
      <span>Base URL</span><input className="input" value={editing.base_url ?? ''} onChange={e => setEditing({ ...editing, base_url: e.target.value })} placeholder="https://api.deepseek.com" />
      <span>{tl('模型')}</span><input className="input" value={editing.model ?? ''} onChange={e => setEditing({ ...editing, model: e.target.value })} placeholder="deepseek-flash" />
      <span>{tl('档位')}</span><select className="input" value={editing.tier ?? 'fast'} onChange={e => setEditing({ ...editing, tier: e.target.value as 'fast' | 'deep' })}><option value="fast">{tl('快速')}</option><option value="deep">{tl('深入')}</option></select>
      <span>API Key</span><input className="input" type="password" value={editing.key ?? ''} onChange={e => setEditing({ ...editing, key: e.target.value })} placeholder={editing.has_secret ? tl('已保存，留空不改') : 'sk-…'} />
      <div className="row"><button className="btn sm pri" onClick={onSaveProvider}>{tl('保存')}</button><button className="btn sm" onClick={() => setEditing(undefined)}>{tl('取消')}</button><span className="lbl" style={{ alignSelf: 'center' }}>{tl('Key 只存在这台电脑的钥匙串里')}</span></div>
    </div>}
    {providers.length > 0 && !editing && <div className="item"><div className="lbl">{tl('添加其他 OpenAI 兼容服务')}</div><div className="ctl"><button className="btn sm" onClick={() => setEditing({ name: '', kind: 'llm', protocol: 'openai_compatible', base_url: '', model: '', tier: 'deep', is_default: false })}>{tl('添加')}</button></div></div>}
  </>;
}
