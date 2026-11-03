import type { Skill } from '@tibi/core';
import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Switch } from '../components/Switch';
import { storeSecret } from '../lib/providers';
import { errorInfo, rpc, type Result } from '../rpc';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';

/**
 * 设置 → 高级 → Tibi 能做的事（00 §3.7，R14）：每项一行（模型档、本月花费），展开改模型档、附加指令、写入权限，恢复默认。
 * 只能配置，不能新建或安装。"找文章"下面管文章来源；"整理记忆"可以现在运行（只在手动运行时工作）。
 */
const ORDER = ['tibi', 'tutor', 'scout', 'coach', 'insight', 'archivist'];

export function SkillItems() {
  const nav = useNavigate();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [open, setOpen] = useState<string>();
  const load = useCallback(() => { rpc.call('skills.list', {}).then(l => setSkills([...l].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))), () => undefined); }, []);
  useEffect(() => { load(); return rpc.on('data.changed', d => { if (d.table === 'skills') load(); }); }, [load]);
  const patch = async (id: string, p: Parameters<typeof rpc.call<'skills.update'>>[1]['patch']) => {
    try { const s = await rpc.call('skills.update', { id, patch: p }); setSkills(l => l.map(x => (x.id === id ? s : x))); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  return <>
    <div className="item"><div className="d">{tl('导入文章是固定的流程（不是模型驱动），这里不用设置。下面这些由模型完成，每项可以单独选快速 / 深入档。')}</div></div>
    {skills.map(s => <div key={s.id} className="item col">
      <button className="skrow" onClick={() => setOpen(open === s.id ? undefined : s.id)} aria-expanded={open === s.id}>
        <span className="t">{s.id === 'tibi' ? tl('和 Tibi 对话') : s.title}</span>
        <span className="lbl">{s.model_tier === 'deep' ? tl('深入') : tl('快速')}{s.enabled ? '' : tl(' · 已关闭')}</span>
        <span style={{ flex: 1 }} /><ChevronDown size={14} style={{ transform: open === s.id ? 'rotate(180deg)' : undefined }} />
      </button>
      {open === s.id && <div className="skbody">
        <p className="lbl">{s.description}</p>
        <div className="skf"><span>{tl('模型档')}</span><div className="seg">{(['fast', 'deep'] as const).map(t => <button key={t} className={s.model_tier === t ? 'on' : ''} onClick={() => void patch(s.id, { model_tier: t })}>{t === 'fast' ? tl('快速') : tl('深入')}</button>)}</div></div>
        <div className="skf"><span>{tl('写入数据前')}</span><div className="seg"><button className={s.write_permission === 'inherit' ? 'on' : ''} onClick={() => void patch(s.id, { write_permission: 'inherit' })}>{tl('按权限模式')}</button><button className={s.write_permission === 'ask' ? 'on' : ''} onClick={() => void patch(s.id, { write_permission: 'ask' })}>{tl('每次都问')}</button></div></div>
        {s.id !== 'tibi' && <div className="skf"><span>{tl('启用')}</span><Switch label={tl('启用')} checked={s.enabled} onChange={v => void patch(s.id, { enabled: v })} /></div>}
        <label className="skf col"><span>{tl('附加要求（会加在它的说明后面）')}</span>
          <textarea className="input" rows={2} defaultValue={s.extra_instructions ?? ''} placeholder={s.id === 'tutor' ? tl('例如：讲语法时少用术语，多举例') : tl('例如：回答尽量简短')} onBlur={e => { if ((e.target.value || '') !== (s.extra_instructions ?? '')) void patch(s.id, { extra_instructions: e.target.value }); }} /></label>
        {s.id === 'scout' && <WebSearchItem />}
        {s.id === 'scout' && <FeedItems />}
        <div className="skacts">
          {s.id === 'archivist' && <button className="btn sm pri" onClick={async () => { try { const r = await rpc.call('skills.runNow', { id: 'archivist', input: tl('整理最近的学习事件和对话，更新记忆') }); toast(tl('Tibi 正在整理记忆'), { action: { label: tl('看进度'), run: () => nav(`/chat/${r.conversation_id}`) } }); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } }}>{tl('现在整理记忆')}</button>}
          {s.id === 'insight' && <button className="btn sm" onClick={() => nav('/stats')}>{tl('去统计页看洞察')}</button>}
          <button className="btn sm" onClick={async () => { try { await rpc.call('skills.reset', { id: s.id }); load(); toast(tl('已恢复默认')); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } }}>{tl('恢复默认')}</button>
        </div>
      </div>}
    </div>)}
  </>;
}

/** 找文章的网页搜索：默认 DeepSeek（用已连接的 Key），可换 Tavily（自己填 Key）或关掉；Key 的名字和 Core 的 TAVILY_REF 一致 */
function WebSearchItem() {
  const [cfg, setCfg] = useState<Result<'websearch.config'>>();
  const [key, setKey] = useState('');
  useEffect(() => { rpc.call('websearch.config', {}).then(setCfg, () => undefined); }, []);
  const choose = async (provider: 'deepseek' | 'tavily' | 'off') => { try { setCfg(await rpc.call('websearch.configure', { provider })); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };
  const saveKey = async () => {
    try {
      if (!await storeSecret('search.tavily', key.trim())) { toast(tl('浏览器模式不能写钥匙串。dev 下用环境变量 TIBI_SECRET_<REF>')); return; }
      setKey(''); setCfg(await rpc.call('websearch.config', {})); toast(tl('已保存'));
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  if (!cfg) return null;
  return <div className="skf col"><span>{tl('网页搜索')}</span>
    <div className="seg">{([['deepseek', 'DeepSeek'], ['tavily', 'Tavily'], ['off', tl('不搜索')]] as const).map(([id, label]) => <button key={id} className={cfg.provider === id ? 'on' : ''} onClick={() => void choose(id)}>{label}</button>)}</div>
    {cfg.provider === 'deepseek' && <p className="lbl">{cfg.deepseek_ready ? tl('用已连接的 DeepSeek Key，每次约 ¥0.005，计入预算。') : tl('还没连接官方 DeepSeek。连接之前只用文章来源。')}</p>}
    {cfg.provider === 'tavily' && <>
      <p className="lbl">{tl('费用在你的 Tavily 账户结算（有免费额度），不计入 Tibi 的预算。')}</p>
      <div style={{ display: 'flex', gap: 8 }}><input className="input" style={{ flex: 1 }} type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={cfg.tavily_ready ? tl('已保存，留空不改') : 'Tavily API Key'} aria-label="Tavily API Key" autoComplete="off" />
        <button className="btn sm" disabled={!key.trim()} onClick={() => void saveKey()}>{tl('保存')}</button></div>
    </>}
    {cfg.provider === 'off' && <p className="lbl">{tl('只从文章来源找文章，不搜索网页。')}</p>}
  </div>;
}

/** 找文章的文章来源：内置的可关，自己加的可删 */
function FeedItems() {
  const [feeds, setFeeds] = useState<Result<'feeds.list'>>([]);
  const [url, setUrl] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { rpc.call('feeds.list', {}).then(setFeeds, () => undefined); }, []);
  const upd = async (p: Parameters<typeof rpc.call<'feeds.update'>>[1]) => { try { setFeeds(await rpc.call('feeds.update', p)); return true; } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); return false; } };
  return <div className="skf col"><span>{tl('文章来源（找文章从这里挑）')}</span>
    <div className="feeds">{feeds.map(f => <div key={f.url} className="feed">
      <Switch label={f.title} checked={f.enabled} onChange={v => void upd({ toggle: { url: f.url, enabled: v } })} />
      <span className="ft">{f.title}</span><span className="lbl fu">{f.url}</span>
      {!f.builtin && <button className="linkbtn" onClick={() => void upd({ remove: f.url })}>{tl('删除')}</button>}
    </div>)}</div>
    <div style={{ display: 'flex', gap: 8 }}><input className="input" style={{ flex: 1 }} value={url} onChange={e => setUrl(e.target.value)} placeholder={tl('RSS / Atom 地址，如 https://example.com/feed.xml')} />
      <button className="btn sm" disabled={!url.trim() || busy} onClick={async () => { setBusy(true); if (await upd({ add: { url: url.trim() } })) setUrl(''); setBusy(false); }}>{busy ? tl('检查中…') : tl('添加')}</button></div>
  </div>;
}
