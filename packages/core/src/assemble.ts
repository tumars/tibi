import { Core } from './core.js';
import type { Database } from './db/driver.js';
import type { Dict } from './dict/types.js';
import { documentsCapabilities, documentsMethods, registerImportPipeline } from './domain/documents/index.js';
import { profileMethods } from './domain/profile/index.js';
import { reviewCapabilities, reviewMethods } from './domain/review/index.js';
import { undoMethods } from './domain/shared/undo.js';
import { statsCapabilities, statsMethods } from './domain/stats/index.js';
import { termsCapabilities, termsMethods } from './domain/terms/index.js';
import { createKernel, type Kernel, type KernelOptions } from './kernel/index.js';
import { EventBus } from './kernel/types.js';
import type { Platform } from './platform.js';

/**
 * 组装一个完整的 Tibi Core（桌面、手机、测试共用）：
 * 数据库 + 词典 + 平台 → 内核（任务、对话、技能、记忆）→ 各领域的方法与能力 → 导入流水线 → 续跑。
 */
export interface AssembleOptions extends KernelOptions {
  db: Database;
  dict?: Dict;
  platform: Platform;
  /** 启动时把没跑完的任务接着跑（测试里通常关掉） */
  resume?: boolean;
}

export async function assembleCore(opts: AssembleOptions): Promise<{ core: Core; kernel: Kernel }> {
  const kernel = createKernel(opts.db, new EventBus(), { resolveModel: opts.resolveModel, device: opts.device });
  const core = new Core({ db: opts.db, dict: opts.dict, platform: opts.platform, jobs: kernel.jobs });
  core.ai = (ctx, o) => kernel.complete(ctx, o);
  kernel.bind(caller => core.ctx(caller), core.events);

  core.use(undoMethods)
    .use(kernel.methods)
    .use(documentsMethods)
    .use(termsMethods)
    .use(reviewMethods)
    .use(statsMethods)
    .use(profileMethods);

  kernel.registerCapabilities({ ...documentsCapabilities, ...termsCapabilities, ...reviewCapabilities, ...statsCapabilities });
  registerImportPipeline(kernel.jobs, core);

  if (opts.resume !== false) await kernel.jobs.resumeAll();
  return { core, kernel };
}
