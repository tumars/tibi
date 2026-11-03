import { Type } from '@sinclair/typebox';
import { capability, type CapabilityMap } from '../rpc/define.js';
import { TibiError, type AskData, type AskOption, type AskState, type WidgetBlock } from '../types.js';
import { askResultText, presenters } from './conversations.js';
import type { Turns } from './turns.js';

/**
 * 反问（ask_user）：和其他工具一样在这一轮里执行。卡片先显示出来，工具原地等用户回答，回答就是工具结果，模型接着做。
 * - 选项带 url（文章链接）时，用户选中的网址这一轮导入不再审批；模型换了网址照常审批。
 * - 用户不点卡片、直接在输入框说话，也算回答这个问题。
 * - 等待只在进程里：应用重启后这一轮记成中断，卡片作废。
 */
const optionSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 400 })),
  url: Type.Optional(Type.String({ maxLength: 2000, description: '这一项对应的文章链接（工具返回的原始链接）；用户选了它，导入时不用再确认' })),
});

interface Waiting { conversation_id: string; turn_id: string; block: WidgetBlock & { kind: 'ask' }; resolve(text: string): void }
/** 等用户回答的卡片：卡片 ID → 那次工具调用 */
const waiting = new Map<string, Waiting>();
/** 用户在卡片上选过的网址：turn_id → 网址（子技能和主对话在同一轮里，共用一份） */
const chosen = new Map<string, Set<string>>();

/** 这个网址是用户在这一轮的卡片上选的 */
export function isChosen(turn_id: string | undefined, url: string): boolean { return !!turn_id && !!chosen.get(turn_id)?.has(url); }
export function forgetChoices(turn_id: string) { chosen.delete(turn_id); }
/** 用户自己选的网址（卡片上点的、自己发来的）：这一轮导入不再审批 */
export function choose(turn_id: string, url: string) { let s = chosen.get(turn_id); if (!s) chosen.set(turn_id, s = new Set()); s.add(url); }
/** 这段对话里正在等回答的卡片 */
export function askingIn(conversation_id: string): string | undefined { return [...waiting.entries()].find(([, w]) => w.conversation_id === conversation_id)?.[0]; }

export function askCapabilities(deps: { turns: Turns }): CapabilityMap {
  return {
    ask_user: capability({
      name: 'ask_user', description: '向用户提问或请用户确认，显示成带选项的卡片，等用户回答；返回用户选了什么、说了什么', perm: 'read', mcp: false,
      params: Type.Object({ question: Type.String({ minLength: 1, maxLength: 300 }), options: Type.Array(optionSchema, { minItems: 1, maxItems: 6 }), multi: Type.Optional(Type.Boolean({ description: '能不能多选' })) }),
      async run(p, ctx): Promise<{ answer: string }> {
        const run = deps.turns.get(ctx.caller.turn_id);
        const show = ctx.caller.turn_id ? presenters.get(ctx.caller.turn_id) : undefined;
        if (!run || !show) throw new TibiError('conflict', '这里没有对话，问不了用户。按最合理的方式继续，并在结果里说明');
        const options: AskOption[] = [];
        for (const [i, o] of p.options.entries()) {
          // 只能是这一轮真的查到的或用户自己给的网址，模型编的、网页里塞的改写都过不去
          if (o.url && !run.seen.some(t => t.includes(o.url!))) throw new TibiError('invalid_params', `这个网址不在这次的查询结果里：${o.url}。只用工具返回的原始链接`);
          options.push({ id: `o${i + 1}`, label: o.label, ...(o.description ? { description: o.description } : {}), ...(o.url ? { url: o.url } : {}) });
        }
        const data: AskData = { question: p.question, multi: !!p.multi, options, untrusted: run.tainted };
        // summary 进后续对话历史：要写全，用户说"第二篇"时模型才接得上
        const brief = options.map((o, i) => `${i + 1}. ${o.label}`).join(' ');
        const shown = show({ kind: 'ask', summary: `Tibi 问：${p.question} ${brief}`, data }, ctx.caller.depth ? undefined : ctx.caller.call_id);
        if (!shown) throw new TibiError('conflict', '卡片没能显示出来，按最合理的方式继续');
        const block = shown.block as Waiting['block'];
        const answer = await new Promise<string>((resolve, reject) => {
          waiting.set(block.id, { conversation_id: shown.conversation_id, turn_id: run.id, block, resolve });
          run.signal.addEventListener('abort', () => { waiting.delete(block.id); block.state = { expired: true } satisfies AskState; reject(new TibiError('busy', '已取消')); }, { once: true });
        });
        return { answer };
      },
    }),
  };
}

/** 用户回答反问卡（点选项、写补充，或直接在输入框说话） */
export function answerAsk(p: { widget_id: string; option_ids: string[]; text?: string }): { state: AskState } {
  const w = waiting.get(p.widget_id);
  if (!w) throw new TibiError('conflict', '这个问题已经过期了');
  const text = p.text?.trim() || undefined;
  const data = w.block.data;
  const picked = data.options.filter(o => p.option_ids.includes(o.id));
  if (picked.length !== new Set(p.option_ids).size) throw new TibiError('invalid_params', '没有这个选项');
  if (!picked.length && !text) throw new TibiError('invalid_params', '选一项或者写一句');
  if (picked.length > 1 && !data.multi) throw new TibiError('invalid_params', '这个问题只能选一项');
  waiting.delete(p.widget_id);
  const state: AskState = { answered: { option_ids: p.option_ids, ...(text ? { text } : {}), at: Date.now() } };
  w.block.state = state;
  w.block.result = askResultText(picked, text);
  for (const o of picked) if (o.url) { let s = chosen.get(w.turn_id); if (!s) chosen.set(w.turn_id, s = new Set()); s.add(o.url); }
  // 给模型的回答：带上链接，模型拿它去导入
  const said = [
    picked.length ? `用户选了：${picked.map(o => (o.url ? `${o.label}（${o.url}）` : o.label)).join('、')}` : '用户没有选任何一项',
    text ? `用户说：${text}` : '',
  ].filter(Boolean).join('\n');
  w.resolve(said);
  return { state };
}
