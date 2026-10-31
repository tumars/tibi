import { Type } from '@sinclair/typebox';
import { now } from '../../db/driver.js';
import { method, S, type Ctx, type MethodMap } from '../../rpc/define.js';
import { TibiError, type DocumentSummary, type Genre } from '../../types.js';
import { recordUndo, registerUndo } from '../shared/undo.js';
import { difficultyOfRatio } from '../text/prelabel.js';
import type { ImportInput } from './pipeline.js';
import { DOC_COLS, getDocument, listSections, listSentences, setDocumentTags, toDocument, toSummary, type DocumentRow } from './repo.js';
import { finishSection, sectionContent, setProgress, softDeleteDocument } from './sections.js';
import { listSamples } from './samples.js';

/** documents.* / sections.*（06 §3） */

/** 校验网址（不抓内容）：只收 http(s)，拒绝本机与内网字面地址；域名解析由平台在抓取时再查 */
export function checkUrlShape(raw: string): { ok: boolean; url?: string; host?: string; error?: 'invalid_source' } {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, error: 'invalid_source' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'invalid_source' };
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost') || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === '::1' || host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) return { ok: false, error: 'invalid_source' };
  u.hash = '';
  return { ok: true, url: u.toString(), host: host.replace(/^www\./, '') };
}

const sourceSchema = Type.Union([
  Type.Object({ type: Type.Literal('text'), text: Type.String({ minLength: 1 }), title: Type.Optional(Type.String()) }),
  Type.Object({ type: Type.Literal('url'), url: Type.String({ minLength: 1 }) }),
  Type.Object({ type: Type.Literal('file'), path: Type.String({ minLength: 1 }) }),
  Type.Object({ type: Type.Literal('images'), paths: Type.Array(Type.String()) }),
  Type.Object({ type: Type.Literal('sample'), id: Type.String() }),
]);
const hintsSchema = Type.Optional(Type.Object({ kind: Type.Optional(S.kind), genre: Type.Optional(S.genre), tags: Type.Optional(Type.Array(Type.String())) }));

export async function submitImport(ctx: Ctx, input: ImportInput): Promise<{ task_id: string }> {
  if (input.source.type === 'url') {
    const c = checkUrlShape(input.source.url);
    if (!c.ok) throw new TibiError('invalid_source', '网址不对，或者是本机 / 局域网地址');
    input.source = { type: 'url', url: c.url! };
  }
  if (input.source.type === 'file' && !ctx.platform.isPathAllowed(input.source.path)) throw new TibiError('permission_denied', '这个文件没有经过选择或拖入');
  const title = input.source.type === 'url' ? checkUrlShape(input.source.url).host ?? '网页' : input.source.type === 'text' ? (input.source.title || '粘贴的文字') : input.source.type === 'file' ? input.source.path.split(/[\\/]/).pop()! : '导入';
  return ctx.jobs.submit('import', { kind: 'import', title: `导入 ${title}`, trigger: input.origin === 'mcp' ? 'mcp' : input.origin === 'share' || input.origin === 'deeplink' ? 'share' : 'user', input });
}

async function requireDoc(ctx: Ctx, id: string): Promise<DocumentRow> {
  const d = await getDocument(ctx.db, id);
  if (!d || d.deleted_at) throw new TibiError('not_found', '文章不在了');
  return d;
}

export interface ListOpts { kind?: 'article' | 'book'; genre?: Genre; tags?: string[]; q?: string; sort?: 'fit' | 'opened' | 'added' | 'progress' | 'minutes'; archived?: boolean; status?: 'unread' | 'reading' | 'done'; cursor?: string; limit?: number }

