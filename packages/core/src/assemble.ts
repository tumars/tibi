import { feedsCapabilities, feedsMethods } from './domain/documents/feeds.js';
import { dictionaryMethods } from './domain/dictionary/methods.js';
import { searchMethods } from './domain/search/methods.js';
import { syncMethods } from './sync/methods.js';
import { SyncEngine } from './sync/engine.js';
import { Core } from './core.js';
import type { Database } from './db/driver.js';
import type { Dict } from './dict/types.js';
import { documentsCapabilities, documentsMethods, recoverAnalysis } from './domain/documents/index.js';
import { configCapabilities, profileMethods } from './domain/profile/index.js';
import { reviewCapabilities, reviewMethods } from './domain/review/index.js';
import { undoMethods } from './domain/shared/undo.js';
import { statsCapabilities, statsMethods } from './domain/stats/index.js';
import { termsCapabilities, termsMethods } from './domain/terms/index.js';
import { createKernel, type Kernel, type KernelOptions } from './kernel/index.js';
import { EventBus } from './kernel/types.js';
import type { Platform } from './platform.js';

/**
 * 组装一个完整的 Tibi Core（桌面、手机、测试共用）：
 * 数据库 + 词典 + 平台 → 内核（对话、技能、记忆）→ 各领域的方法与能力 → 收拾上次没做完的。
 */
export interface AssembleOptions extends KernelOptions {
  db: Database;
  dict?: Dict;
  platform: Platform;
  /** 启动时收拾上次没做完的：没答完的回答记成中断，做了一半的总结改回稍后补做（测试里通常关掉） */
  resume?: boolean;
}

export async function assembleCore(opts: AssembleOptions): Promise<{ core: Core; kernel: Kernel }> {
  const kernel = createKernel(opts.db, new EventBus(), { resolveModel: opts.resolveModel, device: opts.device, engine: opts.engine });
  const core = new Core({ db: opts.db, dict: opts.dict, platform: opts.platform });
  core.ai = (ctx, o) => kernel.complete(ctx, o);
  kernel.bind(caller => core.ctx(caller), core.events);

  core.use(undoMethods)
    .use(kernel.methods)
    .use(documentsMethods)
    .use(termsMethods)
    .use(reviewMethods)
    .use(statsMethods)
    .use(profileMethods)
    .use(feedsMethods)
    .use(searchMethods)
    .use(dictionaryMethods)
    .use(syncMethods);

  kernel.registerCapabilities({ ...feedsCapabilities, ...documentsCapabilities, ...termsCapabilities, ...reviewCapabilities, ...statsCapabilities, ...configCapabilities });
  // 同步开着时按当前表结构重建触发器（08 §5）
  await SyncEngine.resume(core.db);

  if (opts.resume !== false) { await kernel.recover(); await recoverAnalysis(core.db); }
  return { core, kernel };
}
