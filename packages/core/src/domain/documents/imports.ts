import { uuidv7 } from '../../ids.js';
import type { Ctx } from '../../rpc/define.js';
import { runImport, type ImportInput } from './pipeline.js';

/**
 * 后台在做的事（只在内存里）：导入一篇文章，以及导入后的总结、翻译、重新分析。
 * 导入有 import_id：进度走 import.progress，结束走 import.done，对话里起的导入结束后由内核通知那段对话。
 * 其余的结果写在文章上（documents.ai_status、sentences.translation），界面按 data.changed 刷新。
 */

export type ImportOutcome =
  | { ok: true; document_id: string; duplicate: boolean; title: string; summary: string; action: { label: string; route: string }; level?: string; minutes: number }
  | { ok: false; error: string };

const imports = new Map<string, { title: string; done: Promise<ImportOutcome> }>();
/** 刚结束的几次：结果可能比调用方拿到 import_id 还早 */
const finished = new Map<string, ImportOutcome>();
const work = new Set<Promise<unknown>>();
const keyed = new Map<string, Promise<unknown>>();

/** 开始导入，立即返回 import_id；done 在导入结束（成功或失败）时兑现，不会 reject */
export function startImport(ctx: Ctx, input: ImportInput, title: string): { import_id: string; done: Promise<ImportOutcome> } {
  const id = uuidv7();
  const origin = input.origin ?? 'user';
  ctx.events.emit('import.progress', { import_id: id, title, label: '排队', origin });
  const run = { id, progress: (label: string) => ctx.events.emit('import.progress', { import_id: id, title, label, origin }) };
  const done = runImport(run, ctx, input).then(
    (r): ImportOutcome => ({ ok: true, ...r }),
    (e): ImportOutcome => ({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  ).then(r => {
    ctx.events.emit('import.done', { import_id: id, title: r.ok ? r.title : title, origin, ...r });
    imports.delete(id);
    finished.set(id, r);
    if (finished.size > 50) finished.delete(finished.keys().next().value!);
    return r;
  });
  imports.set(id, { title, done });
  track(done);
  return { import_id: id, done };
}

/** 这次导入的结果：还在导入的结束时兑现；刚结束的直接给；没有这次导入时是 undefined */
export function importDone(import_id: string): Promise<ImportOutcome> | undefined {
  const f = finished.get(import_id);
  return f ? Promise.resolve(f) : imports.get(import_id)?.done;
}
export function importTitle(import_id: string): string | undefined { return imports.get(import_id)?.title; }

/** 在后台跑；同一个 key 正在跑时不再起第二个（同一篇文章的总结只做一份） */
export function background(key: string, fn: () => Promise<unknown>): boolean {
  if (keyed.has(key)) return false;
  const p = fn().catch(e => { console.error('[documents] 后台处理失败', key, e); }).finally(() => keyed.delete(key));
  keyed.set(key, p);
  track(p);
  return true;
}

export function isRunning(key: string) { return keyed.has(key); }

function track(p: Promise<unknown>) { work.add(p); void p.finally(() => work.delete(p)); }

/** 等后台的事都做完（测试用；导入后的总结也算） */
export async function idle(): Promise<void> {
  while (work.size) await Promise.allSettled([...work]);
}