export async function listDocuments(ctx: Ctx, opts: ListOpts): Promise<{ items: DocumentSummary[]; total: number; cursor?: string }> {
  const conds = ['d.deleted_at IS NULL', 'd.is_archived = ?']; const params: (string | number)[] = [opts.archived ? 1 : 0];
  if (opts.kind) { conds.push('d.kind = ?'); params.push(opts.kind); }
  if (opts.genre) { conds.push('d.genre = ?'); params.push(opts.genre); }
  if (opts.status === 'unread') conds.push('d.progress = 0 AND d.last_read_at IS NULL');
  if (opts.status === 'reading') conds.push('d.last_read_at IS NOT NULL AND d.finished_at IS NULL');
  if (opts.status === 'done') conds.push('d.finished_at IS NOT NULL');
  for (const tag of opts.tags ?? []) { conds.push('EXISTS (SELECT 1 FROM document_tags dt JOIN tags tg ON tg.id = dt.tag_id WHERE dt.document_id = d.id AND dt.deleted_at IS NULL AND tg.name = ? COLLATE NOCASE)'); params.push(tag); }
  if (opts.q) { conds.push('(d.title LIKE ? OR d.author LIKE ? OR d.source_uri LIKE ?)'); const like = `%${opts.q}%`; params.push(like, like, like); }
  const where = conds.join(' AND ');
  const rows = await ctx.db.all<DocumentRow>(`SELECT ${DOC_COLS.split(', ').map(c => 'd.' + c).join(', ')} FROM documents d WHERE ${where}`, params);
  const sort = opts.sort ?? 'fit';
  const fit = (d: DocumentRow) => Math.abs(Number(d.unknown_ratio ?? 0.04) - 0.04);
  rows.sort((a, b) => {
    if (sort === 'opened') return Number(b.last_read_at ?? 0) - Number(a.last_read_at ?? 0) || Number(b.created_at) - Number(a.created_at);
    if (sort === 'added') return Number(b.created_at) - Number(a.created_at);
    if (sort === 'progress') return Number(b.progress) - Number(a.progress);
    if (sort === 'minutes') return Number(a.word_count) - Number(b.word_count);
    // fit：读到一半的靠前，读完的放最后，其余按生词率接近 4%
    const ga = a.finished_at ? 2 : Number(a.progress) > 0 ? 0 : 1, gb = b.finished_at ? 2 : Number(b.progress) > 0 ? 0 : 1;
    return ga - gb || (ga === 0 ? Number(b.last_read_at ?? 0) - Number(a.last_read_at ?? 0) : fit(a) - fit(b));
  });
  const limit = opts.limit ?? 50; const offset = opts.cursor ? Number(opts.cursor) || 0 : 0;
  const page = rows.slice(offset, offset + limit);
  return { items: await Promise.all(page.map(d => toSummary(ctx.db, d))), total: rows.length, cursor: offset + page.length < rows.length ? String(offset + page.length) : undefined };
}

