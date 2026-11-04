import { beforeEach, describe, expect, it } from 'vitest';
import type { Core, Ctx, TermDetail } from '../../src/index.js';
import { termsMethods } from '../../src/domain/terms/index.js';
import { insertContext, MAX_CONTEXTS } from '../../src/domain/terms/repo.js';
import { makeCore } from '../helpers.js';

let core: Core; let ctx: Ctx;
beforeEach(async () => {
  const m = await makeCore(); core = m.core; ctx = m.ctx;
  core.use(termsMethods);
  const t = Date.now();
  await ctx.db.run("INSERT INTO terms(id, kind, text, text_display, status, status_source, in_wordbook, created_at, updated_at) VALUES ('t-cat', 'word', 'cat', 'cat', 1, 'user', 1, ?, ?)", [t, t]);
});

const detail = () => core.call<TermDetail>('terms.get', { id: 't-cat' });
const add = (i: number, primary = false) => insertContext(ctx.db, { term_id: 't-cat', source: 'manual', text: `cat ${i}`, is_primary: primary });

describe('遇到过的句子：上限与收藏', () => {
  it('没收藏的只留最近 10 句，主句一直留着', async () => {
    await add(0, true);
    for (let i = 1; i <= 15; i++) await add(i);
    const d = await detail();
    expect(d.contexts).toHaveLength(MAX_CONTEXTS);
    const texts = d.contexts.map(c => c.sentence);
    expect(texts).toContain('cat 0');
    expect(texts).toContain('cat 15');
    expect(texts).not.toContain('cat 6');
  });

  it('收藏的不算进上限，也不会被清掉', async () => {
    const fav = await add(0);
    await core.call('terms.favoriteContext', { id: fav, favorite: true });
    for (let i = 1; i <= 12; i++) await add(i);
    const d = await detail();
    expect(d.contexts.filter(c => c.is_favorite).map(c => c.sentence)).toEqual(['cat 0']);
    expect(d.contexts.filter(c => !c.is_favorite)).toHaveLength(MAX_CONTEXTS);
  });

  it('取消收藏后下次遇到新句子时按上限清', async () => {
    const fav = await add(0);
    await core.call('terms.favoriteContext', { id: fav, favorite: true });
    for (let i = 1; i <= 10; i++) await add(i);
    await core.call('terms.favoriteContext', { id: fav, favorite: false });
    expect((await detail()).contexts).toHaveLength(11);
    await add(11);
    const texts = (await detail()).contexts.map(c => c.sentence);
    expect(texts).toHaveLength(MAX_CONTEXTS);
    expect(texts).not.toContain('cat 0');
  });

  it('找不到的句子报 not_found', async () => {
    await expect(core.call('terms.favoriteContext', { id: '01900000-0000-7000-8000-000000000000', favorite: true })).rejects.toMatchObject({ code: 'not_found' });
  });
});
