import { Type } from '@sinclair/typebox';
import { j, now, type Database } from '../db/driver.js';
import { method, type Ctx, type MethodMap } from '../rpc/define.js';
import { TibiError, type Approval, type Message, type SkillId, type Task, type TaskState, type TaskSummary } from '../types.js';
import type { UiContext } from './capabilities.js';
import { Conversations } from './conversations.js';
import { JobRunnerImpl, toState } from './jobs.js';
import { skillIdSchema } from './skills.js';
import { budgets, monthStart } from './usage.js';

/** chat.* 与 tasks.*（06 §3） */

export interface KernelMethodDeps { db: Database; runner: JobRunnerImpl; setUiContext: (c: UiContext | undefined) => void }

const stateSchema = Type.Union((['run', 'appr', 'paused', 'done', 'err', 'cancel'] as TaskState[]).map(s => Type.Literal(s)));

export function chatMethods(deps: KernelMethodDeps): MethodMap {
  const convs = () => new Conversations(deps.db);
  return {
    'chat.open': method(Type.Object({ conversation_id: Type.Optional(Type.String()), document_id: Type.Optional(Type.String()), today: Type.Optional(Type.Boolean()) }), async (p, ctx) => {
      const c = await convs().open({ ...p, device: ctx.platform.info().platform === 'ios' || ctx.platform.info().platform === 'android' ? 'mobile' : 'desktop' });
      const { items, cursor } = await convs().history(c.id, { limit: 50 });
      return { ...c, messages: items, cursor, ...await convs().activity(c.id) };
    }, '给 document_id 时续上该文章的线程；today 为 true 时打开或新建当天的对话；都不给则新建'),
    'chat.send': method(Type.Object({
      conversation_id: Type.String(), text: Type.String({ minLength: 1 }),
      context: Type.Optional(Type.Object({ page: Type.String(), document_id: Type.Optional(Type.String()), section_id: Type.Optional(Type.String()), sentence_id: Type.Optional(Type.String()), selection: Type.Optional(Type.String()), card_id: Type.Optional(Type.String()) })),
      skill: Type.Optional(skillIdSchema), tier: Type.Optional(Type.Union([Type.Literal('fast'), Type.Literal('deep')])), provider_id: Type.Optional(Type.String()),
    }), async (p, ctx) => {
      const conv = await convs().get(p.conversation_id);
      if (!conv) throw new TibiError('not_found', '找不到这个对话');
      // 同一段对话一次只答一句：并发的回答会互相看不到对方的上下文
      const { active } = await convs().activity(p.conversation_id);
      if (active.length) throw new TibiError('busy', 'Tibi 还在回答上一句，说完再发');
      if (p.context) deps.setUiContext(p.context);
      const skill_id: SkillId = p.skill ?? 'tibi';
      await convs().addMessage(p.conversation_id, 'user', { text: p.text });
      const { task_id } = await deps.runner.submit('skill', { kind: 'skill', skill_id, conversation_id: p.conversation_id, title: p.text.slice(0, 40), trigger: 'user', input: { skill_id, input: p.text, conversation_id: p.conversation_id, tier: p.tier, provider_id: p.provider_id } });
      await deps.db.run('UPDATE messages SET job_id = ? WHERE conversation_id = ? AND role = ? AND job_id IS NULL', [task_id, p.conversation_id, 'user']);
      return { submission_id: task_id };
    }, '立即返回；文本增量与工具调用走事件'),
    'chat.list': method(Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }), async (p, _ctx) => convs().list(p.limit ?? 20), '左栏"最近"'),
    'chat.history': method(Type.Object({ conversation_id: Type.String(), cursor: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) }), async (p) => convs().history(p.conversation_id, p)),
    'chat.cancel': method(Type.Object({ submission_id: Type.String() }), async (p) => { await deps.runner.cancel(p.submission_id); return { ok: true as const }; }),
    'chat.widget_update': method(Type.Object({ message_id: Type.String(), widget_id: Type.String(), state: Type.Unknown(), result: Type.Optional(Type.String({ maxLength: 300 })) }), async (p) => {
      if (JSON.stringify(p.state ?? null).length > 8000) throw new TibiError('invalid_params', '卡片状态太大');
      await convs().updateWidget(p.message_id, p.widget_id, p.state, p.result);
      return { ok: true as const };
    }, '保存卡片上的操作结果'),
    'chat.rewind': method(Type.Object({ conversation_id: Type.String(), message_id: Type.String() }), async (p) => {
      const { active } = await convs().activity(p.conversation_id);
      if (active.length) throw new TibiError('busy', 'Tibi 还在回答，说完再改');
      const { text, job_id } = await convs().rewind(p.conversation_id, p.message_id);
      const job = job_id ? await deps.db.get<{ skill_id: SkillId | null }>('SELECT skill_id FROM jobs WHERE id = ?', [job_id]) : undefined;
      return { text, skill: job?.skill_id ?? undefined };
    }, '回到这句话之前：这条和之后的消息作废，已写入的词不动；返回原话和当时用的技能'),
    'chat.receipt_undone': method(Type.Object({ message_id: Type.String(), undo_id: Type.String() }), async (p) => {
      await convs().markUndone(p.message_id, p.undo_id);
      return { ok: true as const };
    }, '记下用户撤销了回答里的哪次写入'),
    'chat.rename': method(Type.Object({ conversation_id: Type.String(), title: Type.String({ minLength: 1 }) }), async (p) => convs().rename(p.conversation_id, p.title)),
    'chat.delete': method(Type.Object({ conversation_id: Type.String() }), async (p) => {
      // 先停掉这段对话还在跑的任务，否则回答写回时对话已经没了
      const active = await deps.db.all<{ id: string }>("SELECT id FROM jobs WHERE conversation_id = ? AND status IN ('queued', 'running', 'waiting_approval', 'paused')", [p.conversation_id]);
      await Promise.all(active.map(a => deps.runner.cancel(a.id)));
      await convs().delete(p.conversation_id);
      return { ok: true as const };
    }, '硬删，不可撤销；进行中的任务会被取消'),
  };
}

