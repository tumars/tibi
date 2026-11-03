import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { Database } from '../db/driver.js';
import type { Dict } from '../dict/types.js';
import type { EventSink } from '../kernel/types.js';
import type { CompleteOptions, CompleteResult } from '../kernel/complete.js';
import type { Platform } from '../platform.js';
import { TibiError, type WidgetSpec } from '../types.js';

/**
 * 方法与能力的定义方式（06 §1、§5）：一份 TypeBox 参数 schema + 处理函数。
 * - JSON-RPC 方法：`method(params, handler)`，由 dispatcher 校验参数后调用。
 * - 能力：`capability({...})`，同一份定义生成技能工具（pi）、MCP 工具、界面直接调用。
 */

export interface Ctx {
  db: Database;
  dict: Dict;
  platform: Platform;
  events: EventSink;
  /**
   * 调用方：界面 / 技能 / MCP。turn_id 是进行中的那一轮回答（MCP 是那次调用）；call_id 是哪次工具调用；
   * depth = 1 是 run_skill 里的子技能
   */
  caller: { origin: 'ui' | 'skill' | 'mcp'; turn_id?: string; call_id?: string; skill_id?: string; depth?: number; tainted?: boolean };
  /** 当前权限模式（user_profile.assistant_prefs.permission） */
  permission(): Promise<'ask' | 'default' | 'auto'>;
  /** 一次性模型调用（语境释义、测试连接）；组装时由内核提供，单测里可以不给 */
  ai?: { complete(o: CompleteOptions): Promise<CompleteResult> };
  /** 方法之间互相调用（如 review.answer → record_review 能力） */
  call<T = unknown>(method: string, params: unknown): Promise<T>;
}

export interface MethodDef<P extends TSchema = TSchema, R = unknown> {
  params: P;
  handler: (params: Static<P>, ctx: Ctx) => Promise<R>;
  /** 说明（给 06 / 调试用） */
  doc?: string;
}

export function method<P extends TSchema, R>(params: P, handler: (params: Static<P>, ctx: Ctx) => Promise<R>, doc?: string): MethodDef<P, R> {
  return { params, handler, doc };
}

/** always：每次都问，全部自动和"以后都允许"都不放行；读过不可信内容的任务直接拒绝 */
export type Perm = 'read' | 'write' | 'confirm' | 'always';

export interface CapabilityDef<P extends TSchema = TSchema, R = unknown> {
  name: string;
  description: string;
  params: P;
  perm: Perm;
  /** 写能力是否可撤销（返回里带 undo） */
  undoable?: boolean;
  /** 不问用户直接写（记忆）：权限模式和读过网页都不拦，靠回执里的撤销兜底；必须 undoable */
  autoApprove?: true;
  run: (params: Static<P>, ctx: Ctx) => Promise<R>;
  /** 结果怎么显示成对话卡片；不适合显示时返回 undefined */
  widget?(result: R, params: Static<P>): WidgetSpec | undefined;
  /** 权限随参数变（如 set_config 按配置项分级）；不给就用 perm */
  permFor?(params: Static<P>): Perm;
  /** 审批卡正文：给人看的说明（如文章标题），不给就从参数里摘 */
  describe?(params: Static<P>, ctx: Ctx): Promise<string>;
  /** false：不对 MCP 开放（配置、反问这类只在应用里用的能力） */
  mcp?: false;
  /** 这次调用针对的网址：用户刚在反问卡上选中它时不再审批（模型换了网址就照常审批） */
  chosenUrl?(params: Static<P>): string | undefined;
}

export function capability<P extends TSchema, R>(def: CapabilityDef<P, R>): CapabilityDef<P, R> { return def; }

export type MethodMap = Record<string, MethodDef<any, any>>;
export type CapabilityMap = Record<string, CapabilityDef<any, any>>;

/** 校验并转换参数（缺省值、数字字符串等由 TypeBox 处理） */
export function validateParams<P extends TSchema>(schema: P, raw: unknown): Static<P> {
  const v = Value.Default(schema, Value.Clean(schema, structuredClone(raw ?? {})));
  const converted = Value.Convert(schema, v);
  if (!Value.Check(schema, converted)) {
    const first = Value.Errors(schema, converted).First();
    throw new TibiError('invalid_params', `参数不对：${first?.path ?? ''} ${first?.message ?? ''}`.trim(), { path: first?.path });
  }
  return converted as Static<P>;
}

/** 常用 schema 片段 */
export const S = {
  id: Type.String({ minLength: 1 }),
  ts: Type.Integer({ minimum: 0 }),
  status: Type.Union([0, 1, 2, 3, 4, 5, 97, 98].map(n => Type.Literal(n))),
  kind: Type.Union([Type.Literal('article'), Type.Literal('book')]),
  genre: Type.Union(['tech', 'news', 'lit', 'academic', 'general'].map(s => Type.Literal(s))),
  cardType: Type.Union(['recognize', 'choice', 'cloze'].map(s => Type.Literal(s))),
  rating: Type.Union([1, 2, 3, 4].map(n => Type.Literal(n))),
  page: { cursor: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) },
};
