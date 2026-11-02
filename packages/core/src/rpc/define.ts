import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { Database } from '../db/driver.js';
import type { Dict } from '../dict/types.js';
import type { EventSink, JobRunner } from '../kernel/types.js';
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
  jobs: JobRunner;
  /** 调用方：界面 / 技能运行中的任务 / MCP */
  caller: { origin: 'ui' | 'skill' | 'mcp'; job_id?: string; job_step_id?: string; skill_id?: string; tainted?: boolean };
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

export type Perm = 'read' | 'write' | 'confirm';

export interface CapabilityDef<P extends TSchema = TSchema, R = unknown> {
  name: string;
  description: string;
  params: P;
  perm: Perm;
  /** 写能力是否可撤销（返回里带 undo） */
  undoable?: boolean;
  /** 崩溃重跑时能否安全重放（有幂等键的写能力 = safe） */
  replay?: 'never' | 'safe';
  run: (params: Static<P>, ctx: Ctx) => Promise<R>;
  /** 结果怎么显示成对话卡片；不适合显示时返回 undefined */
  widget?(result: R, params: Static<P>): WidgetSpec | undefined;
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
  status: Type.Union([0, 1, 2, 3, 4, 5, 97, 98, 99].map(n => Type.Literal(n))),
  kind: Type.Union([Type.Literal('article'), Type.Literal('book')]),
  genre: Type.Union(['tech', 'news', 'lit', 'academic', 'general'].map(s => Type.Literal(s))),
  cardType: Type.Union(['recognize', 'choice', 'cloze'].map(s => Type.Literal(s))),
  rating: Type.Union([1, 2, 3, 4].map(n => Type.Literal(n))),
  page: { cursor: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) },
};
