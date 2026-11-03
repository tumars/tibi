import { describe, expect, it } from 'vitest';
import { openAppDb } from '@tibi/core-node';
import { imported } from '../helpers.js';
import { assembleCore, fakePlatform, type Dict, type SearchResult } from '../../src/index.js';

const WORDS: Record<string, string> = { compiler: 'n. 编译器', enforce: 'v. 强制执行', rule: 'n. 规则', parser: 'n. 解析器' };
const dict: Dict = {
  async lookup(w) { return WORDS[w] ? { word: w, translation: WORDS[w]!, exam: [], forms: [`${w}s`, `${w}es`, `${w}ed`, `${w}d`, `${w}ing`, `${w}${w.slice(-1)}ed`, `${w}${w.slice(-1)}ing`, `${w.slice(0, -1)}ing`] } : undefined; },
  async lemmas(f) { return f === 'parsers' ? ['parser'] : []; }, async frequencyRank() { return 9000; },
};

describe('全局搜索 search.query（00 §3.8）', () => {
  it('文章标题与正文、生词本里的词（英文 / 中文释义）、对话标题、词典', async () => {
    const db = await openAppDb(':memory:');
    const t = Date.now();
    await db.run("INSERT INTO user_profile(id, created_at, updated_at) VALUES ('1', ?, ?)", [t, t]);
    const { core, kernel } = await assembleCore({ db, dict, platform: fakePlatform({ isOnline: () => false }), resume: false });
    const doc = await imported(await core.call<{ import_id: string }>('documents.import', { source: { type: 'text', text: 'Compilers at work\n\nThe compiler enforces a small set of rules at compile time.' } })) as { document_id: string };
    await core.call('terms.add', { entries: [{ text: 'compiler', meaning: '编译器' }] });   // 导入不建词条：用户自己加进生词本
    await db.run("INSERT INTO conversations(id, kind, title, created_at, updated_at) VALUES ('c1', 'chat', 'compiler 和 interpreter 有什么区别', ?, ?)", [t, t]);

    const a = await core.call<SearchResult>('search.query', { q: 'compil' });
    expect(a.documents[0]!.id).toBe(doc.document_id);
    expect(a.terms.map(x => x.text)).toContain('compiler');
    expect(a.conversations[0]!.id).toBe('c1');

    const body = await core.call<SearchResult>('search.query', { q: 'enforces' });
    expect(body.documents[0]?.snippet).toMatch(/\[enforces\]/);

    const zh = await core.call<SearchResult>('search.query', { q: '编译' });
    expect(zh.terms[0]!.text).toBe('compiler');

    const d = await core.call<SearchResult>('search.query', { q: 'parsers' });
    expect(d.dict?.lemma).toBe('parser');
    expect(d.terms).toEqual([]);

    const none = await core.call<SearchResult>('search.query', { q: '  ' });
    expect(none.documents).toEqual([]);
    // FTS 语法字符不报错
    await expect(core.call('search.query', { q: '"(*' })).resolves.toBeTruthy();
  });
});
