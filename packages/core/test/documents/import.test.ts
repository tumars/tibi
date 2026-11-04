import { beforeEach, describe, expect, it } from 'vitest';
import type { Dict, SectionContent, DocumentSummary, Core, Ctx } from '../../src/index.js';
import { documentsMethods } from '../../src/domain/documents/index.js';
import { termsMethods } from '../../src/domain/terms/index.js';
import { undoMethods } from '../../src/domain/shared/undo.js';
import { imported, makeCore } from '../helpers.js';

const FREQ: Record<string, number> = { the: 1, is: 2, a: 3, of: 4, and: 5, to: 6, that: 7, it: 8, rust: 3000, feature: 400, make: 50, among: 900, system: 300, language: 200, instead: 700, rely: 2500, on: 9, garbage: 4000, collector: 6500, compiler: 2000, enforce: 7000, small: 100, set: 80, rule: 500, at: 10, compile: 5000, time: 30, program: 600, violate: 6800, them: 20, simply: 1500, won: 300, not: 15, upshot: 15000, memory: 800, safety: 1200, without: 150, runtime: 9500, overhead: 7500, usually: 400, come: 60, with: 12, each: 90, value: 250, have: 14, exactly: 1300, one: 16, owner: 2200, when: 25, go: 100, out: 40, scope: 6200, be: 2, drop: 1100, its: 50, reclaim: 11000, deterministically: 20000, this: 13, distinctive: 8800 };
const dict: Dict = { async lookup(w) { return FREQ[w] ? { word: w, translation: `n. ${w}的意思；另一义`, exam: [], forms: [`${w}s`, `${w}es`, `${w}ed`, `${w}d`, `${w}ing`, `${w}${w.slice(-1)}ed`, `${w}${w.slice(-1)}ing`, `${w.slice(0, -1)}ing`] } : undefined; }, async lemmas() { return []; }, async frequencyRank(l) { return FREQ[l]; } };

const TEXT = `# Understanding Ownership in Rust

Ownership is the feature that makes Rust distinctive among systems languages. Instead of relying on a garbage collector, the compiler enforces a small set of rules at compile time. The upshot is memory safety without the runtime overhead that usually comes with it.

\`\`\`rust
fn main() { let s = String::from("hi"); }
\`\`\`

Each value has exactly one owner. When the owner goes out of scope, the value is dropped and its memory is reclaimed deterministically.`;

let core: Core; let settle: () => Promise<void>; let ctx: Ctx;
beforeEach(async () => {
  const m = await makeCore({ dict });
  core = m.core; settle = m.settle; ctx = m.ctx;
  core.use(documentsMethods).use(termsMethods).use(undoMethods);
});

async function importText(text = TEXT) {
  const r = await imported(await core.call<{ import_id: string }>('documents.import', { source: { type: 'text', text } }));
  if (!r.ok) throw new Error('导入失败：' + r.error);
  return r as unknown as { document_id: string; duplicate: boolean; level?: string };
}

