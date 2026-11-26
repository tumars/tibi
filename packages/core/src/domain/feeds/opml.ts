import { XMLParser } from 'fast-xml-parser';
import { now } from '../../db/driver.js';
import { uuidv7 } from '../../ids.js';
import type { Ctx } from '../../rpc/define.js';
import { TibiError, type FeedKind } from '../../types.js';
import { checkUrlShape } from '../../web/url.js';
import { refreshFeeds } from './refresh.js';
import { getFeedByUrl, listFeeds, type FeedView } from './repo.js';

/**
 * OPML 2.0 导入与导出（19 §3.4）：同时服务电台管理（/radio/manage）与文章订阅管理（/feeds/manage）。
 */

export const MAX_OPML_IMPORT = 100;

export interface OpmlEntry {
  url: string;
  title?: string;
  site_url?: string;
  folder?: string;
}

export interface OpmlImportResult {
  added: number;
  skipped: number;
  invalid: number;
  total: number;
}

const opmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  htmlEntities: true,
  isArray: name => name === 'outline',
});

function pickAttr(node: Record<string, unknown>, names: string[]): string | undefined {
  for (const n of names) {
    const v = node[`@_${n}`];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // 大小写兜底（部分客户端输出 xmlurl / htmlurl）
  const keys = Object.keys(node);
  for (const n of names) {
    const low = `@_${n.toLowerCase()}`;
    const k = keys.find(x => x.toLowerCase() === low);
    if (k && typeof node[k] === 'string' && (node[k] as string).trim()) return (node[k] as string).trim();
  }
  return undefined;
}

function walkOutlines(nodes: unknown, folder: string | undefined, out: OpmlEntry[], seen: Set<string>): void {
  const list = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const node = raw as Record<string, unknown>;
    const xmlUrl = pickAttr(node, ['xmlUrl']);
    const label = pickAttr(node, ['title', 'text']);
    const htmlUrl = pickAttr(node, ['htmlUrl']);
    if (xmlUrl) {
      if (!seen.has(xmlUrl)) {
        seen.add(xmlUrl);
        out.push({
          url: xmlUrl,
          ...(label ? { title: label.slice(0, 200) } : {}),
          ...(htmlUrl && /^https?:\/\//i.test(htmlUrl) ? { site_url: htmlUrl } : {}),
          ...(folder ? { folder: folder.slice(0, 40) } : {}),
        });
      }
    }
    if (node.outline) {
      const nextFolder = !xmlUrl && label ? label.slice(0, 40) : folder;
      walkOutlines(node.outline, nextFolder, out, seen);
    }
  }
}

export function parseOpml(xml: string): OpmlEntry[] {
  const trimmed = xml.trim();
  if (!trimmed || !/<opml[\s>]/i.test(trimmed.slice(0, 4096))) {
    throw new TibiError('invalid_source', '不是有效的 OPML 文件');
  }
  let doc: Record<string, unknown>;
  try {
    doc = opmlParser.parse(trimmed) as Record<string, unknown>;
  } catch {
    throw new TibiError('invalid_source', 'OPML XML 解析失败');
  }
  const opml = doc.opml as Record<string, unknown> | undefined;
  const body = opml?.body as Record<string, unknown> | undefined;
  if (!body) throw new TibiError('invalid_source', 'OPML 文件缺少 body 节点');
  const out: OpmlEntry[] = [];
  walkOutlines(body.outline, undefined, out, new Set());
  return out;
}

const escXml = (s: string) => s
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

export function buildOpml(title: string, feeds: FeedView[]): string {
  const byFolder = new Map<string, FeedView[]>();
  const ungrouped: FeedView[] = [];
  for (const f of feeds) {
    if (f.folder?.trim()) {
      const list = byFolder.get(f.folder) ?? [];
      list.push(f);
      byFolder.set(f.folder, list);
    } else {
      ungrouped.push(f);
    }
  }
  const lineOf = (f: FeedView, indent: string) => {
    const attrs = [
      `type="rss"`,
      `text="${escXml(f.title)}"`,
      `title="${escXml(f.title)}"`,
      `xmlUrl="${escXml(f.url)}"`,
      ...(f.site_url ? [`htmlUrl="${escXml(f.site_url)}"`] : []),
    ];
    return `${indent}<outline ${attrs.join(' ')} />`;
  };
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${escXml(title)}</title>`,
    `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
    '  </head>',
    '  <body>',
  ];
  for (const [folder, list] of byFolder) {
    lines.push(`    <outline text="${escXml(folder)}" title="${escXml(folder)}">`);
    for (const f of list) lines.push(lineOf(f, '      '));
    lines.push('    </outline>');
  }
  for (const f of ungrouped) lines.push(lineOf(f, '    '));
  lines.push('  </body>', '</opml>', '');
  return lines.join('\n');
}

export async function importOpmlFeeds(
  ctx: Ctx,
  p: { xml: string; kind?: FeedKind; folder?: string },
): Promise<OpmlImportResult> {
  const entries = parseOpml(p.xml);
  if (!entries.length) throw new TibiError('invalid_source', 'OPML 文件里没有找到任何订阅源');

  const kind: FeedKind = p.kind ?? 'article';
  const defaultFolder = p.folder?.trim() ? p.folder.trim().slice(0, 40) : undefined;
  const slice = entries.slice(0, MAX_OPML_IMPORT);

  let invalid = 0;
  let skipped = 0;
  const toInsert: { url: string; title: string; title_custom: number; site_url: string | null; folder: string | null }[] = [];

  for (const e of slice) {
    const check = checkUrlShape(e.url);
    if (!check.ok || !check.url) { invalid++; continue; }
    const existing = await getFeedByUrl(ctx.db, check.url);
    if (existing) { skipped++; continue; }
    const host = check.host ?? check.url;
    const folder = e.folder || defaultFolder || null;
    toInsert.push({
      url: check.url,
      title: e.title || host,
      title_custom: e.title ? 1 : 0,
      site_url: e.site_url && checkUrlShape(e.site_url).ok ? e.site_url : null,
      folder,
    });
  }

  const addedIds: string[] = [];
  if (toInsert.length) {
    const t = now();
    await ctx.db.transaction(async tx => {
      for (const item of toInsert) {
        const id = uuidv7();
        await tx.run(
          'INSERT INTO feeds(id, url, site_url, title, title_custom, folder, kind, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
          [id, item.url, item.site_url, item.title, item.title_custom, item.folder, kind, t, t],
        );
        addedIds.push(id);
      }
    });
    ctx.events.emit('data.changed', { table: 'feeds', ids: addedIds });
    // 后台异步刷新刚导入的源，不阻塞导入返回
    void refreshFeeds(ctx, { feed_ids: addedIds, force: true }).catch(() => undefined);
  }

  return { added: addedIds.length, skipped, invalid, total: entries.length };
}

export async function exportOpmlFeeds(ctx: Ctx, kind?: FeedKind): Promise<{ filename: string; xml: string; count: number }> {
  const list = await listFeeds(ctx.db, kind);
  const label = kind === 'podcast' ? 'Tibi Podcasts' : kind === 'article' ? 'Tibi Feeds' : 'Tibi Subscriptions';
  const filename = kind === 'podcast' ? 'tibi-podcasts.opml' : kind === 'article' ? 'tibi-feeds.opml' : 'tibi-subscriptions.opml';
  return { filename, xml: buildOpml(label, list), count: list.length };
}