export function taskMethods(deps: KernelMethodDeps): MethodMap {
  const { db, runner } = deps;
  const summaries = async (ids: string[]) => (await Promise.all(ids.map(id => runner.summary(id)))).filter((s): s is TaskSummary => !!s);
  return {
    'tasks.list': method(Type.Object({ state: Type.Optional(Type.Array(stateSchema)), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) }), async (p) => {
      const limit = p.limit ?? 50;
      const runningRows = await db.all<{ id: string }>("SELECT id FROM jobs WHERE status IN ('queued', 'running', 'waiting_approval', 'paused') AND deleted_at IS NULL AND parent_job_id IS NULL ORDER BY created_at DESC");
      const pendingRows = await db.all<{ approval: string }>("SELECT approval FROM jobs WHERE status = 'waiting_approval' AND approval IS NOT NULL AND deleted_at IS NULL ORDER BY updated_at");
      const historyRows = await db.all<{ id: string }>("SELECT id FROM jobs WHERE status IN ('done', 'failed', 'cancelled', 'deferred') AND deleted_at IS NULL AND parent_job_id IS NULL ORDER BY finished_at DESC LIMIT ?", [limit]);
      const weekAgo = now() - 7 * 86400_000;
      const week = await db.get<{ done: number; failed: number }>("SELECT sum(status = 'done') AS done, sum(status = 'failed') AS failed FROM jobs WHERE finished_at >= ?", [weekAgo]);
      const month = await db.get<{ c: number | null }>('SELECT sum(cost) AS c FROM usage_records WHERE created_at >= ?', [monthStart()]);
      const top = await db.get<{ skill_id: string | null; c: number }>('SELECT skill_id, sum(cost) AS c FROM usage_records WHERE created_at >= ? GROUP BY skill_id ORDER BY c DESC LIMIT 1', [monthStart()]);
      const b = await budgets(db);
      let running = await summaries(runningRows.map(r => r.id));
      let history = await summaries(historyRows.map(r => r.id));
      if (p.state?.length) { const set = new Set(p.state); running = running.filter(s => set.has(s.state)); history = history.filter(s => set.has(s.state)); }
      return {
        running, pending: pendingRows.map(r => j.parse<Approval | null>(r.approval, null)).filter((a): a is Approval => !!a && !('decision' in a)), history,
        kpis: { running: running.length, week_done: Number(week?.done ?? 0), week_failed: Number(week?.failed ?? 0), month_cost: Number(month?.c ?? 0), budget: b.month, top_skill: { id: (top?.skill_id ?? 'tibi') as SkillId, cost: Number(top?.c ?? 0) } },
      };
    }, '一次取齐页面所需'),
    'tasks.get': method(Type.Object({ id: Type.String() }), async (p): Promise<Task> => {
      const s = await runner.summary(p.id);
      if (!s) throw new TibiError('not_found', '找不到这个任务');
      const row = await db.get<{ conversation_id: string | null; approval: string | null; status: string }>('SELECT conversation_id, approval, status FROM jobs WHERE id = ?', [p.id]);
      const usage = await db.get<{ i: number | null; o: number | null; c: number | null }>('SELECT sum(input_tokens + cached_tokens) AS i, sum(output_tokens) AS o, sum(cost) AS c FROM usage_records WHERE job_id = ?', [p.id]);
      const transcript: Message[] = row?.conversation_id ? (await new Conversations(db).history(row.conversation_id, { limit: 200 })).items.filter(m => m.task_id === p.id || !m.task_id) : [];
      const approval = row?.status === 'waiting_approval' ? j.parse<Approval | null>(row.approval, null) ?? undefined : undefined;
      return { ...s, conversation_id: row?.conversation_id ?? '', steps: await runner.steps(p.id), transcript, usage: { tokens_in: Number(usage?.i ?? 0), tokens_out: Number(usage?.o ?? 0), cost: Number(usage?.c ?? 0) }, approval: approval && !('decision' in approval) ? approval : undefined };
    }, '详情抽屉'),
    'tasks.pause': method(Type.Object({ id: Type.String() }), async (p) => { await runner.pause(p.id); return (await runner.summary(p.id))!; }, '完成当前步骤后停下'),
    'tasks.resume': method(Type.Object({ id: Type.String() }), async (p) => { await runner.resume(p.id); return (await runner.summary(p.id))!; }),
    'tasks.cancel': method(Type.Object({ id: Type.String() }), async (p) => { await runner.cancel(p.id); return (await runner.summary(p.id))!; }, '已完成步骤保留'),
    'tasks.retry': method(Type.Object({ id: Type.String() }), async (p) => { await runner.retry(p.id); return (await runner.summary(p.id))!; }, '从失败的那一步继续'),
    'tasks.approve': method(Type.Object({ id: Type.String(), decision: Type.Union([Type.Literal('allow'), Type.Literal('deny'), Type.Literal('edit')]), edited: Type.Optional(Type.Record(Type.String(), Type.Unknown())), always: Type.Optional(Type.Boolean()) }), async (p) => {
      await runner.approve(p.id, p.decision, p.edited, p.always);
      return (await runner.summary(p.id))!;
    }, '解除挂起；always 写入该工具的自动允许规则（对读过不可信内容的任务不生效）'),
    'tasks.diagnostics': method(Type.Object({ id: Type.String() }), async (p) => {
      const row = await db.get<{ id: string; kind: string; skill_id: string | null; status: string; pipeline: string; trigger: string; error: string | null; created_at: number; started_at: number | null; finished_at: number | null; tainted: number }>('SELECT id, kind, skill_id, status, pipeline, trigger, error, created_at, started_at, finished_at, tainted FROM jobs WHERE id = ?', [p.id]);
      if (!row) throw new TibiError('not_found', '找不到这个任务');
      const steps = await db.all<{ idx: number; kind: string; name: string; status: string; error: string | null; started_at: number; finished_at: number | null }>('SELECT idx, kind, name, status, error, started_at, finished_at FROM job_steps WHERE job_id = ? ORDER BY idx', [p.id]);
      const usage = await db.all<{ model: string; input_tokens: number; output_tokens: number; cost: number }>('SELECT model, input_tokens, output_tokens, cost FROM usage_records WHERE job_id = ?', [p.id]);
      // 不含密钥、正文、参数内容：只有结构与时间
      const lines = [`Tibi 任务诊断`, `id: ${row.id}`, `kind: ${row.kind}  skill: ${row.skill_id ?? '-'}  pipeline: ${row.pipeline}  trigger: ${row.trigger}`, `status: ${toState(row.status)} (${row.status})  tainted: ${row.tainted}`, `created: ${new Date(row.created_at).toISOString()}  started: ${row.started_at ? new Date(row.started_at).toISOString() : '-'}  finished: ${row.finished_at ? new Date(row.finished_at).toISOString() : '-'}`, `error: ${row.error ?? '-'}`, '', '步骤：',
        ...steps.map(s => `  ${s.idx}. [${s.kind}] ${s.name}  ${s.status}  ${s.finished_at ? s.finished_at - s.started_at : '?'}ms${s.error ? `  错误：${s.error}` : ''}`), '', '用量：', ...usage.map(u => `  ${u.model}  in ${u.input_tokens}  out ${u.output_tokens}  ¥${u.cost.toFixed(4)}`)];
      return { text: lines.join('\n') };
    }, '复制诊断信息（不含密钥与正文）'),
  };
}

export type { Ctx };