describe('导入文本', () => {
  it('入库、切分、标注、计数', async () => {
    const out = await importText();
    expect(out.duplicate).toBe(false);
    const doc = await core.call<DocumentSummary & { sections: unknown[] }>('documents.get', { id: out.document_id });   // level 见下
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
    // 没有用户标过的词：生僻词（upshot 15000、distinctive 8800）也不着色
    expect(sec.sentences.flatMap(s => s.tokens).every(t => t.status === undefined)).toBe(true);
    expect(sec.counts).toEqual({ new: 0, learning: 0 });
    // 文本级别只看词频，与用户无关
    expect(['A2', 'B1', 'B2', 'C1', 'C2']).toContain(doc.level);
    expect(out.level).toBe(doc.level);
    // 标注不建词条行
    expect(Number((await ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM terms'))?.n)).toBe(0);
    expect(Number((await ctx.db.get<{ n: number }>('SELECT count(*) AS n FROM term_status_log'))?.n)).toBe(0);
    const ev = await ctx.db.get<{ payload: string }>("SELECT payload FROM learning_events WHERE type = 'document_imported'");
    expect(JSON.parse(ev!.payload)).toMatchObject({ document_id: out.document_id, source_type: 'text' });
  });

  it('只有用户标过的词带状态；旧数据里规则标的 99 / auto_rule 行不着色，重新标注也不改它们', async () => {
    const { document_id } = await importText();
    const doc = await core.call<{ sections: { id: string }[] }>('documents.get', { id: document_id });
    // 用户把 upshot 加进生词本（0），把 collector 标成学习中（2）
    await core.call('terms.add', { entries: [{ text: 'upshot' }] });
    await core.call('terms.add', { entries: [{ text: 'collector' }] });
    const col = await ctx.db.get<{ id: string }>("SELECT id FROM terms WHERE text = 'collector'");
    await core.call('terms.setStatus', { ids: [col!.id], status: 2 });
    // 旧数据：规则标的待确认（99）——当作没有行，不着色
    const t = Date.now();
    await ctx.db.run("INSERT INTO terms(id, kind, text, text_display, status, status_source, created_at, updated_at) VALUES ('legacy', 'word', 'distinctive', 'distinctive', 99, 'auto_rule', ?, ?)", [t, t]);
    await core.call('documents.reanalyze', { id: document_id });
    await settle();
    const sec = await core.call<SectionContent>('sections.get', { id: doc.sections[0]!.id });
    const st = Object.fromEntries(sec.sentences.flatMap(s => s.tokens).filter(x => x.status !== undefined).map(x => [x.l, x.status]));
    expect(st).toEqual({ upshot: 0, collector: 2 });
    expect(sec.counts).toEqual({ new: 1, learning: 1 });
    // 重新标注不建新行、不改旧行
    const rows = await ctx.db.all<{ text: string; status: number }>('SELECT text, status FROM terms ORDER BY text');
    expect(rows).toEqual([{ text: 'collector', status: 2 }, { text: 'distinctive', status: 99 }, { text: 'upshot', status: 0 }]);
    // 用户标过的词在文中登记了语境
    const ctxs = await ctx.db.get<{ n: number }>("SELECT count(*) AS n FROM term_contexts tc JOIN terms t ON t.id = tc.term_id WHERE t.text = 'upshot' AND tc.source = 'article'");
    expect(Number(ctxs?.n)).toBe(1);
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
      async fetchUrl(url) { return { status: 200, final_url: url, content_type: 'text/html', body: '<html><body><article><h1>Web Title</h1><p>Ownership is the feature that makes the compiler happy. The upshot is memory safety without overhead, which is nice for everyone who writes programs at compile time. Every value has one owner and the rules are simple to follow once you know them well.</p></article></body></html>' }; },
      async extractReadable(html) { const m2 = html.match(/<p>(.*?)<\/p>/)!; return { title: 'Web Title', markdown: m2[1]!, images: [] }; },
    } });
    m.core.use(documentsMethods).use(termsMethods);
    const r = await imported(await m.core.call<{ import_id: string }>('documents.import', { source: { type: 'url', url: 'https://example.com/post?x=1#frag' } }));
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    const doc = await m.core.call<DocumentSummary>('documents.get', { id: (r as unknown as { document_id: string }).document_id });
    expect(doc.title).toBe('Web Title');
    expect(doc.source).toBe('example.com');
    expect(doc.source_type).toBe('url');
    expect(doc.source_url).toMatch(/^https:\/\/example\.com\/post/);
    await expect(m.core.call('documents.import', { source: { type: 'url', url: 'http://127.0.0.1/x' } })).rejects.toThrow();
    expect(await m.core.call('documents.checkUrl', { url: 'ftp://a' })).toMatchObject({ ok: false });
  });

  it('网页没有像样的标题（只是网址）时用调用方给的标题', async () => {
    const body = 'Ownership is the feature that makes the compiler happy. The upshot is memory safety without overhead, which is nice for everyone who writes programs at compile time. Every value has one owner and the rules are simple to follow once you know them well.';
    const m = await makeCore({ dict, platform: {
      async fetchUrl(url) { return { status: 200, final_url: url, content_type: 'text/html', body: `<p>${body}</p>` }; },
      async extractReadable(_html, url) { return { title: url, markdown: body, images: [] }; },
    } });
    m.core.use(documentsMethods);
    const r = await imported(await m.core.call<{ import_id: string }>('documents.import', { source: { type: 'url', url: 'https://example.com/pg/index.html', title: 'The Internals of PostgreSQL' } }));
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    const doc = await m.core.call<DocumentSummary>('documents.get', { id: (r as unknown as { document_id: string }).document_id });
    expect(doc.title).toBe('The Internals of PostgreSQL');
  });
});

