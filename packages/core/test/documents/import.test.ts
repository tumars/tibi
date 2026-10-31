import { beforeEach, describe, expect, it } from 'vitest';
import type { Dict, SectionContent, DocumentSummary, Core, Ctx } from '../../src/index.js';
import { documentsMethods, registerImportPipeline } from '../../src/domain/documents/index.js';
import { termsMethods } from '../../src/domain/terms/index.js';
import { undoMethods } from '../../src/domain/shared/undo.js';
import { makeCore, InlineJobRunner } from '../helpers.js';

const FREQ: Record<string, number> = { the: 1, is: 2, a: 3, of: 4, and: 5, to: 6, that: 7, it: 8, rust: 3000, feature: 400, make: 50, among: 900, system: 300, language: 200, instead: 700, rely: 2500, on: 9, garbage: 4000, collector: 6500, compiler: 2000, enforce: 7000, small: 100, set: 80, rule: 500, at: 10, compile: 5000, time: 30, program: 600, violate: 6800, them: 20, simply: 1500, won: 300, not: 15, upshot: 15000, memory: 800, safety: 1200, without: 150, runtime: 9500, overhead: 7500, usually: 400, come: 60, with: 12, each: 90, value: 250, have: 14, exactly: 1300, one: 16, owner: 2200, when: 25, go: 100, out: 40, scope: 6200, be: 2, drop: 1100, its: 50, reclaim: 11000, deterministically: 20000, this: 13, distinctive: 8800 };
const dict: Dict = { async lookup(w) { return FREQ[w] ? { word: w, translation: `n. ${w}的意思；另一义`, exam: [], forms: [] } : undefined; }, async lemmas() { return []; }, async frequencyRank(l) { return FREQ[l]; } };

const TEXT = `# Understanding Ownership in Rust

Ownership is the feature that makes Rust distinctive among systems languages. Instead of relying on a garbage collector, the compiler enforces a small set of rules at compile time. The upshot is memory safety without the runtime overhead that usually comes with it.

\`\`\`rust
fn main() { let s = String::from("hi"); }
\`\`\`

Each value has exactly one owner. When the owner goes out of scope, the value is dropped and its memory is reclaimed deterministically.`;

let core: Core; let jobs: InlineJobRunner; let ctx: Ctx;
beforeEach(async () => {
  const m = await makeCore({ dict });
  core = m.core; jobs = m.jobs; ctx = m.ctx;
  core.use(documentsMethods).use(termsMethods).use(undoMethods);
  registerImportPipeline(jobs, core);
  await m.db.run("UPDATE user_profile SET vocab_estimate = 6000 WHERE id = '1'");
});

async function importText(text = TEXT) {
  const { task_id } = await core.call<{ task_id: string }>('documents.import', { source: { type: 'text', text } });
  const r = await jobs.wait(task_id);
  if (r.status !== 'done') throw new Error('导入失败：' + r.error);
  return r.output as { document_id: string; duplicate: boolean; unknown_ratio: number };
}

