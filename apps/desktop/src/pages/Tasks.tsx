import type { Approval, Task, TaskStep, TaskSummary } from '@tibi/core';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Top } from '../components/Shell';
import { Markdown } from '../lib/md';
import { errorInfo, rpc, type Result } from '../rpc';
import { toast } from '../store/ui';

/**
 * 任务中心（00 §3.11，M5 完整版）：四项概览 → 等你确认 → 运行中 → 最近（今天 / 昨天 / 更早）。
 * 点任务在右侧抽屉看详情：状态、触发方式、模型、用量、嵌套步骤树、过程；可在对话中继续、复制诊断信息（不含 Key 和正文）。
 * 键盘：J / K 在确认项与任务间移动，Enter 开详情，A / R 允许或拒绝当前确认项，Esc 关闭。对话里"查看过程"带 ?t=任务 id。
 */
const STATE: Record<string, string> = { run: '进行中', appr: '等你确认', paused: '已暂停', done: '完成', err: '失败', cancel: '已取消' };
const SKILL: Record<string, string> = { tibi: 'Tibi', importer: '导入文章', tutor: '讲解', scout: '找文章', coach: '出题与批改', insight: '学习洞察', archivist: '整理记忆' };
const TRIGGER: Record<string, string> = { user: '你发起', auto: '自动', mcp: '外部 AI 工具', share: '剪藏 / 分享' };
const dur = (ms: number) => ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} 秒` : `${Math.round(ms / 60_000)} 分钟`;
const day0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

function Steps({ steps }: { steps: TaskStep[] }) {
  return <div className="tsteps">{steps.map(s => <div key={s.id}>
    <div className={`tstep ${s.state}`}><i />{s.label}<span className="sp" />{s.duration_ms !== undefined && <span className="lbl">{dur(s.duration_ms)}</span>}</div>
    {s.children?.length ? <div style={{ paddingLeft: 18 }}><Steps steps={s.children} /></div> : null}
  </div>)}</div>;
}

function ApprovalCard({ a, cur, onDone }: { a: Approval; cur: boolean; onDone: () => void }) {
  const [edit, setEdit] = useState<string>();
  const decide = async (decision: 'allow' | 'deny' | 'edit', always = false) => {
    try { await rpc.call('tasks.approve', { id: a.task_id, decision, always, ...(decision === 'edit' && a.editable ? { edited: { [a.editable.field]: edit } } : {}) }); onDone(); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  return <div className={`approve${cur ? ' cur' : ''}`} id={`a-${a.task_id}`}>
    <div className="h"><span>{a.title}</span><span className="k">{SKILL[a.skill_id ?? ''] ?? ''}{a.untrusted ? ' · 读过网页内容' : ''}</span></div>
    <div className="b">{a.body}</div>
    <div className="lbl">将执行 <code>{a.tool}</code> · {a.impact}{a.undoable ? ' · 可撤销' : ''}</div>
    {edit !== undefined && <textarea className="input" rows={2} value={edit} onChange={e => setEdit(e.target.value)} />}
    <div className="acts">
      {edit === undefined ? <button className="btn sm pri" onClick={() => void decide('allow')}>允许 <span className="kbd">A</span></button> : <button className="btn sm pri" onClick={() => void decide('edit')}>改好了，允许</button>}
      <button className="btn sm" onClick={() => void decide('deny')}>拒绝 <span className="kbd">R</span></button>
      {a.editable && edit === undefined && <button className="btn sm" onClick={() => setEdit(a.editable!.value)}>修改后允许</button>}
      {!a.untrusted && <button className="btn sm" onClick={() => void decide('allow', true)}>以后这类自动允许</button>}
    </div>
  </div>;
}

function Row({ t, cur, onOpen, onChanged }: { t: TaskSummary; cur: boolean; onOpen: () => void; onChanged: () => void }) {
  const act = async (m: 'tasks.cancel' | 'tasks.retry' | 'tasks.pause' | 'tasks.resume', e: React.MouseEvent) => { e.stopPropagation(); try { await rpc.call(m, { id: t.id }); onChanged(); } catch (err) { toast(errorInfo(err).message, { kind: 'err' }); } };
  const left = t.state === 'run' && t.step.total ? `第 ${Math.min(t.step.index + 1, t.step.total)} / ${t.step.total} 步 · ${t.step.label}` : t.state === 'run' ? t.step.label : dur(t.duration_ms);
  return <div className={`trow${cur ? ' cur' : ''}`} id={`t-${t.id}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}>
    <div className="thead">
      <span className={`tstate ${t.state}`}>{STATE[t.state] ?? t.state}</span>
      <span className="ttitle">{t.title || SKILL[t.skill_id] || '任务'}</span>
      <span className="lbl">{SKILL[t.skill_id] ?? t.skill_id}{t.trigger !== 'user' ? ` · ${TRIGGER[t.trigger] ?? t.trigger}` : ''}</span>
      <span className="sp" />
      <span className="lbl">{left}{t.cost ? ` · ¥${t.cost.toFixed(3)}` : ''}</span>
      {t.state === 'run' && <button className="ibtn" title="完成当前步后暂停" onClick={e => void act('tasks.pause', e)}><Pause size={14} /></button>}
      {t.state === 'paused' && <button className="ibtn" title="继续" onClick={e => void act('tasks.resume', e)}><Play size={14} /></button>}
      {(t.state === 'run' || t.state === 'paused' || t.state === 'appr') && <button className="ibtn" title="取消" onClick={e => void act('tasks.cancel', e)}><X size={14} /></button>}
      {t.state === 'err' && <button className="ibtn" title="从失败的那步重试" onClick={e => void act('tasks.retry', e)}><RotateCcw size={14} /></button>}
    </div>
    {t.error && t.state === 'err' && <div className="chaterr" style={{ padding: '0 14px 10px' }}>{t.error}</div>}
  </div>;
}