export const documentsMethods: MethodMap = {
  'documents.import': method(Type.Object({ source: sourceSchema, hints: hintsSchema, origin: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('deeplink')])) }), async (p, ctx) => submitImport(ctx, p as ImportInput), '长任务；进度走 task.update'),
  'documents.samples': method(Type.Object({}), async (_p, ctx) => listSamples(ctx.db), '内置示例（随应用打包，带预生成的总结与语境释义）；导入过的带 document_id'),
  'documents.checkUrl': method(Type.Object({ url: Type.String() }), async p => checkUrlShape(p.url), '按 §1 校验网址，不抓内容'),
  'documents.list': method(Type.Object({ kind: Type.Optional(S.kind), genre: Type.Optional(S.genre), tags: Type.Optional(Type.Array(Type.String())), q: Type.Optional(Type.String()), sort: Type.Optional(Type.Union(['fit', 'opened', 'added', 'progress', 'minutes'].map(s => Type.Literal(s)))), archived: Type.Optional(Type.Boolean()), status: Type.Optional(Type.Union(['unread', 'reading', 'done'].map(s => Type.Literal(s)))), ...S.page }), async (p, ctx) => listDocuments(ctx, p as ListOpts), '书架'),
  'documents.get': method(Type.Object({ id: S.id }), async (p, ctx) => toDocument(ctx.db, await requireDoc(ctx, p.id)), '含章节列表与文档级 AI 结果'),
  'documents.update': method(Type.Object({ id: S.id, patch: Type.Object({ title: Type.Optional(Type.String({ minLength: 1 })), genre: Type.Optional(S.genre), tags: Type.Optional(Type.Array(Type.String())), is_favorite: Type.Optional(Type.Boolean()), is_archived: Type.Optional(Type.Boolean()) }) }), async (p, ctx) => {
    const d = await requireDoc(ctx, p.id); const t = now();
    const prevTags = p.patch.tags ? (await toSummary(ctx.db, d)).tags : undefined;
    await ctx.db.transaction(async tx => {
      if (p.patch.title !== undefined) await tx.run('UPDATE documents SET title = ?, updated_at = ? WHERE id = ?', [p.patch.title, t, p.id]);
      if (p.patch.genre !== undefined && p.patch.genre !== d.genre) {
        await tx.run('UPDATE documents SET genre = ?, updated_at = ? WHERE id = ?', [p.patch.genre, t, p.id]);
        // 改类型后相关 AI 结果失效（01 §2）
        await tx.run("UPDATE ai_results SET deleted_at = ?, updated_at = ? WHERE scope = 'document' AND target_id = ? AND deleted_at IS NULL", [t, t, p.id]);
        await tx.run("UPDATE documents SET ai_status = CASE WHEN ai_status = 'none' THEN 'none' ELSE 'deferred' END WHERE id = ?", [p.id]);
      }
      if (p.patch.is_favorite !== undefined) await tx.run('UPDATE documents SET is_favorite = ?, updated_at = ? WHERE id = ?', [p.patch.is_favorite ? 1 : 0, t, p.id]);
      if (p.patch.is_archived !== undefined) await tx.run('UPDATE documents SET is_archived = ?, updated_at = ? WHERE id = ?', [p.patch.is_archived ? 1 : 0, t, p.id]);
      if (p.patch.tags) await setDocumentTags(tx, p.id, p.patch.tags, { source: 'user', replace: true });
    });
    await recordUndo(ctx.db, ctx, { tool: 'documents.update', args: p, undo_payload: { id: p.id, prev: { title: d.title, genre: d.genre, is_favorite: d.is_favorite, is_archived: d.is_archived, tags: prevTags } } });
    ctx.events.emit('data.changed', { table: 'documents', ids: [p.id] });
    return toDocument(ctx.db, (await getDocument(ctx.db, p.id))!);
  }, '改 genre 会让相关 ai_results 失效'),
  'documents.delete': method(Type.Object({ id: S.id }), async (p, ctx) => softDeleteDocument(ctx, p.id), '软删，可撤销'),
  'documents.reanalyze': method(Type.Object({ id: S.id, ai: Type.Optional(Type.Boolean()) }), async (p, ctx) => {
    const d = await requireDoc(ctx, p.id);
    return ctx.jobs.submit('reanalyze', { kind: 'import', title: `重新分析 ${d.title}`, input: { document_id: p.id, ai: p.ai } });
  }, '按当前词库重新标注'),
  'documents.export': method(Type.Object({ id: S.id, format: Type.Literal('markdown') }), async (p, ctx) => {
    const d = await requireDoc(ctx, p.id);
    const secs = await listSections(ctx.db, p.id);
    const parts = [`# ${d.title}`, ''];
    if (d.author) parts.push(`作者：${d.author}`, '');
    if (d.source_uri) parts.push(`来源：${d.source_uri}`, '');
    for (const s of secs) { if (secs.length > 1 && s.title) parts.push(`## ${s.title}`, ''); parts.push(s.content_md, ''); }
    // M0：返回内容而不是写文件（写文件要经壳），path 字段先放内容
    return { path: '', markdown: parts.join('\n') };
  }, 'M0 先返回 markdown 文本，写文件经壳再做'),

  'sections.get': method(Type.Object({ id: S.id, with: Type.Optional(Type.Array(Type.Union([Type.Literal('translations'), Type.Literal('ai')]))) }), async (p, ctx) => sectionContent(ctx.db, p.id, { translations: p.with?.includes('translations'), ai: p.with?.includes('ai') }), '阅读器一次取齐'),
  'sections.progress': method(Type.Object({ id: S.id, sentence_id: S.id, progress: Type.Number({ minimum: 0, maximum: 1 }) }), async (p, ctx) => { await setProgress(ctx.db, p.id, p.sentence_id, p.progress); return { ok: true as const }; }, '阅读位置'),
  'sections.finish': method(Type.Object({ id: S.id, mark_rest_known: Type.Boolean() }), async (p, ctx) => finishSection(ctx, p.id, p.mark_rest_known), '读完：只把 status = 0 的词设为 97'),
  'sections.translate': method(Type.Object({ id: S.id, sentence_ids: Type.Optional(Type.Array(S.id)) }), async (p, ctx) => {
    // M0 没有模型：标 deferred，返回一个立即完成的任务
    const sec = await ctx.db.get<{ document_id: string }>('SELECT document_id FROM sections WHERE id = ?', [p.id]); if (!sec) throw new TibiError('not_found', '找不到这一章');
    await ctx.db.run("UPDATE sections SET ai_status = 'deferred', updated_at = ? WHERE id = ? AND ai_status IN ('none')", [now(), p.id]);
    return ctx.jobs.submit('import', { kind: 'import', title: '翻译', input: { source: { type: 'sample', id: 'translate-stub' } } }).catch(() => ({ task_id: '' }));
  }, 'TODO：M2 接模型；现在只标 deferred'),
};

registerUndo<{ id: string; prev: { title: string; genre: string; is_favorite: number; is_archived: number; tags?: string[] } }>('documents.update', async (p, ctx) => {
  const t = now();
  await ctx.db.run('UPDATE documents SET title = ?, genre = ?, is_favorite = ?, is_archived = ?, updated_at = ? WHERE id = ?', [p.prev.title, p.prev.genre, p.prev.is_favorite, p.prev.is_archived, t, p.id]);
  if (p.prev.tags) await setDocumentTags(ctx.db, p.id, p.prev.tags, { replace: true });
  ctx.events.emit('data.changed', { table: 'documents', ids: [p.id] });
});

export { listSentences, difficultyOfRatio };
