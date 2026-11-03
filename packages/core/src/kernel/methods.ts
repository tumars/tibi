import { Type } from '@sinclair/typebox';
import { now, type Database } from '../db/driver.js';
import { method, type Ctx, type MethodMap } from '../rpc/define.js';
import { TibiError, type SkillId } from '../types.js';
import type { CapabilityRegistry, UiContext } from './capabilities.js';
import { Conversations } from './conversations.js';
import { answerAsk, askingIn } from './ask.js';
import { skillIdSchema } from './skills.js';
import { attachmentFor } from './agent.js';
import type { AgentEngine } from './engine.js';
import type { Turns } from './turns.js';

/** chat.* 与 approvals.*（06 §3） */

export interface TurnOptions { skill_id: SkillId; tier?: 'fast' | 'deep'; provider_id?: string }
export interface KernelMethodDeps {
  db: Database; turns: Turns; registry: CapabilityRegistry; setUiContext: (c: UiContext | undefined) => void; engine?: AgentEngine;
  /** 让已经写进库的这一轮（第一句用户消息）跑起来 */
  startTurn: (conversation_id: string, turn_id: string, o: TurnOptions & { tainted?: boolean }) => void;
}

/** 写下用户这句话（原话 + 提问时的附件），开一轮回答；返回 turn_id */
export async function submitTurn(deps: Pick<KernelMethodDeps, 'db' | 'startTurn'>, conversation_id: string, text: string, o: TurnOptions & { attachment?: { text: string; label: string } }): Promise<string> {
  const convs = new Conversations(deps.db);
  const tainted = await convs.tainted(conversation_id);
  const msg = await convs.addUser(conversation_id, text, { attachment: o.attachment, skill: o.skill_id, tainted });
  deps.startTurn(conversation_id, msg.id, { ...o, tainted });
  return msg.id;
}

/** 对话之外的事写成 note，会话在内存里就交给引擎 */
async function tellEngine(deps: KernelMethodDeps, conversation_id: string, text: string) {
  const note = await new Conversations(deps.db).addNote(conversation_id, text);
  deps.engine?.note(conversation_id, note.text, note.id);
}

