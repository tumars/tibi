#!/usr/bin/env node
// 校验电台精选目录（schema + 连通性 + parseFeed + 更新活跃度 + <podcast:transcript> 实测）。
// 用法：node tools/verify-radio-catalog.mjs [catalog.json] [--skip-network]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRadioCatalog } from '../packages/core/src/domain/feeds/catalog-schema.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const skipNetwork = args.includes('--skip-network');
const fileArg = args.find(a => !a.startsWith('--'));
const target = fileArg ? resolve(fileArg) : join(root, 'packages/core/src/domain/feeds/catalog.default.json');

const raw = JSON.parse(readFileSync(target, 'utf8'));
const catalog = parseRadioCatalog(raw);
console.log(`schema 校验通过：${target}（v${catalog.version} · ${catalog.updated_at} · ${catalog.podcasts.length} 档）`);
if (skipNetwork) process.exit(0);

const { parseFeed } = await import('../packages/core/dist/domain/feeds/parse.js');

const CONCURRENCY = 6;
const STALE_DAYS = 180;
const queue = [...catalog.podcasts];
const errors = [];
const warnings = [];

async function checkOne(p) {
  try {
    const res = await fetch(p.feed_url, {
      headers: { 'user-agent': 'TibiCatalogVerifier/1.0', accept: 'application/rss+xml, application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) { errors.push(`${p.id}: RSS HTTP ${res.status}`); return; }
    const xml = await res.text();
    const parsed = parseFeed(xml, res.url || p.feed_url, res.headers.get('content-type') || '');
    if (!parsed || !parsed.items.some(i => i.audio_url)) { errors.push(`${p.id}: 未解析出音频单集`); return; }
    const latest = parsed.items.reduce((m, i) => Math.max(m, i.published_at ?? 0), 0);
    if (latest) {
      const ageDays = Math.round((Date.now() - latest) / 86_400_000);
      if (ageDays > STALE_DAYS) warnings.push(`${p.id}: 最近更新已过去 ${ageDays} 天`);
    }
    const actualTr = parsed.items.slice(0, 10).some(i => !!i.transcript_url);
    if (actualTr !== p.has_transcript) {
      warnings.push(`${p.id}: has_transcript 标注为 ${p.has_transcript}，实测为 ${actualTr}`);
    }
    const art = await fetch(p.artwork_url, { method: 'HEAD', signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    if (!art || !art.ok) warnings.push(`${p.id}: 封面返回 ${art?.status ?? '网络错误'}`);
  } catch (e) {
    errors.push(`${p.id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
  for (let p = queue.shift(); p; p = queue.shift()) await checkOne(p);
}));

for (const w of warnings) console.warn(`警告：${w}`);
for (const e of errors) console.error(`失败：${e}`);
console.log(`探活完成：${catalog.podcasts.length - errors.length}/${catalog.podcasts.length} 正常，${warnings.length} 条警告，${errors.length} 条失败`);
if (errors.length) process.exit(1);
