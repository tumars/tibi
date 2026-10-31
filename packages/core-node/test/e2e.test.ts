import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Core, CoreEventName, DocumentSummary, ReviewSession, SectionContent, Status } from '@tibi/core';
import { createCore } from '../src/index.js';

/**
 * 端到端：真实内核（任务、检查点）+ 全部领域模块，在一个临时 app.db 上走一遍 M1 的最小闭环：
 * 导入一段文本 → 阅读（sections.get）→ 点生词（R5：自动见过 + 建卡）→ 复习（选义题作答）→ 统计。
 * 不带词典：词形还原退化为规则，生词判断按"无词频 = 生词"。
 */
const TEXT = `# Understanding Ownership in Rust

Ownership is the feature that makes Rust distinctive among systems languages. The upshot is memory safety without the runtime overhead.

\`\`\`rust
fn main() {}
\`\`\`

Each value has exactly one owner. When the owner goes out of scope, the value is dropped.`;

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

async function waitTask(core: Core, events: { event: CoreEventName; data: any }[], task_id: string) {
  for (let i = 0; i < 200; i++) {
    const done = events.find(e => e.event === 'task.done' && e.data?.task?.id === task_id);
    if (done) return done.data;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('任务没有完成');
}

describe('端到端：导入 → 阅读 → 点词 → 复习', () => {
  it('走通最小闭环', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tibi-e2e-'));
    const core = await createCore({ dbPath: join(dir, 'app.db'), version: 'test' });
    const events: { event: CoreEventName; data: any }[] = [];
    core.events.on((event, data) => events.push({ event, data }));

    // 方法都挂上了
    for (const m of ['documents.import', 'sections.get', 'terms.lookup', 'review.start', 'review.answer', 'stats.summary', 'chat.send', 'tasks.list', 'system.undo', 'profile.get', 'vocab.start']) {
      expect(core.dispatcher.has(m), m).toBe(true);
    }

    // 导入：走真的任务运行器，完成后发 task.done
    const { task_id } = await core.call<{ task_id: string }>('documents.import', { source: { type: 'text', text: TEXT } });
    const done = await waitTask(core, events, task_id);
    const document_id = done.result?.document_id as string;
    expect(document_id).toBeTruthy();
    const steps = await core.call<{ steps: { label: string; state: string }[] }>('tasks.get', { id: task_id });
    expect(steps.steps.length).toBeGreaterThan(3);
    expect(steps.steps.every(s => s.state === 'ok' || s.state === 'wait')).toBe(true);

    // 书架里能看到
    const list = await core.call<{ items: DocumentSummary[] }>('documents.list', {});
    expect(list.items.map(d => d.id)).toContain(document_id);

    // 阅读：代码块单独成块，句子带分词与状态
    const doc = await core.call<{ sections: { id: string }[] }>('documents.get', { id: document_id });
    const sec = await core.call<SectionContent>('sections.get', { id: doc.sections[0]!.id });
    expect(sec.blocks.some(b => b.type === 'code')).toBe(true);
    const upshotSentence = sec.sentences.find(s => s.text.includes('upshot'))!;
    const tok = upshotSentence.tokens.find(t => t.l === 'upshot')!;
    expect(tok).toBeTruthy();

    // 点词（R5）：生词自动变成"见过"并建卡
    const look = await core.call<{ status_change?: { from: Status; to: Status }; card_created?: boolean }>('terms.lookup', { text: 'upshot', sentence_id: upshotSentence.id });
    if (tok.status === 0 || tok.status === undefined) {
      expect(look.card_created).toBe(true);
      expect(look.status_change?.to).toBe(1);
    }

    // 复习：新词在文章里见过，直接出题；作答一题
    const session = await core.call<ReviewSession>('review.start', {});
    expect(session.steps.length).toBeGreaterThan(0);
    const step = session.steps.find(s => !s.intro)!;
    const answer = step.card_type === 'choice'
      ? { choice: (step.options ?? [])[0]?.id }
      : { typed: step.context.answer[0] };
    const res = await core.call<{ correct: boolean; rating?: number }>('review.answer', { session_id: session.session_id, step: step.step, answer, hints: 0, duration_ms: 3000 });
    expect(typeof res.correct).toBe('boolean');

    // 统计能读到
    const s = await core.call<{ reviews: number }>('stats.summary', { range: 30 });
    expect(s.reviews).toBeGreaterThanOrEqual(0);

    // 同一篇再导入：去重
    const again = await core.call<{ task_id: string }>('documents.import', { source: { type: 'text', text: TEXT } });
    const d2 = await waitTask(core, events, again.task_id);
    expect(d2.result?.document_id).toBe(document_id);

    await core.db.close();
  });
});
