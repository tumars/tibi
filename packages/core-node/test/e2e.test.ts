import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Core, CoreEventName, DocumentSummary, ReviewSession, SectionContent, Status } from '@tibi/core';
import { createCore } from '../src/index.js';

/**
 * 端到端：真实内核（任务、检查点）+ 全部领域模块，在一个临时 app.db 上走一遍 M1 的最小闭环：
 * 导入一段文本 → 阅读（sections.get）→ 加进生词本并点开（R5：自动见过）→ 复习（选义题作答）→ 统计。
 * 不带词典：词形还原退化为规则；导入不标生词，生词只来自用户的标记。
 */
const TEXT = `# Understanding Ownership in Rust

Ownership is the feature that makes Rust distinctive among systems languages. The upshot is memory safety without the runtime overhead.

\`\`\`rust
fn main() {}
\`\`\`

Each value has exactly one owner. When the owner goes out of scope, the value is dropped.`;

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

async function waitImport(core: Core, events: { event: CoreEventName; data: any }[], import_id: string) {
  void core;
  for (let i = 0; i < 200; i++) {
    const done = events.find(e => e.event === 'import.done' && e.data?.import_id === import_id);
    if (done) return done.data;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('导入没有完成');
}

describe('端到端：导入 → 阅读 → 点词 → 复习', () => {
  it('走通最小闭环', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tibi-e2e-'));
    const core = await createCore({ dbPath: join(dir, 'app.db'), version: 'test' });
    const events: { event: CoreEventName; data: any }[] = [];
    core.events.on((event, data) => events.push({ event, data }));

    // 方法都挂上了
    for (const m of ['documents.import', 'sections.get', 'terms.lookup', 'review.start', 'review.answer', 'stats.summary', 'chat.send', 'approvals.list', 'system.undo', 'profile.get']) {
      expect(core.dispatcher.has(m), m).toBe(true);
    }
    expect(core.dispatcher.has('vocab.start')).toBe(false);

    // 导入：在后台跑，进度走 import.progress，完成后发 import.done
    const { import_id } = await core.call<{ import_id: string }>('documents.import', { source: { type: 'text', text: TEXT } });
    const done = await waitImport(core, events, import_id);
    const document_id = done.document_id as string;
    expect(done.ok).toBe(true); expect(document_id).toBeTruthy();
    expect(events.some(e => e.event === 'import.progress' && e.data.import_id === import_id)).toBe(true);

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

    // 导入不标生词：没有用户标过的词就没有状态
    expect(tok.status).toBeUndefined();
    // 用户把它加进生词本（建卡），再点开（R5）：生词变成"见过"
    await core.call('terms.add', { entries: [{ text: 'upshot', sentence_id: upshotSentence.id }] });
    const look = await core.call<{ status_change?: { from: Status; to: Status }; card_created?: boolean }>('terms.lookup', { text: 'upshot', sentence_id: upshotSentence.id });
    expect(look.status_change).toEqual({ from: 0, to: 1 });

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
    const again = await core.call<{ import_id: string }>('documents.import', { source: { type: 'text', text: TEXT } });
    const d2 = await waitImport(core, events, again.import_id);
    expect(d2.document_id).toBe(document_id); expect(d2.duplicate).toBe(true);

    await core.db.close();
  });
});