export function chatMethods(deps: KernelMethodDeps): MethodMap {
  const convs = () => new Conversations(deps.db);
  return {
    'chat.open': method(Type.Object({ conversation_id: Type.Optional(Type.String()), document_id: Type.Optional(Type.String()), today: Type.Optional(Type.Boolean()) }), async (p, ctx) => {
      const c = await convs().open({ ...p, device: ctx.platform.info().platform === 'ios' || ctx.platform.info().platform === 'android' ? 'mobile' : 'desktop' });
      const { items, cursor } = await convs().history(c.id, { limit: 50 });
      return { ...c, messages: items, cursor, ...convs().activity(c.id, deps.turns) };
    }, '给 document_id 时续上该文章的线程；today 为 true 时打开或新建当天的对话；都不给则新建'),
    'chat.send': method(Type.Object({
      conversation_id: Type.String(), text: Type.String({ minLength: 1 }),
      context: Type.Optional(Type.Object({ page: Type.String(), document_id: Type.Optional(Type.String()), section_id: Type.Optional(Type.String()), sentence_id: Type.Optional(Type.String()), selection: Type.Optional(Type.String()), card_id: Type.Optional(Type.String()) })),
      skill: Type.Optional(skillIdSchema), tier: Type.Optional(Type.Union([Type.Literal('fast'), Type.Literal('deep')])), provider_id: Type.Optional(Type.String()),
    }), async (p, ctx) => {
      const conv = await convs().get(p.conversation_id);
      if (!conv) throw new TibiError('not_found', '找不到这个对话');
      if (p.context) deps.setUiContext(p.context);
      const attachment = await attachmentFor(deps.db, p.context);
      // 正在回答时又说了一句：插进当前这次回答（引擎在下一轮前带给模型），不另开一次
      // Tibi 在等用户回答反问：这句话就是回答
      const asking = askingIn(p.conversation_id);
      const active = deps.turns.activeIn(p.conversation_id);
      if (asking && active.length) {
        answerAsk({ widget_id: asking, option_ids: [], text: p.text });
        return { submission_id: active[active.length - 1]!, steered: true, answered: true };
      }
      if (active.length) {
        const turn_id = active[active.length - 1]!;
        const msg = await convs().addUser(p.conversation_id, p.text, { attachment, turn_id });
        const content = attachment ? `${p.text}\n\n<attachment>${attachment.text}</attachment>` : p.text;
        if (deps.engine?.steer(p.conversation_id, content, msg.id)) return { submission_id: turn_id, steered: true };
        await deps.db.run('UPDATE messages SET deleted_at = ?, updated_at = ? WHERE id = ?', [now(), now(), msg.id]);
        throw new TibiError('busy', 'Tibi 还在回答上一句，说完再发');
      }
      const skill_id: SkillId = p.skill ?? 'tibi';
      return { submission_id: await submitTurn(deps, p.conversation_id, p.text, { skill_id, tier: p.tier, provider_id: p.provider_id, attachment }) };
    }, '立即返回；文本增量与工具调用走事件。正在回答时再发，插进当前回答（steered = true）；Tibi 在等反问的回答时，这句就是回答（answered = true）'),
    'chat.answer': method(Type.Object({ widget_id: Type.String(), option_ids: Type.Array(Type.String(), { maxItems: 8 }), text: Type.Optional(Type.String({ maxLength: 2000 })) }), async p => answerAsk(p), '回答反问卡：回答交给正在等的 ask_user，Tibi 在这一轮里接着做'),
    'chat.list': method(Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }), async (p, _ctx) => convs().list(p.limit ?? 20), '左栏"最近"'),
    'chat.history': method(Type.Object({ conversation_id: Type.String(), cursor: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) }), async (p) => convs().history(p.conversation_id, p)),
    'chat.cancel': method(Type.Object({ submission_id: Type.String() }), async (p) => { await deps.turns.cancel(p.submission_id); return { ok: true as const }; }, '停止这一轮回答（submission_id 就是 turn_id）'),
    'chat.retry': method(Type.Object({ conversation_id: Type.String(), turn_id: Type.String() }), async (p) => {
      if (deps.turns.activeIn(p.conversation_id).length) throw new TibiError('busy', 'Tibi 还在回答，说完再试');
      const turn = await convs().turn(p.turn_id);
      if (!turn || turn.conversation_id !== p.conversation_id) throw new TibiError('not_found', '找不到这一轮');
      if (turn.state !== 'error' && turn.state !== 'cancel') throw new TibiError('conflict', '这一轮已经答完了');
      await convs().dropAnswer(p.conversation_id, p.turn_id);
      await convs().setTurn(p.turn_id, { state: 'running' });
      deps.engine?.invalidate(p.conversation_id);
      deps.startTurn(p.conversation_id, p.turn_id, { skill_id: turn.skill, tainted: turn.tainted });
      return { submission_id: p.turn_id };
    }, '停止或出错的那一轮重新回答：上次说了一半的作废，用户的话（含回答中补充的）留着'),
    'chat.widget_update': method(Type.Object({ message_id: Type.String(), widget_id: Type.String(), state: Type.Unknown(), result: Type.Optional(Type.String({ maxLength: 300 })) }), async (p) => {
      if (JSON.stringify(p.state ?? null).length > 8000) throw new TibiError('invalid_params', '卡片状态太大');
      await convs().updateWidget(p.message_id, p.widget_id, p.state, p.result);
      // 用户在卡片上做了什么，下一轮模型要知道
      if (p.result) {
        const row = await deps.db.get<{ conversation_id: string }>('SELECT conversation_id FROM messages WHERE id = ?', [p.message_id]);
        if (row) await tellEngine(deps, row.conversation_id, `用户在卡片上：${p.result}`);
      }
      return { ok: true as const };
    }, '保存卡片上的操作结果'),
    'chat.rewind': method(Type.Object({ conversation_id: Type.String(), message_id: Type.String() }), async (p) => {
      if (deps.turns.activeIn(p.conversation_id).length) throw new TibiError('busy', 'Tibi 还在回答，说完再改');
      const r = await convs().rewind(p.conversation_id, p.message_id);
      deps.engine?.invalidate(p.conversation_id);
      return r;
    }, '回到这句话之前：这条和之后的消息作废，已写入的词不动；返回原话和当时用的技能'),
    'chat.receipt_undone': method(Type.Object({ message_id: Type.String(), undo_id: Type.String() }), async (p) => {
      const r = await convs().markUndone(p.message_id, p.undo_id);
      if (r.note) deps.engine?.note(r.conversation_id, r.note.text, r.note.id);
      return { ok: true as const };
    }, '记下用户撤销了回答里的哪次写入'),
    'chat.rename': method(Type.Object({ conversation_id: Type.String(), title: Type.String({ minLength: 1 }) }), async (p) => convs().rename(p.conversation_id, p.title)),
    'chat.delete': method(Type.Object({ conversation_id: Type.String() }), async (p) => {
      // 先停掉这段对话还在跑的回答，否则回答写回时对话已经没了
      await Promise.all(deps.turns.activeIn(p.conversation_id).map(id => deps.turns.cancel(id)));
      deps.engine?.invalidate(p.conversation_id);
      await convs().delete(p.conversation_id);
      return { ok: true as const };
    }, '硬删，不可撤销；进行中的回答会被停掉'),
  };
}

export function approvalMethods(deps: Pick<KernelMethodDeps, 'turns'>): MethodMap {
  return {
    'approvals.list': method(Type.Object({ conversation_id: Type.Optional(Type.String()) }), async p => deps.turns.approvals(p.conversation_id ?? null), '等确认的操作；不给 conversation_id 时是不在对话里的（外部工具来的）'),
    'approvals.decide': method(Type.Object({ id: Type.String(), decision: Type.Union([Type.Literal('allow'), Type.Literal('deny'), Type.Literal('edit')]), edited: Type.Optional(Type.Record(Type.String(), Type.Unknown())), always: Type.Optional(Type.Boolean()) }), async p => {
      await deps.turns.decide(p.id, p.decision, p.edited, p.always);
      return { ok: true as const };
    }, 'always 写入该工具的自动允许规则（对读过不可信内容的那一轮不生效）'),
  };
}

export type { Ctx };
