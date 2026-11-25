import type { Skill } from '@tibi/core';
import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Switch } from '../components/Switch';
import { Badge, InfoTip } from '../components/ui';
import { storeSecret } from '../lib/providers';
import { errorInfo, rpc, type Result } from '../rpc';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';

/**
 * 设置 → 高级 → Tibi 能做的事（00 §3.7，R14）：每项一行（模型档、本月花费），展开改模型档、附加指令、写入权限，恢复默认。
 * 只能配置，不能新建或安装。"找文章"下面有去订阅页的入口；"整理记忆"可以现在运行（只在手动运行时工作）。
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
    {skills.map(s => <div key={s.id} className="item col">
      <button className="skrow" onClick={() => setOpen(open === s.id ? undefined : s.id)} aria-expanded={open === s.id}>
        <span className="t">{s.id === 'tibi' ? tl('和 Tibi 对话') : s.title}</span>
        <Badge tone={s.model_tier === 'deep' ? 'accent' : 'neutral'}>{s.model_tier === 'deep' ? tl('深入') : tl('快速')}</Badge>
        {!s.enabled && <Badge tone="warn">{tl('已关闭')}</Badge>}
        <span style={{ flex: 1 }} /><ChevronDown size={14} style={{ transform: open === s.id ? 'rotate(180deg)' : undefined }} />
      </button>
      {open === s.id && <div className="skbody">
        <p className="lbl">{s.description}</p>
        <div className="skf"><span>{tl('模型档')}</span><div className="seg">{(['fast', 'deep'] as const).map(t => <button key={t} className={s.model_tier === t ? 'on' : ''} onClick={() => void patch(s.id, { model_tier: t })}>{t === 'fast' ? tl('快速') : tl('深入')}</button>)}</div></div>
        <div className="skf"><span>{tl('写入数据前')}</span><div className="seg"><button className={s.write_permission === 'inherit' ? 'on' : ''} onClick={() => void patch(s.id, { write_permission: 'inherit' })}>{tl('按权限模式')}</button><button className={s.write_permission === 'ask' ? 'on' : ''} onClick={() => void patch(s.id, { write_permission: 'ask' })}>{tl('每次都问')}</button></div></div>
        {s.id !== 'tibi' && <div className="skf"><span>{tl('启用')}</span><Switch label={tl('启用')} checked={s.enabled} onChange={v => void patch(s.id, { enabled: v })} /></div>}
        <label className="skf col"><span className="item-head">{tl('附加指令')}<InfoTip content={tl('将追加至该任务的系统说明末尾。')} /></span>
          <textarea className="input" rows={2} defaultValue={s.extra_instructions ?? ''} placeholder={s.id === 'tutor' ? tl('例如：讲语法时少用术语，多举例') : tl('例如：回答尽量简短')} onBlur={e => { if ((e.target.value || '') !== (s.extra_instructions ?? '')) void patch(s.id, { extra_instructions: e.target.value }); }} /></label>
        {s.id === 'scout' && <WebSearchItem />}
        {s.id === 'scout' && <FeedItems />}
        <div className="skacts">
          {s.id === 'archivist' && <button className="btn sm pri" onClick={async () => { try { const r = await rpc.call('skills.runNow', { id: 'archivist', input: tl('整理最近的学习事件和对话，更新记忆') }); toast(tl('Tibi 正在整理记忆'), { action: { label: tl('看进度'), run: () => nav(`/chat/${r.conversation_id}`) } }); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } }}>{tl('立即整理记忆')}</button>}
          {s.id === 'insight' && <button className="btn sm" onClick={() => nav('/stats')}>{tl('查看统计洞察')}</button>}
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
  const searchTip = cfg.provider === 'deepseek'
    ? (cfg.deepseek_ready ? tl('复用已连接的 DeepSeek Key，单次约 ¥0.005。') : tl('未连接官方 DeepSeek，当前仅使用订阅源文章。'))
    : cfg.provider === 'tavily'
    ? tl('费用由 Tavily 账户结算（含免费额度）。')
    : tl('仅从订阅源筛选文章，不执行网页搜索。');
  return <div className="skf col">
    <span className="item-head">{tl('网页搜索')}<InfoTip content={searchTip} /></span>
    <div className="seg">{([['deepseek', 'DeepSeek'], ['tavily', 'Tavily'], ['off', tl('不搜索')]] as const).map(([id, label]) => <button key={id} className={cfg.provider === id ? 'on' : ''} onClick={() => void choose(id)}>{label}</button>)}</div>
    {cfg.provider === 'deepseek' && !cfg.deepseek_ready && <p className="lbl">{tl('未连接官方 DeepSeek，当前仅使用订阅源。')}</p>}
    {cfg.provider === 'tavily' && <div style={{ display: 'flex', gap: 8 }}>
      <input className="input" style={{ flex: 1 }} type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={cfg.tavily_ready ? tl('已保存，留空不改') : 'Tavily API Key'} aria-label="Tavily API Key" autoComplete="off" />
      <button className="btn sm" disabled={!key.trim()} onClick={() => void saveKey()}>{tl('保存')}</button>
    </div>}
  </div>;
}

/** 找文章的候选来自订阅：管理放在侧栏「订阅」页 */
function FeedItems() {
  const nav = useNavigate();
  return <div className="skf">
    <span className="item-head">{tl('订阅源')}<InfoTip content={tl('找文章优先从已启用的订阅源筛选。')} /></span>
    <button className="btn sm" onClick={() => nav('/feeds/manage')}>{tl('管理订阅')}</button>
  </div>;
}