function Drawer({ id, onClose }: { id: string; onClose: () => void }) {
  const nav = useNavigate();
  const [d, setD] = useState<Task>();
  useEffect(() => {
    const load = () => rpc.call('tasks.get', { id }).then(setD, e => toast(errorInfo(e).message, { kind: 'err' }));
    void load();
    const offs = [rpc.on('task.update', x => { if (x.task.id === id) void load(); }), rpc.on('task.done', x => { if (x.task.id === id) void load(); })];
    return () => offs.forEach(o => o());
  }, [id]);
  const copyDiag = async () => { try { const r = await rpc.call('tasks.diagnostics', { id }); await navigator.clipboard.writeText(JSON.stringify(r, null, 2)); toast('诊断信息已复制（不含 Key 和正文）'); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };
  return <aside className="tdrawer" aria-label="任务详情">
    <div className="rph"><b>{d?.title ?? '任务'}</b><span className="sp" /><button className="ibtn" title="关闭（Esc）" onClick={onClose}><X size={16} /></button></div>
    {d ? <div className="rpb">
      <dl className="kv">
        <dt>状态</dt><dd><span className={`tstate ${d.state}`}>{STATE[d.state]}</span>{d.error ? ` · ${d.error}` : ''}</dd>
        <dt>谁发起</dt><dd>{TRIGGER[d.trigger] ?? d.trigger} · {SKILL[d.skill_id] ?? d.skill_id}</dd>
        <dt>开始</dt><dd>{new Date(d.started_at).toLocaleString('zh-CN')} · 用时 {dur(d.duration_ms)}</dd>
        <dt>模型</dt><dd>{d.model || '—'}</dd>
        <dt>用量</dt><dd>输入 {d.usage.tokens_in} · 输出 {d.usage.tokens_out} token · ¥{d.usage.cost.toFixed(4)}</dd>
      </dl>
      {d.approval && <ApprovalCard a={d.approval} cur={false} onDone={() => undefined} />}
      {d.steps.length > 0 && <section><h5>步骤</h5><Steps steps={d.steps} /></section>}
      {d.transcript.filter(m => m.text || m.tool).length > 0 && <section><h5>过程</h5>{d.transcript.filter(m => m.text || m.tool).slice(-12).map(m => m.tool
        ? <div key={m.id} className="toolline">⚙ {m.tool.name}{m.tool.duration_ms ? ` · ${dur(m.tool.duration_ms)}` : ''}</div>
        : <div key={m.id} className={`msg ${m.role === 'user' ? 'u' : 'a'}`} style={{ fontSize: 13 }}>{m.role === 'user' ? m.text : <Markdown text={m.text!} />}</div>)}</section>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {d.conversation_id && <button className="btn sm" onClick={() => nav(`/chat/${d.conversation_id}`)}>在对话中继续</button>}
        <button className="btn sm" onClick={() => void copyDiag()}>复制诊断信息</button>
      </div>
    </div> : <div className="rpb"><p className="lbl">加载中…</p></div>}
  </aside>;
}

export function Tasks() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Result<'tasks.list'>>();
  const [open, setOpen] = useState<string | undefined>(params.get('t') ?? undefined);
  const [cur, setCur] = useState(0);
  const load = useCallback(() => { rpc.call('tasks.list', { limit: 80 }).then(setData, e => toast(errorInfo(e).message, { kind: 'err' })); }, []);
  useEffect(() => {
    load();
    const offs = [rpc.on('task.update', () => load()), rpc.on('task.done', () => load()), rpc.on('approval.requested', () => load()), rpc.on('approval.resolved', () => load())];
    return () => offs.forEach(o => o());
  }, [load]);
  useEffect(() => { const t = params.get('t'); if (t) setOpen(t); }, [params]);
  const groups = useMemo(() => {
    const h = data?.history ?? []; const t0 = day0(); const y0 = t0 - 86_400_000;
    return [['今天', h.filter(x => x.started_at >= t0)], ['昨天', h.filter(x => x.started_at >= y0 && x.started_at < t0)], ['更早', h.filter(x => x.started_at < y0)]] as const;
  }, [data]);
  // J / K 走的顺序：确认项 → 运行中 → 最近
  const order = useMemo(() => [...(data?.pending ?? []).map(a => ({ kind: 'a' as const, id: a.task_id, a })), ...(data?.running ?? []).map(t => ({ kind: 't' as const, id: t.id })), ...groups.flatMap(([, l]) => l.map(t => ({ kind: 't' as const, id: t.id })))], [data, groups]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase(); const item = order[cur];
      if (k === 'j' || k === 'k') { e.preventDefault(); const n = Math.max(0, Math.min(order.length - 1, cur + (k === 'j' ? 1 : -1))); setCur(n); const it = order[n]; if (it) document.getElementById(`${it.kind}-${it.id}`)?.scrollIntoView({ block: 'nearest' }); }
      else if (k === 'enter' && item) { setOpen(item.id); }
      else if ((k === 'a' || k === 'r') && item?.kind === 'a') { void rpc.call('tasks.approve', { id: item.id, decision: k === 'a' ? 'allow' : 'deny' }).then(load, err => toast(errorInfo(err).message, { kind: 'err' })); }
      else if (k === 'escape') { setOpen(undefined); setParams({}, { replace: true }); }
    };
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey);
  }, [order, cur, load, setParams]);
  const k = data?.kpis;
  const isCur = (id: string) => order[cur]?.id === id;
  return (
    <>
      <Top crumbs={[{ label: '任务' }]} />
      <div className={`taskswrap${open ? ' with-drawer' : ''}`}>
        <div className="scroll"><div className="page tasks">
          {k && <div className="tiles four" style={{ marginBottom: 24 }}>
            <div className="tile"><span className="k">运行中</span><span className="v">{k.running}</span></div>
            <div className="tile"><span className="k">本周完成</span><span className="v">{k.week_done}<small>{k.week_failed ? ` · 失败 ${k.week_failed}` : ''}</small></span></div>
            <div className="tile"><span className="k">本月 AI 花费</span><span className="v">¥{k.month_cost.toFixed(2)}<small>/ ¥{k.budget}</small></span><div className="bar2"><i style={{ width: `${Math.min(100, (k.month_cost / Math.max(1, k.budget)) * 100)}%` }} /></div></div>
            <div className="tile"><span className="k">花得最多</span><span className="v" style={{ fontSize: 22 }}>{k.top_skill.cost ? SKILL[k.top_skill.id] ?? k.top_skill.id : '—'}</span><span className="d">{k.top_skill.cost ? `本月 ¥${k.top_skill.cost.toFixed(2)}` : '本月还没花钱'}</span></div>
          </div>}
          {!!data?.pending.length && <section><div className="sech"><h2>等你确认</h2><span className="lbl">J / K 移动 · A 允许 · R 拒绝</span></div>
            {data.pending.map(a => <ApprovalCard key={a.task_id} a={a} cur={isCur(a.task_id)} onDone={load} />)}
          </section>}
          {!!data?.running.length && <section><div className="sech"><h2>运行中</h2></div>{data.running.map(t => <Row key={t.id} t={t} cur={isCur(t.id) || open === t.id} onOpen={() => setOpen(t.id)} onChanged={load} />)}</section>}
          {data && !data.history.length && !data.running.length && <p className="lbl">还没有任务。导入文章、问 Tibi 都会在这里留下记录。</p>}
          {groups.map(([label, list]) => list.length ? <section key={label}><div className="sech"><h2>{label}</h2></div>{list.map(t => <Row key={t.id} t={t} cur={isCur(t.id) || open === t.id} onOpen={() => setOpen(t.id)} onChanged={load} />)}</section> : null)}
        </div></div>
        {open && <Drawer id={open} onClose={() => { setOpen(undefined); setParams({}, { replace: true }); }} />}
      </div>
    </>
  );
}