describe('阅读时长', () => {
  it('上报进度记进 reading_sessions：同一次阅读延长，词数只算往后读的部分（往回翻不扣），读完补齐', async () => {
    const out = await importText();
    const sec = (await core.call<{ sections: { id: string; word_count: number }[] }>('documents.get', { id: out.document_id })).sections[0]!;
    await core.call('sections.progress', { id: sec.id, sentence_id: 'x', progress: 0.5 });
    await core.call('sections.progress', { id: sec.id, sentence_id: 'x', progress: 0.2 });   // 往回翻：不扣也不加
    await core.call('sections.progress', { id: sec.id, sentence_id: 'x', progress: 0.6 });
    let rows = await ctx.db.all<{ words_read: number }>('SELECT words_read FROM reading_sessions WHERE section_id = ?', [sec.id]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.words_read)).toBe(Math.round(0.5 * sec.word_count) + Math.round(0.4 * sec.word_count));
    await core.call('sections.finish', { id: sec.id });
    rows = await ctx.db.all('SELECT words_read FROM reading_sessions WHERE section_id = ?', [sec.id]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.words_read)).toBe(Math.round(0.5 * sec.word_count) + Math.round(0.4 * sec.word_count) + Math.round(0.4 * sec.word_count));
  });
});

describe('内置示例', () => {
  it('列出三篇、默认一篇；导入后带预生成总结与语境释义，且不标 deferred', async () => {
    const list = await core.call<{ id: string; is_default: boolean; document_id?: string; minutes: number }[]>('documents.samples', {});
    expect(list.map(s => s.id)).toEqual(['how-a-compiler-sees-your-code', 'gift-of-the-magi', 'why-cities-are-getting-hotter']);
    expect(list.filter(s => s.is_default)).toHaveLength(1);
    const r = await imported(await core.call<{ import_id: string }>('documents.import', { source: { type: 'sample', id: 'how-a-compiler-sees-your-code' } }));
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    const id = (r as unknown as { document_id: string }).document_id;
    const doc = await core.call<DocumentSummary & { ai?: Record<string, { output: unknown }>; sections: { id: string }[] }>('documents.get', { id });
    expect(doc.genre).toBe('tech');
    expect(doc.source).toBe('内置示例');
    expect(String(doc.ai?.summary?.output)).toContain('编译器');
    expect(Array.isArray(doc.ai?.phrases?.output)).toBe(true);
    const row = await ctx.db.get<{ ai_status: string }>('SELECT ai_status FROM documents WHERE id = ?', [id]);
    expect(row?.ai_status).toBe('done');
    // 语境释义：找一句含 compiler 的句子查词
    const sec = await core.call<SectionContent>('sections.get', { id: doc.sections[0]!.id });
    const s = sec.sentences.find(x => x.tokens.some(t => t.l === 'compiler'))!;
    const look = await core.call<{ context_meaning?: string }>('terms.lookup', { text: 'compiler', sentence_id: s.id });
    expect(look.context_meaning).toBe('编译器');
    // 代码块不拆句
    expect(sec.sentences.some(x => x.text.includes('fn area'))).toBe(false);
    expect((await core.call<{ document_id?: string }[]>('documents.samples', {}))[0]!.document_id).toBe(id);
    await expect(core.call<{ import_id: string }>('documents.import', { source: { type: 'sample', id: 'nope' } }).then(imported)).resolves.toMatchObject({ ok: false });
  });
});

describe('改标签', () => {
  it('整组替换，书架能按新标签筛选，去掉的还能再加回来', async () => {
    const { document_id: id } = await importText();
    const names = async () => (await core.call<DocumentSummary>('documents.get', { id })).tags;
    const listed = async (tag: string) => (await core.call<{ items: DocumentSummary[] }>('documents.list', { tags: [tag] })).items.length;

    await core.call('documents.update', { id, patch: { tags: ['Rust', '编译器'] } });
    expect(await names()).toEqual(['Rust', '编译器']);
    expect(await listed('编译器')).toBe(1);

    await core.call('documents.update', { id, patch: { tags: ['Rust'] } });
    expect(await names()).toEqual(['Rust']);
    expect(await listed('编译器')).toBe(0);

    await core.call('documents.update', { id, patch: { tags: ['rust', '编译器'] } }); // 大小写不同算同一个标签
    expect(await names()).toEqual(['Rust', '编译器']);

    await core.call('documents.update', { id, patch: { tags: [] } });
    expect(await names()).toEqual([]);
  });
});
