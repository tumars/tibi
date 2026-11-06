#!/usr/bin/env node
/**
 * 打 Web 版（docs/design/12-web.md §7）→ dist-web/，可以直接 edgeone makers deploy dist-web。
 * 1. vite build（TIBI_WEBAPP=1：只打 web.html），web.html 改名 index.html
 * 2. 精简词典（scripts/web-dict.mjs）→ dist-web/dict/
 * 3. 边缘函数和 edgeone.json（web/）→ dist-web/；EdgeOne 要输出目录里有 package.json
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(app, 'dist-web');
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: app, stdio: 'inherit', env: { ...process.env, ...env } });

rmSync(dist, { recursive: true, force: true });
const version = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version;
run('pnpm', ['exec', 'vite', 'build'], { TIBI_WEBAPP: '1', VITE_APP_VERSION: version });
renameSync(join(dist, 'web.html'), join(dist, 'index.html'));

// 词典：CI 里传 TIBI_DICT_DB 指向完整 dict.db；本地默认用 src-tauri/resources 或 data/ecdict
run('node', ['scripts/web-dict.mjs', process.env.TIBI_DICT_DB ?? '', join(dist, 'dict')]);

cpSync(join(app, 'web/edge-functions'), join(dist, 'edge-functions'), { recursive: true });
cpSync(join(app, 'web/edgeone.json'), join(dist, 'edgeone.json'));
writeFileSync(join(dist, 'package.json'), JSON.stringify({ name: 'tibi-web', private: true, version, type: 'module' }, null, 2) + '\n');
if (!existsSync(join(dist, 'dict/manifest.json'))) throw new Error('词典没有生成');
console.log(`Web 版已打好：${dist}`);
