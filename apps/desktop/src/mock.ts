/**
 * ?mock=1：内存假数据，页面不依赖 Core 也能渲染（截图、样式调试）。只覆盖界面用到的方法。
 */
import type { AnswerResult, Document, DocumentSummary, QueueItem, ReviewSession, SectionContent, Sentence, Status, Term, Token } from '@tibi/core';
import type { Transport } from './rpc/client';

const WORDS: Record<string, [Status, string, string]> = { distinctive: [3, '独特的', 'dɪˈstɪŋktɪv'], upshot: [0, '最终结果', 'ˈʌpʃɒt'], overhead: [2, '开销', 'ˈəʊvəhed'], reclaimed: [0, '回收', 'rɪˈkleɪm'], deterministically: [0, '确定性地', 'dɪˌtɜːmɪˈnɪstɪkli'], binding: [99, '绑定', 'ˈbaɪndɪŋ'], enforces: [99, '强制执行', 'ɪnˈfɔːs'], verifies: [3, '验证', 'ˈverɪfaɪ'], outlives: [0, '比…存在更久', 'ˌaʊtˈlɪv'], notoriously: [0, '出了名地', 'nəʊˈtɔːriəsli'], borrow: [1, '借用', 'ˈbɒrəʊ'] };
const PARAS = [
  ['Ownership is the feature that makes Rust distinctive among systems languages.', 'Instead of relying on a garbage collector, the compiler enforces a small set of rules at compile time, and a program that violates them simply won\'t compile.', 'The upshot is memory safety without the runtime overhead that usually comes with it.'],
  ['Each value has exactly one owner.', 'When the owner goes out of scope, the value is dropped and its memory is reclaimed deterministically.', 'Passing a value to a function moves it, which means the original binding can no longer be used.'],
  ['If you only need to read the data, you can borrow it instead.', 'The borrow checker verifies that no reference outlives the value it points to, which rules out the dangling pointers that are notoriously hard to find in C and C++.'],
];
const CODE = 'fn main() {\n    let s = String::from("hello");\n    takes(s);\n    // s is no longer valid here\n}';
const now = Date.now();
let sid = 0;
const sentences: Sentence[] = []; const blocks: SectionContent['blocks'] = [];
PARAS.forEach((p, pi) => {
  const ids: string[] = [];
  for (const text of p) {
    const id = `s${++sid}`; ids.push(id);
    const tokens: Token[] = []; const re = /[A-Za-z][A-Za-z'’-]*/g; let m: RegExpExecArray | null;
    while ((m = re.exec(text))) { const l = m[0].toLowerCase(); const w = WORDS[l]; tokens.push({ t: m[0], l, s: m.index, e: m.index + m[0].length, status: w ? w[0] : (l.length > 7 ? 5 : undefined) }); }
    sentences.push({ id, idx: sid, paragraph_idx: pi, block_type: 'prose', text, tokens, translation: pi === 0 ? '所有权是 Rust 区别于其他系统语言的特性。' : undefined });
  }
  blocks.push({ type: 'sentences', ids, block_type: 'prose', paragraph_idx: pi });
  if (pi === 1) blocks.push({ type: 'code', lang: 'rust', code: CODE });
});
const DOCS: DocumentSummary[] = [
  { id: 'd1', kind: 'article', genre: 'tech', title: 'Understanding Ownership in Rust', source: 'blog.rust-lang.org', tags: ['Rust', '内存管理'], minutes: 4, unknown_ratio: 0.072, difficulty: 'hard', progress: 0.45, status: 'ready', ai_status: 'done', excerpt: 'Ownership is the feature that makes Rust distinctive among systems languages.', added_at: now - 86400000 * 2, opened_at: now - 3600000 },
  { id: 'd2', kind: 'book', genre: 'lit', title: 'Pride and Prejudice', author: 'Jane Austen', source: 'gutenberg.org', tags: ['经典小说'], minutes: 12, unknown_ratio: 0.026, difficulty: 'ok', progress: 0.08, book: { chapter: 1, chapters: 61, chapter_progress: 0.6 }, status: 'ready', ai_status: 'none', excerpt: 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.', added_at: now - 86400000 * 5, opened_at: now - 86400000 },
  { id: 'd3', kind: 'article', genre: 'news', title: 'Cities Turn to Sponge Design as Floods Intensify', source: 'theguardian.com', tags: ['城市', '气候'], minutes: 3, unknown_ratio: 0.098, difficulty: 'hard', progress: 0, status: 'ready', ai_status: 'deferred', excerpt: 'The old drains could not cope with the storm.', added_at: now - 86400000 },
  { id: 'd4', kind: 'article', genre: 'tech', title: 'A Gentle Introduction to Async Rust', source: 'tokio.rs', tags: ['Rust', '异步'], minutes: 9, unknown_ratio: 0.031, difficulty: 'ok', progress: 1, status: 'ready', ai_status: 'done', excerpt: 'Async programming lets you write code that waits without blocking a thread.', added_at: now - 86400000 * 9, opened_at: now - 86400000 * 3, finished_at: now - 86400000 * 3 },
];
const term = (l: string, i: number): Term => ({ id: `t-${l}`, kind: 'word', text: l, display: l, ipa: WORDS[l]?.[2], meaning: WORDS[l]?.[1] ?? '', status: WORDS[l]?.[0] ?? 0, forms: [], exam: ['cet6'], tags: ['Rust'], encounter_count: 1 + (i % 4), doc_count: 1, due: now + (i - 2) * 86400000, lapses: i === 1 ? 3 : 0, added_at: now - i * 86400000 });
const TERMS = Object.keys(WORDS).map(term);
const QUEUE: QueueItem[] = [
  { step: 0, card_id: 'c1', term: term('upshot', 0), card_type: 'choice', is_new: true, intro: false, retry: 0, self_rated: false, options: [{ id: 'o1', text: 'n. 最终结果' }, { id: 'o2', text: 'n. 开销', from: '同篇生词' }, { id: 'o3', text: 'v. 回收' }, { id: 'o4', text: 'adj. 独特的' }], context: { id: 'x1', sentence: PARAS[0]![2]!, answer: ['n. 最终结果'], translation: '结果是：既有内存安全，又没有运行时开销。', document_title: 'Understanding Ownership in Rust', document_id: 'd1', source: 'article' } },
  { step: 1, card_id: 'c2', term: term('overhead', 1), card_type: 'cloze', is_new: false, intro: false, retry: 0, self_rated: false, hint: '开销', context: { id: 'x2', sentence: PARAS[0]![2]!, answer: ['overhead'], translation: '结果是：既有内存安全，又没有运行时开销。', document_title: 'Understanding Ownership in Rust', document_id: 'd1', source: 'article' } },
  { step: 2, card_id: 'c3', term: term('borrow', 2), card_type: 'recognize', is_new: false, intro: false, retry: 0, self_rated: true, context: { id: 'x3', sentence: PARAS[2]![0]!, answer: ['borrow'], translation: '如果只需要读数据，可以借用它。', document_title: 'Understanding Ownership in Rust', document_id: 'd1', source: 'article' } },
  { step: 3, card_id: 'c4', term: term('notoriously', 3), card_type: 'choice', is_new: true, intro: true, retry: 0, self_rated: false, context: { id: 'x4', sentence: PARAS[2]![1]!, answer: ['adv. 出了名地'], translation: '', source: 'dictionary' } },
];
let session: ReviewSession = { session_id: 'rs1', kind: 'review', graded: true, steps: QUEUE, cursor: 0, resumed: false, started_at: now, forecast: [] };

export function mockTransport(): Transport {
  const listeners = new Set<(e: string, d: unknown) => void>();
  const emit = (e: string, d: unknown) => { for (const l of listeners) l(e, d); };
  const handlers: Record<string, (p: any) => unknown> = {
    'system.status': () => ({ version: '0.1.0-mock', db_path: '~/Library/Application Support/Tibi/app.db', offline: false, models: { fast: 'deepseek-flash', ok: true }, budget: { month_spent: 3.2, limit: 20, per_task: 1 }, pending_approvals: 0, running_tasks: 0 }),
    'documents.list': (p) => { let items = DOCS.filter(d => !p.kind || d.kind === p.kind).filter(d => !p.tags?.length || p.tags.every((t: string) => d.tags.includes(t))).filter(d => !p.q || d.title.toLowerCase().includes(String(p.q).toLowerCase())); if (p.sort === 'opened') items = [...items].sort((a, b) => (b.opened_at ?? 0) - (a.opened_at ?? 0)); return { items, total: items.length }; },
    'documents.get': (p) => { const d = DOCS.find(x => x.id === p.id); if (!d) throw Object.assign(new Error('找不到这篇文章'), { code: 'not_found' }); return { ...d, sections: [{ id: `${d.id}-1`, idx: 0, title: '', status: 'ready', progress: d.progress, word_count: 180 }] } as Document; },
    'documents.update': (p) => { const d = DOCS.find(x => x.id === p.id)!; Object.assign(d, p.patch); emit('data.changed', { table: 'documents', ids: [p.id] }); return d; },
    'documents.import': (p) => { const id = `t${Date.now()}`; setTimeout(() => emit('task.update', { task: { id, state: 'run', skill_id: 'importer', title: p.source.url ?? '粘贴的文字', trigger: 'user', model: '', step: { index: 1, total: 4, label: '抓取网页' }, started_at: now, duration_ms: 0, cost: 0 } }), 300); setTimeout(() => emit('task.done', { task: { id, state: 'done', skill_id: 'importer', title: '', trigger: 'user', model: '', step: { index: 4, total: 4, label: '完成' }, started_at: now, duration_ms: 1500, cost: 0 }, result: { document_id: 'd3', summary: '导入完成：Cities Turn to Sponge Design' } }), 1500); return { task_id: id }; },
    'sections.get': (p) => ({ id: p.id, document_id: 'd1', title: '', blocks, sentences, phrases: [], counts: { new: 5, learning: 3, unsure: 2 } }) as SectionContent,
    'sections.progress': () => ({ ok: true }), 'sections.finish': (p) => ({ marked: p.mark_rest_known ? 5 : 0, undo: p.mark_rest_known ? { undo_id: 'u1', expires_at: now + 600000 } : undefined }),
    'terms.lookup': (p) => { const l = String(p.text).toLowerCase(); const w = WORDS[l]; return { dict: { word: l, phonetic: w?.[2], translation: w ? `${w[1]}` : '（词典里没有）', exam: ['cet6'], collins: 3, forms: [] }, term: w ? term(l, 0) : undefined, context_meaning: l === 'upshot' ? '"The upshot is…" 是常见的总结句式：说了一堆之后，结论是…' : undefined, card_created: w?.[0] === 0, status_change: w?.[0] === 0 ? { from: 0, to: 1 } : undefined }; },
    'dict.suggest': (p) => { const q = String(p.q).trim().toLowerCase(); const items = q ? Object.entries(WORDS).filter(([w, v]) => w.startsWith(q) || v[1].includes(q)).map(([word, v]) => ({ word, phonetic: v[2], gloss: v[1] })) : []; return { available: true, mode: /[\u3400-\u9fff]/.test(q) ? 'zh' : 'prefix', items }; },
    'dict.entry': (p) => { const l = String(p.word).toLowerCase(); const w = WORDS[l]; return { available: true, lemma: l, entry: w ? { word: l, phonetic: w[2], translation: `n. ${w[1]}`, exam: ['cet6'], collins: 3, oxford: true, frequency: 8000, forms: [], inflections: [] } : undefined, term: undefined, in_wordbook: false, readings: w ? [{ document_id: 'd1', title: DOCS[0]!.title, snippet: `The ⟦${l}⟧ of the whole design.` }] : [], similar: [], extras: w ? { word: l, atlas: { cefr: 'B2', tip: `${l} 的辨析提示。`, examples: [{ en: `A sentence with ${l}.`, zh: '一个例句。' }], collocations: [{ en: `${l} design`, zh: '搭配' }], family: [`${l}ly (adv.)`], synonyms: ['unique'], antonyms: ['common'] }, senses: [{ pos: 'a', definition: 'of a feature that helps to distinguish', synonyms: ['characteristic'], examples: ['a distinctive odor'] }], antonyms: [] } : undefined }; },
    'terms.list': (p) => { const v = p.view ?? 'all'; const items = TERMS.filter(t => v === 'all' ? t.status <= 4 : v === 'due' ? t.status <= 4 && (t.due ?? 0) <= now + 86400000 : v === 'leech' ? t.lapses >= 3 : v === 'unsure' ? t.status === 99 : v === 'known' ? t.status === 97 : v === 'mastered' ? t.status === 5 : v === 'ignored' ? t.status === 98 : true).filter(t => !p.q || t.text.includes(String(p.q).toLowerCase())); return { items, total: items.length, counts: { all: TERMS.filter(t => t.status <= 4).length, due: 3, leech: 1, known: 0 } }; },
    'terms.get': (p) => { const t = TERMS.find(x => x.id === p.id) ?? TERMS[0]!; return { ...t, en: 'the final result of a situation', contexts: [{ id: 'x1', source: 'article', document_id: 'd1', document_title: 'Understanding Ownership in Rust', sentence_id: 's3', sentence: PARAS[0]![2]!, is_primary: true, unknown_others: 0 }], card: { card_id: 'c1', term_id: t.id, state: 2, due: t.due!, stability: 4.2, difficulty: 5.1, reps: 3, lapses: t.lapses, suspended: false }, reviews: [], history: [{ status: t.status, at: now - 86400000, source: 'user' }] }; },
    'terms.setStatus': (p) => { for (const id of p.ids) { const t = TERMS.find(x => x.id === id); if (t) t.status = p.status; const l = id.replace(/^t-/, ''); if (WORDS[l]) WORDS[l]![0] = p.status; } emit('data.changed', { table: 'terms', ids: p.ids }); return { changed: p.ids.length, undo: { undo_id: 'u2', expires_at: now + 600000 } }; },
    'review.start': () => session,
    'review.answer': (p) => { const it = QUEUE.find(q => q.step === p.step)!; const a = p.answer; const correct = it.card_type === 'choice' ? a.choice === 'o1' : it.card_type === 'cloze' ? String(a.typed ?? '').trim().toLowerCase() === it.context.answer[0] : (a.self_rating ?? 1) >= 3; const rating = (it.card_type === 'recognize' ? a.self_rating : correct ? (p.hints ? 2 : 3) : 1) as 1 | 2 | 3 | 4; it.result = { correct, rating, answered_at: Date.now() }; return { step: p.step, ...(it.card_type === 'choice' ? { correct_option: 'o1' } : {}), correct, near_miss: false, rating, reason: correct ? `答对，用时 ${Math.round(p.duration_ms / 1000)} 秒` : '答错', auto: it.card_type !== 'recognize', next: { days: correct ? 4 : 0, label: correct ? '4 天后再见' : '3 张之后重练' }, status_change: correct ? { from: it.term.status, to: Math.min(5, it.term.status + 1) as Status } : undefined, undo: { undo_id: 'u3', expires_at: now + 600000 } } satisfies AnswerResult; },
    'review.override': (p) => ({ step: p.step, correct: p.rating >= 3, near_miss: false, rating: p.rating, reason: '已改评分', auto: false, undo: { undo_id: 'u4', expires_at: now + 600000 } }),
    'review.next': () => ({ ok: true }), 'review.pause': () => ({ ok: true }), 'review.undo': () => { session = { ...session, cursor: Math.max(0, session.cursor - 1) }; return { step: session.cursor, correct: false, near_miss: false, auto: false, undo: { undo_id: 'u5', expires_at: now } }; },
    'review.quiz': (p) => ({ session_id: 'drill', kind: 'drill', graded: false, steps: QUEUE.filter(q => p.term_ids?.includes(q.term.id)).map((q, i) => ({ ...q, step: i, retry: 1 as const })), cursor: 0, resumed: false, started_at: now, forecast: [] }),
    'stats.summary': () => ({ known: 6214, known_delta: 38, prev_delta: 25, minutes: 12, words: 3800, study_days: 5, streak: 9, longest_streak: 14, reviews: 120, retention: 0.91 }),
    'profile.get': () => ({ display_name: '你', goal: 'work', level_self: 'upper', interests: ['tech'], vocab_estimate: 6200, vocab_source: 'self', daily_goal_minutes: 20, daily_new_cards: 20, desired_retention: 0.9, assistant_prefs: { nickname: '你', language: 'mixed', permission: 'default' } }),
    'profile.update': (p) => ({ ...(handlers['profile.get']!({}) as object), ...p.patch }),
    'settings.get': () => ({ 'budget.month': 20, 'budget.task': 1 }), 'settings.set': (p) => p.patch,
    'providers.list': () => [{ id: 'p1', kind: 'llm', name: 'DeepSeek', protocol: 'openai_compatible', base_url: 'https://api.deepseek.com', auth: 'api_key', tier: 'fast', model: 'deepseek-flash', has_secret: true, is_default: true, month_cost: 3.2 }],
    'providers.upsert': (p) => ({ ...p.provider, id: p.provider.id ?? 'p2', has_secret: !!p.secret_ref }), 'providers.delete': () => ({ ok: true }), 'providers.test': () => ({ ok: true, latency_ms: 412, json_mode: true }),
    'system.undo': () => ({ ok: true }), 'system.registerPaths': () => ({ ok: true }),
  };
  return {
    kind: 'mock',
    async call(method, params) { const h = handlers[method]; if (!h) throw Object.assign(new Error(`mock 没有 ${method}`), { code: 'not_found' }); await new Promise(r => setTimeout(r, 30)); return h(params ?? {}); },
    onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
