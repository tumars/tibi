import { describe, expect, it } from 'vitest';
import { termsMethods } from '../../src/domain/terms/index.js';
import { undoMethods } from '../../src/domain/shared/undo.js';
import { parseWordList } from '../../src/domain/terms/io.js';
import { makeCore } from '../helpers.js';

const files: Record<string, string> = {
  '/x/known.txt': '# 已知词\nthe\nhouse\nalready\n',
  '/x/words.csv': '﻿word,meaning\nubiquitous,"无处不在的, 普遍的"\nephemeral,短暂的\n',
};
async function setup() {
  const m = await makeCore({ platform: { readFile: async p => new TextEncoder().encode(files[p] ?? ''), isPathAllowed: p => p in files } });
  m.core.use(termsMethods).use(undoMethods);
  return m;
}

describe('生词本导入 / 导出（M3）', () => {
  it('导入已知词表：没有的建成 97，学习中的不动', async () => {
    const { core, db } = await setup();
    await core.call('terms.add', { entries: [{ text: 'already' }] });   // 生词本里的 0 → 会被标为已知
    await db.run("UPDATE terms SET status = 2 WHERE text = 'already'");   // 学习中：不动
    const r = await core.call<{ known: number; skipped: number }>('terms.import', { path: '/x/known.txt', format: 'known' });
    expect(r).toMatchObject({ known: 2, skipped: 1 });
    expect((await db.get<{ status: number }>("SELECT status FROM terms WHERE text = 'house'"))?.status).toBe(97);
    expect((await db.get<{ status: number }>("SELECT status FROM terms WHERE text = 'already'"))?.status).toBe(2);
  });

  it('导入 CSV 进生词本（带释义），再导出 CSV / Anki / TXT', async () => {
    const { core } = await setup();
    const r = await core.call<{ added: number }>('terms.import', { path: '/x/words.csv', format: 'csv' });
    expect(r.added).toBe(2);
    const csv = await core.call<{ text: string; count: number; filename: string }>('terms.export', { format: 'csv' });
    expect(csv.count).toBe(2); expect(csv.filename).toMatch(/\.csv$/);
    expect(csv.text).toContain('"无处不在的, 普遍的"');
    const anki = await core.call<{ text: string }>('terms.export', { format: 'anki' });
    expect(anki.text.split('\n')[0]).toBe('#separator:tab');
    expect(anki.text).toMatch(/ephemeral\t短暂的\ttibi word/);
    const txt = await core.call<{ text: string }>('terms.export', { format: 'txt' });
    expect(txt.text.trim().split('\n')).toEqual(['ubiquitous', 'ephemeral']);
  });

  it('没登记的路径拒绝；解析跳过表头和 # 行', async () => {
    const { core } = await setup();
    await expect(core.call('terms.import', { path: '/etc/passwd', format: 'txt' })).rejects.toMatchObject({ code: 'permission_denied' });
    expect(parseWordList('#deck:Tibi\nFront\tBack\nword\tmeaning\n<b>run</b>\t跑\n')).toEqual([{ text: 'run', meaning: '跑' }]);
  });
});
