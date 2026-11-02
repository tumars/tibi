import { Type } from '@sinclair/typebox';
import { j } from '../db/driver.js';
import { capability, validateParams, type CapabilityMap, type Ctx } from '../rpc/define.js';
import { TibiError, type AskOption, type AskResult, type AskState, type SkillId, type WidgetSpec } from '../types.js';
import type { CapabilityRegistry } from './capabilities.js';
import { Conversations } from './conversations.js';
import { submitTurn, type KernelMethodDeps } from './methods.js';

/**
 * 反问（ask_user）：问完就结束这一轮，问题存成对话里的卡片，等多久都行、重启也还在。
 * 用户点选后，选项绑定的动作由内核直接执行（模型换不了网址），其余情况当成用户的下一句话接着开一轮。
 */
const optionSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 400 })),
  action: Type.Optional(Type.Object({ tool: Type.String(), params: Type.Unknown() }, { description: '用户选了就直接执行的操作，只能绑定允许的能力（目前是 import_document 的网址导入）' })),
});

export function askCapabilities(deps: { registry: CapabilityRegistry }): CapabilityMap {
  return {
    ask_user: capability({
      name: 'ask_user', description: '向用户提问或请用户确认，显示成带选项的卡片；调用后这一轮结束，用户的回答会作为下一轮到来', perm: 'read', mcp: false, terminal: true,
      params: Type.Object({ question: Type.String({ minLength: 1, maxLength: 300 }), options: Type.Array(optionSchema, { minItems: 1, maxItems: 6 }), multi: Type.Optional(Type.Boolean({ description: '能不能多选' })) }),
      async run(p, ctx): Promise<{ status: string; ask: WidgetSpec }> {
        const row = ctx.caller.job_id ? await ctx.db.get<{ id: string; conversation_id: string | null; parent_job_id: string | null; tainted: number; input: string }>('SELECT id, conversation_id, parent_job_id, tainted, input FROM jobs WHERE id = ?', [ctx.caller.job_id]) : undefined;
        if (!row || (!row.conversation_id && !row.parent_job_id)) throw new TibiError('conflict', '这里没有对话，问不了用户。按最合理的方式继续，并在结果里说明');
        let seen: string | undefined;
        const options: AskOption[] = [];
        for (const [i, o] of p.options.entries()) {
          const opt: AskOption = { id: `o${i + 1}`, label: o.label, ...(o.description ? { description: o.description } : {}) };
          if (o.action) {
            const def = deps.registry.get(o.action.tool);
            if (!def?.askable) throw new TibiError('permission_denied', `${o.action.tool} 不能绑到选项上`);
            const { preview, urls } = def.askable(validateParams(def.params, o.action.params));
            if (urls?.length) {
              // 只能是这次真的查到的或用户自己给的网址，模型编的、网页里塞的改写都过不去
              seen ??= row.input + (await ctx.db.all<{ output: string | null }>("SELECT output FROM job_steps WHERE job_id = ? AND kind = 'tool' AND status = 'done'", [row.id])).map(s => s.output ?? '').join('\n');
              const unknown = urls.find(u => !seen!.includes(u));
              if (unknown) throw new TibiError('invalid_params', `这个网址不在这次的查询结果里：${unknown}。只用工具返回的原始链接`);
            }
            opt.action = { tool: o.action.tool, params: o.action.params, preview };
          }
          options.push(opt);
        }
        // summary 进后续对话历史（工具结果不进）：要写全，用户说"第二篇"时模型才接得上
        const brief = options.map((o, i) => `${i + 1}. ${o.label}${o.action ? `（${o.action.preview}）` : ''}`).join(' ');
        return { status: '已经显示给用户了，等用户回答', ask: { kind: 'ask', summary: `Tibi 问：${p.question} ${brief}`, data: { question: p.question, multi: !!p.multi, options, untrusted: !!row.tainted } } };
      },
      widget: r => r.ask,
    }),
  };
}

export async function answerAsk(deps: KernelMethodDeps, p: { message_id: string; widget_id: string; option_ids: string[]; text?: string }, ctx: Ctx): Promise<{ state: AskState; submission_id?: string }> {
  const convs = new Conversations(deps.db);
  const text = p.text?.trim() || undefined;
  const conv = await deps.db.get<{ conversation_id: string }>('SELECT conversation_id FROM messages WHERE id = ? AND deleted_at IS NULL', [p.message_id]);
  if (!conv) throw new TibiError('not_found', '找不到这条消息');
  const { active } = await convs.activity(conv.conversation_id);
  if (active.length) throw new TibiError('busy', 'Tibi 还在回答，说完再选');
  const { conversation_id, job_id, data, picked, state: claimed } = await convs.claimAsk(p.message_id, p.widget_id, p.option_ids, text);

  const results: AskResult[] = [];
  for (const o of picked) {
    if (!o.action) continue;
    try {
      // 再过一遍校验（消息可能来自同步或旧版本）；这是用户自己点的，按界面操作执行
      const def = deps.registry.get(o.action.tool);
      if (!def?.askable) throw new TibiError('permission_denied', `${o.action.tool} 不能绑到选项上`);
      def.askable(validateParams(def.params, o.action.params));
      const out = await deps.registry.call<{ task_id?: string }>(o.action.tool, o.action.params, { ...ctx, caller: { origin: 'ui' } });
      results.push({ option_id: o.id, ok: true, message: o.action.preview, ...(out?.task_id ? { task_id: out.task_id } : {}) });
    } catch (e) {
      results.push({ option_id: o.id, ok: false, message: `${o.action.preview}（${e instanceof Error ? e.message : String(e)}）` });
    }
  }
  const state = results.length ? await convs.finishAsk(p.message_id, p.widget_id, results) : claimed;

  // 全是绑定好的动作、没有补充：不用再调模型
  if (!text && picked.every(o => o.action)) return { state };
  const job = job_id ? await deps.db.get<{ skill_id: string | null; input: string }>('SELECT skill_id, input FROM jobs WHERE id = ?', [job_id]) : undefined;
  const prev = j.parse<{ tier?: 'fast' | 'deep'; provider_id?: string }>(job?.input, {});
  const said = [picked.length ? `我选：${picked.map(o => o.label).join('、')}` : '', text ?? ''].filter(Boolean).join('\n');
  const submission_id = await submitTurn(deps, conversation_id, said, { skill_id: (job?.skill_id ?? 'tibi') as SkillId, tier: prev.tier, provider_id: prev.provider_id, tainted: data.untrusted });
  return { state, submission_id };
}

