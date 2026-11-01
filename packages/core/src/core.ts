import type { Database } from './db/driver.js';
import type { CompleteOptions, CompleteResult } from './kernel/complete.js';
import { NullDict, type Dict } from './dict/types.js';
import { EventBus, type JobRunner } from './kernel/types.js';
import type { Platform } from './platform.js';
import { Dispatcher, type RpcRequest } from './rpc/dispatcher.js';
import type { Ctx, MethodMap } from './rpc/define.js';
import { systemMethods } from './rpc/system.js';

/**
 * 组装一个 Core 实例：数据库 + 词典 + 平台 + 内核 + 方法表。
 * 各模块把自己的方法表（documents.*、terms.*、review.* …）通过 `use()` 挂进来。
 */
export interface CoreOptions { db: Database; dict?: Dict; platform: Platform; jobs: JobRunner }
type AiComplete = (ctx: Ctx, o: CompleteOptions) => Promise<CompleteResult>;

export class Core {
  readonly events = new EventBus();
  readonly dispatcher: Dispatcher;
  readonly db: Database;
  readonly dict: Dict;
  readonly platform: Platform;
  readonly jobs: JobRunner;
  /** 内核装上后才有（assembleCore） */
  ai?: AiComplete;

  constructor(opts: CoreOptions) {
    this.db = opts.db; this.dict = opts.dict ?? new NullDict(); this.platform = opts.platform; this.jobs = opts.jobs;
    this.dispatcher = new Dispatcher(() => this.ctx({ origin: 'ui' }));
    this.dispatcher.add(systemMethods);
  }

  use(methods: MethodMap) { this.dispatcher.add(methods); return this; }

  ctx(caller: Ctx['caller']): Ctx {
    const self = this;
    const ctx: Ctx = {
      db: this.db, dict: this.dict, platform: this.platform, events: this.events, jobs: this.jobs, caller,
      async permission() {
        const row = await self.db.get<{ assistant_prefs: string }>("SELECT assistant_prefs FROM user_profile WHERE id = '1'");
        try { return (JSON.parse(row?.assistant_prefs ?? '{}').permission as 'ask' | 'default' | 'auto') ?? 'default'; } catch { return 'default'; }
      },
      call: <T>(m: string, p: unknown) => self.dispatcher.call<T>(m, p, ctx),
      ai: self.ai ? { complete: o => self.ai!(ctx, o) } : undefined,
    };
    return ctx;
  }

  handle(req: RpcRequest) { return this.dispatcher.handle(req); }
  /** 内部直接调用（测试、技能、MCP） */
  call<T = unknown>(m: string, p: unknown, caller: Ctx['caller'] = { origin: 'ui' }) { return this.dispatcher.call<T>(m, p, this.ctx(caller)); }
}
