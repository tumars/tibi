import type { SkillId } from '@tibi/core';
import { tl } from './i18n';

/**
 * 首页输入框的 / 动作（00 §3.5）：列表是动词不是角色。
 * empty = 不打字直接发送时用的问题；没有 empty 的动作必须有输入（导入要内容，讲解要有讲的东西）。
 */
export type ActionId = Exclude<SkillId, 'tibi'>;
export interface SlashAction { id: ActionId; title: string; slash: string; desc: string; placeholder: string; empty?: string }

export const ACTIONS: SlashAction[] = [
  { id: 'importer', title: tl('导入文章'), slash: tl('导入'), desc: tl('网址、文字、PDF、EPUB、图片'), placeholder: tl('粘贴网址或文字，或把文件拖进来') },
  { id: 'scout', title: tl('找文章'), slash: tl('找文章'), desc: tl('按你的水平和兴趣推荐'), placeholder: tl('想读什么？例如"10 分钟左右的科技新闻"'), empty: tl('按我的水平和兴趣推荐一篇文章') },
  { id: 'tutor', title: tl('讲解'), slash: tl('讲解'), desc: tl('一句话、一个词、一段语法'), placeholder: tl('贴一句话或一个词，Tibi 来讲') },
  { id: 'coach', title: tl('出题与批改'), slash: tl('出题'), desc: tl('用你的生词出练习，不影响复习排期'), placeholder: tl('出什么题？例如"这周的生词，10 道填空"'), empty: tl('用我最近的生词出几道题') },
  { id: 'insight', title: tl('学习洞察'), slash: tl('学习洞察'), desc: tl('看看最近的进步和薄弱点'), placeholder: tl('想看什么？例如"最近一个月进步在哪"'), empty: tl('看看我最近的进步和薄弱点') },
  { id: 'archivist', title: tl('整理记忆'), slash: tl('整理记忆'), desc: tl('整理 Tibi 对你的了解'), placeholder: tl('要 Tibi 记住或整理什么？'), empty: tl('整理最近的学习事件和对话，更新记忆') },
];

/** 输入框整段是 "/xxx"（还没有空格）时返回 xxx，菜单据此打开；其余情况（含 /usr/bin 这样的路径）返回 undefined */
export function slashQuery(text: string): string | undefined {
  return /^\/([^\s/]*)$/.exec(text)?.[1];
}

export function matchActions(query: string, actions: SlashAction[] = ACTIONS): SlashAction[] {
  const q = query.toLowerCase();
  return actions.filter(a => !q || a.id.includes(q) || a.slash.toLowerCase().includes(q) || a.title.toLowerCase().includes(q));
}

/** 手打完整的 "/讲解 这句话"：拆成动作和内容；不是已知动作就返回 undefined，当普通输入处理 */
export function parseSlash(text: string, actions: SlashAction[] = ACTIONS): { action: SlashAction; rest: string } | undefined {
  const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return undefined;
  const name = m[1]!.toLowerCase();
  const action = actions.find(a => a.slash.toLowerCase() === name || a.title.toLowerCase() === name);
  return action && { action, rest: (m[2] ?? '').trim() };
}
