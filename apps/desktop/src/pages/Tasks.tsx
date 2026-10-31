import type { Approval, Task, TaskStep, TaskSummary } from '@tibi/core';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Top } from '../components/Shell';
import { Markdown } from '../lib/md';
import { errorInfo, rpc, type Result } from '../rpc';
import { toast } from '../store/ui';

/**
 * 任务中心（00 §3.11，M2 最小版；完整版在 M5）：等你确认、进行中、最近的任务。点一项展开步骤、用量和对话记录。
 * 对话里"查看过程"链到这里（?t=任务 id）。
 */
const STATE: Record<string, string> = { run: '进行中', appr: '等你确认', paused: '已暂停', done: '完成', err: '失败', cancel: '已取消' };
const SKILL: Record<string, string> = { tibi: 'Tibi', importer: '导入文章', tutor: '讲解', scout: '找文章', coach: '出题与批改', insight: '学习洞察', archivist: '整理记忆' };
const dur = (ms: number) => ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} 秒` : `${Math.round(ms / 60_000)} 分钟`;

function Steps({ steps }: { steps: TaskStep[] }) {
  return <div className="tsteps">{steps.map(s => <div key={s.id}>
    <div className={`tstep ${s.state}`}><i />{s.label}<span className="sp" />{s.duration_ms !== undefined && <span className="lbl">{dur(s.duration_ms)}</span>}</div>
    {s.children?.length ? <div style={{ paddingLeft: 18 }}><Steps steps={s.children} /></div> : null}
  </div>)}</div>;
}

function Row({ t, open, onToggle, onChanged }: { t: TaskSummary; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Task>();
  useEffect(() => { if (open) rpc.call('tasks.get', { id: t.id }).then(setDetail, e => toast(errorInfo(e).message, { kind: 'err' })); }, [open, t.id, t.state]);
  const act = async (m: 'tasks.cancel' | 'tasks.retry') => { try { await rpc.call(m, { id: t.id }); onChanged(); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };
  return <div className={`trow${open ? ' open' : ''}`} id={`t-${t.id}`}>
    <button className="thead" onClick={onToggle}>
      <span className={`tstate ${t.state}`}>{STATE[t.state] ?? t.state}</span>
      <span className="ttitle">{t.title || SKILL[t.skill_id] || '任务'}</span>
      <span className="lbl">{SKILL[t.skill_id] ?? t.skill_id}{t.trigger === 'auto' ? ' · 自动' : ''}</span>
      <span className="sp" />
      <span className="lbl">{t.state === 'run' ? t.step.label : dur(t.duration_ms)}{t.cost ? ` · ¥${t.cost.toFixed(3)}` : ''}</span>
    </button>
    {open && <div className="tbody">
      {t.error && <p className="chaterr">{t.error}</p>}
      {detail ? <>
        {detail.steps.length > 0 && <Steps steps={detail.steps} />}
        <p className="lbl">{detail.model ? `模型 ${detail.model} · ` : ''}输入 {detail.usage.tokens_in} · 输出 {detail.usage.tokens_out} token · ¥{detail.usage.cost.toFixed(4)}</p>
        {detail.transcript.filter(m => m.text).slice(-4).map(m => <div key={m.id} className={`msg ${m.role === 'user' ? 'u' : 'a'}`} style={{ fontSize: 13 }}>{m.role === 'user' ? m.text : <Markdown text={m.text!} />}</div>)}
      </> : <p className="lbl">加载中…</p>}
      <div className="row" style={{ display: 'flex', gap: 8 }}>
        {(t.state === 'run' || t.state === 'paused' || t.state === 'appr') && <button className="btn sm" onClick={() => act('tasks.cancel')}>取消</button>}
        {t.state === 'err' && <button className="btn sm" onClick={() => act('tasks.retry')}>从失败的那步重试</button>}
      </div>
    </div>}
  </div>;
}

export function Tasks() {
  const [params] = useSearchParams();
  const [data, setData] = useState<Result<'tasks.list'>>();
  const [open, setOpen] = useState<string | undefined>(params.get('t') ?? undefined);
  const load = useCallback(() => { rpc.call('tasks.list', { limit: 50 }).then(setData, e => toast(errorInfo(e).message, { kind: 'err' })); }, []);
  useEffect(() => {
    load();
    const offs = [rpc.on('task.update', () => load()), rpc.on('task.done', () => load()), rpc.on('approval.requested', () => load()), rpc.on('approval.resolved', () => load())];
    return () => offs.forEach(o => o());
  }, [load]);
  useEffect(() => { const t = params.get('t'); if (t) { setOpen(t); setTimeout(() => document.getElementById(`t-${t}`)?.scrollIntoView({ block: 'center' }), 300); } }, [params]);
  const decide = async (a: Approval, decision: 'allow' | 'deny') => { try { await rpc.call('tasks.approve', { id: a.task_id, decision }); load(); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };
  const k = data?.kpis;
  return (
    <>
      <Top crumbs={[{ label: '任务' }]} />
      <div className="scroll"><div className="page tasks">
        {k && <div className="tiles" style={{ marginBottom: 24 }}>
          <div className="tile"><span className="k">进行中</span><span className="v">{k.running}</span></div>
          <div className="tile"><span className="k">本周完成</span><span className="v">{k.week_done}<small>{k.week_failed ? ` · 失败 ${k.week_failed}` : ''}</small></span></div>
          <div className="tile"><span className="k">本月 AI 花费</span><span className="v">¥{k.month_cost.toFixed(2)}<small>/ ¥{k.budget}</small></span><div className="bar2"><i style={{ width: `${Math.min(100, k.month_cost / Math.max(1, k.budget) * 100)}%` }} /></div></div>
        </div>}
        {!!data?.pending.length && <section><div className="sech"><h2>等你确认</h2></div>
          {data.pending.map(a => <div key={a.task_id} className="approve" style={{ marginBottom: 10 }}>
            <div className="h"><span>{a.title}</span><span className="k">{SKILL[a.skill_id ?? ''] ?? ''}</span></div>
            <div className="b">{a.body}{a.impact && <><br /><span className="lbl">{a.impact}{a.undoable ? ' · 可撤销' : ''}</span></>}</div>
            <div className="acts"><button className="btn sm pri" onClick={() => decide(a, 'allow')}>允许</button><button className="btn sm" onClick={() => decide(a, 'deny')}>拒绝</button></div>
          </div>)}
        </section>}
        {!!data?.running.length && <section><div className="sech"><h2>进行中</h2></div>{data.running.map(t => <Row key={t.id} t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? undefined : t.id)} onChanged={load} />)}</section>}
        <section><div className="sech"><h2>最近</h2></div>
          {data && !data.history.length && <p className="lbl">还没有任务。导入文章、问 Tibi 都会在这里留下记录。</p>}
          {data?.history.map(t => <Row key={t.id} t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? undefined : t.id)} onChanged={load} />)}
        </section>
      </div></div>
    </>
  );
}
