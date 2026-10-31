/**
 * M0 技术验证（05 §11 第 2、4 项）：pi-agent-core + DeepSeek 的工具调用与流式输出、审批挂起、取消后续跑。
 *   DEEPSEEK_API_KEY=sk-… pnpm --filter @tibi/core-node exec tsx src/spike/deepseek.ts
 * 没有 Key 时只打印说明。模型名可用 TIBI_MODEL 覆盖（默认 deepseek-flash）。
 */
import { capability, Core, EventBus, fakePlatform, undoMethods } from '@tibi/core';
// 主线把 kernel 从 @tibi/core 导出后改成正常 import；现在用运行时路径绕开 core-node 的 rootDir
const { createKernel, skillDef } = (await import(/* @vite-ignore */ new URL('../../../core/src/kernel/index.js', import.meta.url).href)) as { createKernel: (db: unknown, events: unknown) => any; skillDef: (id: string) => { allowed_tools: string[] } | undefined };
import { openAppDb } from '../sqlite.js';

const key = process.env['DEEPSEEK_API_KEY'];
if (!key) {
  console.log('没有 DEEPSEEK_API_KEY，跳过。用法：DEEPSEEK_API_KEY=sk-… pnpm --filter @tibi/core-node exec tsx src/spike/deepseek.ts');
  process.exit(0);
}

const model = process.env['TIBI_MODEL'] ?? 'deepseek-flash';
const db = await openAppDb(':memory:');
const t = Date.now();
await db.run("INSERT INTO user_profile(id, level_self, vocab_estimate, goal, created_at, updated_at) VALUES ('1', 'cet6', 6000, 'work', ?, ?)", [t, t]);
await db.run("INSERT INTO providers(id, kind, name, protocol, base_url, tier, model, secret_ref, is_default, created_at, updated_at) VALUES ('deepseek', 'llm', 'DeepSeek', 'deepseek', 'https://api.deepseek.com', 'fast', ?, 'deepseek', 1, ?, ?)", [model, t, t]);

const kernel = createKernel(db, new EventBus());
const core = new Core({ db, platform: fakePlatform({ isOnline: () => true, getSecret: async ref => (ref === 'deepseek' ? key : undefined) }), jobs: kernel.jobs });
kernel.bind((caller: Parameters<typeof core.ctx>[0]) => core.ctx(caller), core.events);
core.use(kernel.methods); core.use(undoMethods);
kernel.registerCapabilities({
  lookup_word: capability({ name: 'lookup_word', description: '查词典', perm: 'read', params: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] } as never, async run(p: { word: string }) { return { word: p.word, phonetic: '/ˈʌpʃɒt/', translation: 'n. 结果，结局', examples: [{ en: 'The upshot is that we lost.' }] }; } }),
  mark_term: capability({ name: 'mark_term', description: '标记一个词的熟练度', perm: 'confirm', undoable: true, params: { type: 'object', properties: { term: { type: 'string' }, status: { type: 'integer' } }, required: ['term', 'status'] } as never, async run(p: { term: string; status: number }) { console.log(`\n[能力] mark_term 执行：${p.term} → ${p.status}`); return { term_id: 'fake', previous: 0 }; } }),
} as never);

skillDef('tutor')!.allowed_tools.push('mark_term');

core.events.on((event, data: any) => {
  if (event === 'chat.delta') process.stdout.write(data.delta ?? '');
  else if (event === 'chat.tool') console.log(`\n[工具] ${data.tool} ${data.phase}${data.duration_ms ? ` ${data.duration_ms}ms` : ''}`);
  else if (event === 'approval.requested') { console.log(`\n[审批] ${data.approval.title}：${data.approval.body} → 自动允许`); void core.call('tasks.approve', { id: data.approval.task_id, decision: 'allow' }); }
  else if (event === 'usage.updated') console.log(`\n[用量] 本月 ¥${data.total.toFixed(4)}`);
});

console.log(`== 1. 讲解技能 + 工具调用（${model}） ==`);
const conv = await core.call<{ id: string }>('chat.open', {});
kernel.setUiContext({ page: 'reader', selection: 'The upshot is memory safety without the runtime overhead.', sentence_id: 's1' });
const { submission_id } = await core.call<{ submission_id: string }>('chat.send', { conversation_id: conv.id, text: '先用 lookup_word 查 upshot，再用 mark_term 把它标为 1，然后用一句话解释它在这句里的意思。', skill: 'tutor' });
const r = await kernel.jobs.wait(submission_id, 120_000);
console.log(`\n任务：${r.status}${r.error ? ' ' + r.error : ''}`);
const task = await core.call<{ steps: unknown[]; usage: { tokens_in: number; tokens_out: number; cost: number } }>('tasks.get', { id: submission_id });
console.log(`步骤 ${task.steps.length} 个，tokens in ${task.usage.tokens_in} / out ${task.usage.tokens_out}，花费 ¥${task.usage.cost.toFixed(4)}`);

console.log('\n== 2. 中途取消，再 resumeAll 续跑 ==');
const { submission_id: s2 } = await core.call<{ submission_id: string }>('chat.send', { conversation_id: conv.id, text: '用三句话介绍 Rust 的所有权。', skill: 'tutor' });
await new Promise(r => setTimeout(r, 1500));
await kernel.jobs.cancel(s2);
console.log(`\n取消后：${(await kernel.jobs.wait(s2)).status}`);
await db.run("UPDATE jobs SET status = 'running' WHERE id = ?", [s2]);   // 模拟进程死在运行中
const n = await kernel.jobs.resumeAll();
console.log(`resumeAll 接着跑 ${n} 个`);
const r2 = await kernel.jobs.wait(s2, 120_000);
console.log(`\n续跑后：${r2.status}`);
console.log((await core.call<{ text: string }>('tasks.diagnostics', { id: s2 })).text);
await db.close();