describe('导入文本', () => {
  it('入库、切分、标注、计数', async () => {
    const out = await importText();
    expect(out.duplicate).toBe(false);
    const doc = await core.call<DocumentSummary & { sections: unknown[] }>('documents.get', { id: out.document_id });
    expect(doc.title).toBe('Understanding Ownership in Rust');
    expect(doc.genre).toBe('tech');
    expect(doc.status).toBe('ready');
    expect(doc.ai_status).toBe('deferred');
    expect(doc.sections).toHaveLength(1);
    expect(doc.excerpt).toMatch(/^Ownership is the feature/);
    const sec = await core.call<SectionContent>('sections.get', { id: (doc.sections[0] as { id: string }).id });
    expect(sec.blocks.map(b => b.type)).toEqual(['sentences', 'code', 'sentences']);
    expect(sec.sentences).toHaveLength(5);
    const first = sec.sentences[0]!;
    expect(first.text).toBe('Ownership is the feature that makes Rust distinctive among systems languages.');
    const status = Object.fromEntries(first.tokens.map(t => [t.l, t.status]));
    expect(status['distinctive']).toBe(99);     // 6000 < 8800 ≤ 9000：待确认
    expect(status['rust']).toBeUndefined();     // 专有名词（句中大写）
    expect(status['feature']).toBeUndefined();  // 已知：不建行
    const last = sec.sentences[4]!;
    const st2 = Object.fromEntries(last.tokens.map(t => [t.l, t.status]));
    expect(st2['reclaim']).toBe(0);
    expect(st2['deterministically']).toBe(0);
    expect(sec.counts).toEqual({ new: 5, learning: 0, unsure: 3 });   // upshot runtime reclaim deterministically overhead(7500→unsure)… 见下
    expect(out.unknown_ratio).toBeGreaterThan(0);
    // 词表：新词有行，已知词没有
    const terms = await ctx.db.all<{ text: string; status: number; encounter_count: number }>('SELECT text, status, encounter_count FROM terms ORDER BY text');
    expect(terms.find(t => t.text === 'feature')).toBeUndefined();
    expect(terms.find(t => t.text === 'upshot')).toMatchObject({ status: 0, encounter_count: 1 });
    expect(terms.find(t => t.text === 'owner')).toBeUndefined();     // 2200 ≤ 6000 已知
    const ctxs = await ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM term_contexts');
    expect(Number(ctxs?.n)).toBeGreaterThan(0);
    const ev = await ctx.db.get<{ payload: string }>("SELECT payload FROM learning_events WHERE type = 'document_imported'");
    expect(JSON.parse(ev!.payload)).toMatchObject({ document_id: out.document_id, source_type: 'text' });
    expect(JSON.parse(ev!.payload).prelabel_total).toBeGreaterThan(10);
  });

  it('重复导入返回同一篇', async () => {
    const a = await importText();
    const b = await importText();
    expect(b.duplicate).toBe(true);
    expect(b.document_id).toBe(a.document_id);
    const n = await ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM documents');
    expect(Number(n?.n)).toBe(1);
  });

  it('书架列表与排序、删除可撤销', async () => {
    const a = await importText();
    const b = await importText('Second one. Nothing special here, just plain words about time and value and memory.');
    let list = await core.call<{ items: DocumentSummary[]; total: number }>('documents.list', {});
    expect(list.total).toBe(2);
    await core.call('sections.progress', { id: (await core.call<{ sections: { id: string }[] }>('documents.get', { id: b.document_id })).sections[0]!.id, sentence_id: 'x', progress: 0.5 });
    list = await core.call('documents.list', { sort: 'fit' });
    expect(list.items[0]!.id).toBe(b.document_id);    // 读到一半的靠前
    const undo = await core.call<{ undo_id: string }>('documents.delete', { id: a.document_id });
    expect((await core.call<{ total: number }>('documents.list', {})).total).toBe(1);
    await core.call('system.undo', { undo_id: undo.undo_id });
    expect((await core.call<{ total: number }>('documents.list', {})).total).toBe(2);
  });

  it('网址导入走平台抓取并标记不可信', async () => {
    const m = await makeCore({ dict, platform: {
      async fetchUrl(url) { return { status: 200, final_url: url, content_type: 'text/html', body: '<html><body><article><h1>Web Title</h1><p>Ownership is the feature that makes the compiler happy. The upshot is memory safety without overhead, which is nice for everyone who writes programs at compile time.</p></article></body></html>' }; },
      async extractReadable(html) { const m2 = html.match(/<p>(.*?)<\/p>/)!; return { title: 'Web Title', markdown: m2[1]!, images: [] }; },
    } });
    m.core.use(documentsMethods).use(termsMethods); registerImportPipeline(m.jobs, m.core);
    const { task_id } = await m.core.call<{ task_id: string }>('documents.import', { source: { type: 'url', url: 'https://example.com/post?x=1#frag' } });
    const r = await m.jobs.wait(task_id);
    expect(r.status, r.error).toBe('done');
    const doc = await m.core.call<DocumentSummary>('documents.get', { id: (r.output as { document_id: string }).document_id });
    expect(doc.title).toBe('Web Title');
    expect(doc.source).toBe('example.com');
    await expect(m.core.call('documents.import', { source: { type: 'url', url: 'http://127.0.0.1/x' } })).rejects.toThrow();
    expect(await m.core.call('documents.checkUrl', { url: 'ftp://a' })).toMatchObject({ ok: false });
  });
});
