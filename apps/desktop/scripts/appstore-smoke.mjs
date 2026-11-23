// 对待签名发行副本执行真实 Core 验证；此阶段 Core 需使用仅 JIT 权限的本地测试签名。
// 最终商店签名后，仍需通过完整 App 验证沙盒继承。
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const app = resolve(process.argv[2]);
const binary = join(app, 'Contents/MacOS/tibi-core');
const resources = join(app, 'Contents/Resources');
const dir = mkdtempSync(join(tmpdir(), 'tibi-mas-smoke-'));
const intl = execFileSync(binary, ['-e', `
  const assert = (v) => { if (!v) throw new Error('ICU regression'); };
  assert(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Singapore', year: 'numeric' }).format(new Date('2026-01-01')) === '2026');
  assert(new Intl.NumberFormat('en-US').format(1234.5) === '1,234.5');
  assert(new Intl.NumberFormat('en-US').formatRange(1, 3).includes('3'));
  assert(new Intl.Collator('en').compare('a', 'b') < 0);
  assert([...new Intl.Segmenter('en', { granularity: 'word' }).segment('Hello world')].length === 3);
  assert(new Intl.PluralRules('en').select(1) === 'one');
  assert(new Intl.RelativeTimeFormat('en').format(-1, 'day') === '1 day ago');
  assert(new Intl.ListFormat('en').format(['A', 'B']).includes('and'));
  assert(new Intl.DisplayNames('en', { type: 'region' }).of('US') === 'United States');
  assert(new Intl.Locale('zh').maximize().script === 'Hans');
  assert('e\\u0301'.normalize('NFC') === 'é');
  console.log('ICU: date, timezone, number/range, collation, segmentation, plurals, relative time, lists, locale, normalization OK');
`], { encoding: 'utf8', env: { ...process.env, BUN_BE_BUN: '1' }, timeout: 30_000 });
console.log(intl.trim());

async function start() {
  const child = spawn(binary, ['--stdio', '--no-mcp', '--db', join(dir, 'app.db'), '--dict', join(resources, 'dict.db')], {
    env: { ...process.env, TIBI_RESOURCE_DIR: resources }, stdio: ['pipe', 'pipe', 'inherit'],
  });
  let id = 0;
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    const message = JSON.parse(line);
    if (message.method === 'secret.get') child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }) + '\n');
    const task = pending.get(message.id);
    if (task) { clearTimeout(task.timer); pending.delete(message.id); message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result); }
  });
  child.on('exit', code => {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error(`Core exited: ${code}`)); }
    pending.clear();
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`${method} timed out`)); }, 30_000);
    pending.set(key, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params }) + '\n');
  });
  return { call, stop: () => { child.stdin.end(); lines.close(); child.kill(); } };
}
let core = await start();
try {
  assert.equal((await core.call('system.status')).db_path, join(dir, 'app.db'));
  const entry = await core.call('dict.entry', { word: 'compiler' });
  assert.equal(entry.entry.word, 'compiler');
  await core.call('documents.import', { source: { type: 'text', title: 'ICU smoke', text: 'The compiler reads a café story. 国际化测试。' } });
  let docs;
  for (let i = 0; i < 50; i++) {
    docs = await core.call('documents.list');
    if (docs.items?.length) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(docs.items?.length > 0, JSON.stringify(docs));
  const documentId = docs.items[0].id;
  assert.equal((await core.call('documents.get', { id: documentId })).id, documentId);
  await core.call('search.query', { q: 'compiler' });
  const backup = await core.call('system.backup', { reason: 'manual' });
  assert.ok(backup.size > 0 && existsSync(backup.path));
  core.stop();
  core = await start();
  assert.ok((await core.call('documents.list')).items.some(item => item.id === documentId));
  console.log(`Core: startup, dictionary, import/read, search, backup, restart persistence OK (${dir})`);
} finally { core.stop(); }
