import { j, now, type Database } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import type { Genre, Kind, SampleInfo, Token } from '../../types.js';
import { listSections, listSentences, WPM } from './repo.js';
import { SAMPLE_DEFS } from './samples.gen.js';

/**
 * 内置示例（00 §3.9）：正文和预生成的 AI 结果随应用打包，不用配模型就能看到总结与语境释义。
 * 真相源是 packages/core/samples/<id>/article.md + ai.json，构建成 samples.gen.ts（目录）+ samples/<id>.gen.ts（正文，按需加载）。
 * ai_results 里 provider_id 为空、model = 'bundled'（01 ai_results）。
 */
export interface SampleAi {
  summary: string;
  advice?: string;
  phrases?: { text: string; zh: string }[];
  hard_sentences?: { s: string; zh: string }[];
  /** lemma（或小写原形）→ 这篇文章里的意思 */
  context_meanings: Record<string, string>;
  /** 书：语境释义只写这几章（章节 idx）；别的章里同一个词意思可能不一样，不写，留给模型 */
  context_sections?: number[];
}
export interface SampleBody { markdown: string; ai: SampleAi }
export interface SampleDef { id: string; title: string; author?: string; genre: Genre; kind: Kind; source: string; is_default: boolean; order: number; words: number; /** 书的章数 */ chapters?: number; load(): Promise<SampleBody> }

export const PREGENERATED_MODEL = 'bundled';

export function getSample(id: string): SampleDef | undefined { return SAMPLE_DEFS.find(s => s.id === id); }

export function sampleUri(id: string) { return `sample:${id}`; }

/** documents.samples：列出示例；已经导入过的带上 document_id */
export async function listSamples(db: Database): Promise<SampleInfo[]> {
  const rows = await db.all<{ id: string; source_uri: string }>("SELECT id, source_uri FROM documents WHERE source_type = 'sample' AND deleted_at IS NULL");
  const imported = new Map(rows.map(r => [r.source_uri, r.id]));
  return SAMPLE_DEFS.map(s => ({ id: s.id, title: s.title, author: s.author, genre: s.genre, source: s.source, minutes: Math.max(1, Math.round(s.words / WPM)), chapters: s.chapters, is_default: s.is_default, document_id: imported.get(sampleUri(s.id)) }));
}

/** 导入流水线的最后一步：把预生成结果写进 ai_results（文档级 + 按句的语境释义） */
export async function writeSampleAi(db: Database, document_id: string, ai: SampleAi): Promise<{ sentences: number }> {
  const t = now();
  const docTasks: [string, unknown][] = [['summary', ai.summary], ['advice', ai.advice], ['phrases', ai.phrases], ['hard_sentences', ai.hard_sentences]];
  const meanings = new Map(Object.entries(ai.context_meanings).map(([k, v]) => [k.toLowerCase(), v]));
  let sentences = 0;
  await db.transaction(async tx => {
    const put = (scope: string, target_id: string, task: string, output: unknown) => tx.run(
      'INSERT OR REPLACE INTO ai_results(id, scope, target_id, task, prompt_version, provider_id, model, output, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [uuidv7(), scope, target_id, task, '1', null, PREGENERATED_MODEL, j.str(output), t, t]);
    for (const [task, output] of docTasks) if (output !== undefined) await put('document', document_id, task, output);
    for (const sec of await listSections(tx, document_id)) {
      if (ai.context_sections && !ai.context_sections.includes(Number(sec.idx))) continue;
      for (const s of await listSentences(tx, sec.id)) {
        const tokens = j.parse<Token[]>(s.tokens as unknown as string, []);
        const m: Record<string, string> = {};
        for (const tk of tokens) {
          const hit = meanings.get(tk.l.toLowerCase()) ?? meanings.get(tk.t.toLowerCase());
          if (hit) m[tk.l] = hit;
        }
        if (Object.keys(m).length) { await put('sentence', s.id, 'context_meanings', m); sentences++; }
      }
      await tx.run("UPDATE sections SET ai_status = 'done', updated_at = ? WHERE id = ?", [t, sec.id]);
    }
    await tx.run("UPDATE documents SET ai_status = 'done', updated_at = ? WHERE id = ?", [t, document_id]);
  });
  return { sentences };
}
