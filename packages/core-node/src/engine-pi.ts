import { mkdirSync } from 'node:fs';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import {
  createAgentSession, createToolSearchExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
  type AgentSession, type AgentSessionEvent, type ExtensionFactory, type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { AgentEngine, CompactionBody, EngineOutcome, EngineRun, EngineTool, StoredMessage } from '@tibi/core';

/**
 * PiEngine（10 §3–§9）：用 pi-coding-agent 的 AgentSession 跑技能，实现 Core 的 AgentEngine。
 *
 * - 每段对话一个常驻会话，pi 自己维护上下文；会话里最后一条和库里对不上（回退、删除、同步、重试）就从 Tibi 的记录重建。
 * - 只开 Tibi 的工具（不开 read / bash / edit / write），cwd 和 agentDir 是一个空目录，不读写 ~/.pi。
 * - 压缩、重试、工具按需加载（tool_search）、插话都用 pi 的；预算、回合上限由 Tibi 扩展执行。
 * - 反问（ask_user）是普通工具：在 Core 里原地等用户回答，pi 照常等工具结果，没有超时。
 * - 每条定稿的消息交给 Core 写库（hooks.onMessage），压缩结果也一样。
 */
export interface PiEngineOptions {
  /** 空目录（应用数据目录下）：pi 的 cwd / agentDir，里面不会有任何东西 */
  workDir: string;
  /** 常驻会话的上限和闲置回收时间 */
  maxLive?: number;
  idleMs?: number;
  retry?: { maxRetries?: number; baseDelayMs?: number };
  compaction?: { reserveTokens?: number; keepRecentTokens?: number };
}

interface RunState {
  req: EngineRun;
  turn: number;
  tools: Map<string, EngineTool>;
  /** 插话的消息在库里的 ID，按顺序对上 pi 回报的用户消息 */
  pendingUserIds: string[];
  chain: Promise<unknown>;
  stopError?: string;
}

interface Live {
  key: string;
  session: AgentSession;
  version: string;
  /** 会话里最后一条消息在库里的 ID */
  lastId?: string;
  lastUsed: number;
  run?: RunState;
  /** 最近一次运行的回调：运行结束后才压缩时也能写库 */
  hooks?: EngineRun['hooks'];
  rowOf: WeakMap<object, string>;
  /** 运行时追加的 note 条目（pi 自己起的 ID）→ 库里的 ID */
  rowOfEntry: Map<string, string>;
  stale: boolean;
  unsub: () => void;
}

export class PiEngine implements AgentEngine {
  readonly id = 'pi';
  private live = new Map<string, Live>();
  private runtime?: Promise<ModelRuntime>;
  private timer?: ReturnType<typeof setInterval>;
  private readonly maxLive: number;
  private readonly idleMs: number;

  constructor(private readonly opts: PiEngineOptions) {
    mkdirSync(opts.workDir, { recursive: true });
    this.maxLive = opts.maxLive ?? 8;
    this.idleMs = opts.idleMs ?? 15 * 60_000;
    this.timer = setInterval(() => this.evict(), 60_000);
    this.timer.unref?.();
  }

  async run(req: EngineRun): Promise<EngineOutcome> {
    const key = req.conversation_id;
    let live = key ? this.live.get(key) : undefined;
    if (live && (live.run || live.stale || live.version !== req.config.version || live.lastId !== req.lastMessageId)) {
      if (live.run) return { status: 'error', error: '这段对话正在回答' };
      this.drop(live);
      live = undefined;
    }
    live ??= await this.create(req, key);
    if (key) this.live.set(key, live);

    const run: RunState = { req, turn: 0, tools: new Map(req.config.tools.map(t => [t.name, t])), pendingUserIds: req.inputMessageId ? [req.inputMessageId] : [], chain: Promise.resolve() };
    live.run = run; live.hooks = req.hooks;
    const onAbort = () => void live!.session.abort();
    req.signal.addEventListener('abort', onAbort, { once: true });
    let outcome: EngineOutcome = { status: 'error', error: '模型没有回复' };
    try {
      await this.useModel(live, req);
      const text = typeof req.input === 'string' ? req.input : req.input.map(p => p.text).join('\n\n');
      try { await live.session.prompt(text); } catch (e) { run.stopError ??= e instanceof Error ? e.message : String(e); }
      await run.chain;
      const last = [...live.session.messages].reverse().find(m => m.role === 'assistant') as { stopReason?: string; errorMessage?: string } | undefined;
      if (req.signal.aborted) outcome = { status: 'aborted', ...(run.stopError ? { error: run.stopError } : {}) };
      else if (run.stopError) outcome = { status: 'error', error: run.stopError };
      else if (last?.stopReason === 'aborted') outcome = { status: 'aborted' };
      else if (last?.stopReason === 'error') outcome = { status: 'error', error: last.errorMessage ?? '模型出错了' };
      else outcome = { status: 'done' };
      return outcome;
    } finally {
      req.signal.removeEventListener('abort', onAbort);
      live.run = undefined;
      live.lastUsed = Date.now();
      // 出过错、被取消，或没有对话：会话里可能留着出错的回答，和库不一定一致，下次从库里重建
      if (!key || outcome.status !== 'done') this.drop(live);
      else this.evict();
    }
  }

  steer(conversation_id: string, text: string, messageId: string): boolean {
    const live = this.live.get(conversation_id);
    if (!live?.run || !live.session.isStreaming) return false;
    live.run.pendingUserIds.push(messageId);
    void live.session.steer(text);
    return true;
  }

  note(conversation_id: string, text: string, messageId: string): void {
    const live = this.live.get(conversation_id);
    if (!live || live.stale) return;
    // 空闲时直接追加进会话，排在下一句用户的话之前（和库里一致）；pi 的 nextTurn 会把它排在用户的话后面
    void live.session.sendCustomMessage({ customType: 'tibi.note', content: text, display: false }).then(() => {
      if (live.run) return;
      live.lastId = messageId;
      const e = live.session.sessionManager.getEntries().at(-1);
      if (e?.type === 'custom_message') live.rowOfEntry.set(e.id, messageId);
    }, () => { live.stale = true; });
    if (live.run) live.stale = true;   // 运行中插进来的 note 要等这一轮结束才追加，和库里的顺序可能对不上：这次之后重建
  }

  invalidate(conversation_id: string): void {
    const live = this.live.get(conversation_id);
    if (!live) return;
    if (live.run) live.stale = true; else this.drop(live);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    for (const l of [...this.live.values()]) this.drop(l);
  }

  // ---------- 内部 ----------

  private drop(live: Live) {
    live.unsub();
    try { live.session.dispose(); } catch { /* 已经释放 */ }
    if (this.live.get(live.key) === live) this.live.delete(live.key);
  }

  private evict() {
    const now = Date.now();
    const idle = [...this.live.values()].filter(l => !l.run).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const l of idle) if (now - l.lastUsed > this.idleMs) this.drop(l);
    const rest = [...this.live.values()].filter(l => !l.run).sort((a, b) => a.lastUsed - b.lastUsed);
    while (this.live.size > this.maxLive && rest.length) this.drop(rest.shift()!);
  }

  private getRuntime(): Promise<ModelRuntime> {
    // 内存凭据、不读 models.json、不联网刷新模型目录
    this.runtime ??= ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    return this.runtime;
  }

  /** 服务商和 Key 每次运行都重新注册（用户可能刚换了模型或 Key） */
  private async registerModel(req: EngineRun): Promise<ModelRuntime> {
    const runtime = await this.getRuntime();
    const { provider, apiKey } = req.config.model;
    runtime.registerNativeProvider(provider);
    if (apiKey) { try { await runtime.setRuntimeApiKey(provider.id, apiKey); } catch { /* 服务商自己的 auth 已经带了 Key */ } }
    return runtime;
  }

  private async useModel(live: Live, req: EngineRun) {
    await this.registerModel(req);
    const m = req.config.model.model;
    const cur = live.session.model;
    if (!cur || cur.id !== m.id || cur.provider !== m.provider) await live.session.setModel(m);
    live.session.setThinkingLevel(req.config.model.thinking ?? 'off');
  }

  private async create(req: EngineRun, key: string | undefined): Promise<Live> {
    const runtime = await this.registerModel(req);
    const dir = this.opts.workDir;
    const settingsManager = SettingsManager.inMemory({
      cacheWarming: 'off', enableInstallTelemetry: false,
      compaction: { enabled: true, reserveTokens: req.config.compaction?.reserveTokens ?? this.opts.compaction?.reserveTokens ?? 16384, keepRecentTokens: req.config.compaction?.keepRecentTokens ?? this.opts.compaction?.keepRecentTokens ?? 20000 },
      retry: { enabled: true, maxRetries: this.opts.retry?.maxRetries ?? 3, baseDelayMs: this.opts.retry?.baseDelayMs ?? 2000 },
    } as never);
    const holder: { live?: Live; systemPrompt: string } = { systemPrompt: req.config.systemPrompt };
    const factories: ExtensionFactory[] = [tibiExtension(holder)];
    if (req.config.tools.some(t => t.deferred)) factories.push(createToolSearchExtension());
    const resourceLoader = new DefaultResourceLoader({
      cwd: dir, agentDir: dir, settingsManager, extensionFactories: factories,
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPrompt: req.config.systemPrompt,
    });
    await resourceLoader.reload();
    const entries = toEntries(key ? await req.history() : []);
    const sessionManager = SessionManager.inMemory(dir, {}, entries as never);
    const customTools: ToolDefinition[] = req.config.tools.map(t => ({
      name: t.name, label: t.name, description: t.description, parameters: t.parameters as never,
      ...(t.deferred ? { exposure: 'deferred', defaultActive: false } : {}),
      async execute(toolCallId: string, params: unknown, signal?: AbortSignal) {
        const run = holder.live?.run;
        const tool = run?.tools.get(t.name);
        if (!tool) return { content: [{ type: 'text', text: '错误：这个工具现在不能用' }], details: undefined, isError: true };
        const r = await tool.execute(toolCallId, params, signal);
        return { content: [{ type: 'text', text: r.text }], details: undefined, ...(r.isError ? { isError: true } : {}) };
      },
    }) as unknown as ToolDefinition);
    const { session } = await createAgentSession({
      cwd: dir, agentDir: dir, model: req.config.model.model, thinkingLevel: req.config.model.thinking ?? 'off',
      modelRuntime: runtime, resourceLoader, settingsManager, sessionManager, noTools: 'builtin', customTools,
    });
    await session.bindExtensions({});
    // pi 的 tool_search 注册时是不启用的：有按需工具时打开它（它搜到的工具下一轮生效）
    if (req.config.tools.some(t => t.deferred)) session.setActiveToolsByName([...session.getActiveToolNames(), 'tool_search']);
    const live: Live = { key: key ?? `tmp:${Math.random()}`, session, version: req.config.version, lastId: entries.length ? (entries[entries.length - 1] as { id: string }).id : undefined, lastUsed: Date.now(), rowOf: new WeakMap(), rowOfEntry: new Map(), stale: false, unsub: () => {} };
    // 预填的条目 ID 就是 Tibi 的消息 ID
    for (const e of sessionManager.getEntries()) { const msg = (e as { message?: object }).message; if (msg) live.rowOf.set(msg, e.id); }
    holder.live = live;
    live.unsub = session.subscribe(ev => this.onEvent(live, ev));
    return live;
  }

  private onEvent(live: Live, ev: AgentSessionEvent) {
    const run = live.run;
    const hooks = run?.req.hooks ?? live.hooks;
    if (!hooks) return;
    const persist = (fn: () => Promise<void>) => { if (run) run.chain = run.chain.then(fn, fn); else void fn(); };
    switch (ev.type) {
      case 'message_update':
        if (ev.assistantMessageEvent.type === 'text_delta') hooks.onEvent({ type: 'text_delta', delta: ev.assistantMessageEvent.delta });
        else if (ev.assistantMessageEvent.type === 'thinking_delta') hooks.onEvent({ type: 'thinking_delta', delta: ev.assistantMessageEvent.delta });
        break;
      case 'tool_execution_start':
        hooks.onEvent({ type: 'tool_start', toolCallId: ev.toolCallId, name: ev.toolName, args: ev.args });
        break;
      case 'tool_execution_end':
        hooks.onEvent({ type: 'tool_end', toolCallId: ev.toolCallId, name: ev.toolName, isError: !!ev.isError });
        break;
      case 'auto_retry_start':
        hooks.onEvent({ type: 'retry', attempt: ev.attempt, maxAttempts: ev.maxAttempts, error: ev.errorMessage });
        break;
      case 'auto_retry_end':
        hooks.onEvent({ type: 'retry_end', ok: ev.success, ...(ev.finalError ? { error: ev.finalError } : {}) });
        break;
      case 'compaction_start':
        hooks.onEvent({ type: 'compaction', phase: 'start' });
        break;
      case 'compaction_end':
        hooks.onEvent({ type: 'compaction', phase: 'end', ok: !!ev.result && !ev.aborted });
        if (ev.result) {
          const r = ev.result;
          const firstKept = live.session.sessionManager.getEntry(r.firstKeptEntryId) as { id: string; message?: object } | undefined;
          const first_kept_id = (firstKept?.message && live.rowOf.get(firstKept.message)) ?? live.rowOfEntry.get(r.firstKeptEntryId) ?? firstKept?.id ?? r.firstKeptEntryId;
          const latest = [...live.session.sessionManager.getEntries()].reverse().find(e => e.type === 'compaction') as Record<string, unknown> | undefined;
          const { id: _id, parentId: _p, timestamp: _t, type: _ty, ...entry } = latest ?? {};
          const body: CompactionBody = { ...entry, summary: r.summary, first_kept_id, tokens_before: r.tokensBefore };
          persist(async () => { const id = await hooks.onMessage({ role: 'compaction', body, usage: r.usage }); live.lastId = id; });
        }
        break;
      case 'message_end': {
        const msg = ev.message as { role: string; content?: unknown; toolCallId?: string; usage?: never; model?: string };
        if (msg.role === 'user') {
          const id = run?.pendingUserIds.shift();
          if (id) { live.rowOf.set(msg, id); live.lastId = id; }
        } else if (msg.role === 'assistant') {
          // 停在发请求之前（取消、超预算）的空回答：没有内容，不写库
          const stop = (msg as { stopReason?: string }).stopReason;
          if (stop === 'aborted' && !(Array.isArray(msg.content) && msg.content.length)) break;
          persist(async () => { const id = await hooks.onMessage({ role: 'assistant', body: msg, usage: msg.usage, model: msg.model ?? '' }); live.rowOf.set(msg, id); live.lastId = id; });
        } else if (msg.role === 'toolResult') {
          persist(async () => { const id = await hooks.onMessage({ role: 'tool_result', body: msg, toolCallId: msg.toolCallId ?? '' }); live.rowOf.set(msg, id); live.lastId = id; });
        }
        break;
      }
    }
  }
}

/** Tibi 的规则：每轮开始前查预算和回合数 */
function tibiExtension(holder: { live?: Live; systemPrompt: string }): ExtensionFactory {
  return pi => {
    // 系统提示整段用 Tibi 的：pi 默认会再加编程助手的序言、规则、cwd 这些节
    pi.on('before_agent_start', async () => ({ systemPrompt: holder.systemPrompt }));
    pi.on('turn_start', async (_ev, ctx) => {
      const run = holder.live?.run;
      if (!run) return;
      run.turn++;
      try { await run.req.hooks.beforeTurn(run.turn); } catch (e) { run.stopError = e instanceof Error ? e.message : String(e); ctx.abort(); }
    });
  };
}

/** Tibi 的记录 → pi 的会话条目（10 §5.2）：按时间串成一条链；没执行完的工具调用补一条出错的结果 */
function toEntries(history: StoredMessage[]): object[] {
  const out: object[] = [];
  let parent: string | null = null;
  let pending: { id: string; name: string }[] = [];
  const push = (e: Record<string, unknown>) => { out.push({ ...e, parentId: parent }); parent = e.id as string; };
  const close = (at: number) => {
    for (const c of pending) push({ type: 'message', id: `${c.id}_missing`, timestamp: new Date(at).toISOString(), message: { role: 'toolResult', toolCallId: c.id, toolName: c.name, content: [{ type: 'text', text: '错误：这一步没有执行完（中断了）' }], isError: true, timestamp: at } });
    pending = [];
  };
  for (const m of history) {
    const ts = new Date(m.created_at).toISOString();
    if (m.role !== 'tool_result') close(m.created_at);
    if (m.role === 'user' || m.role === 'assistant' || m.role === 'tool_result') {
      const body = m.body as { role?: string; content?: unknown; toolCallId?: string };
      if (m.role === 'assistant') {
        const content = Array.isArray(body.content) ? body.content as { type: string; id?: string; name?: string }[] : [];
        if (!content.length) continue;   // 出错时的空回答不进上下文
        pending = content.filter(c => c.type === 'toolCall').map(c => ({ id: c.id!, name: c.name ?? '' }));
      }
      if (m.role === 'tool_result') pending = pending.filter(c => c.id !== body.toolCallId);
      push({ type: 'message', id: m.id, timestamp: ts, message: body });
    } else if (m.role === 'compaction') {
      const b = m.body as CompactionBody;
      const { summary, first_kept_id, tokens_before, ...rest } = b;
      push({ ...rest, type: 'compaction', id: m.id, timestamp: ts, summary, firstKeptEntryId: first_kept_id, tokensBefore: tokens_before });
    } else if (m.role === 'note') {
      const b = m.body as { customType?: string; content?: string };
      push({ type: 'custom_message', id: m.id, timestamp: ts, customType: b.customType ?? 'tibi.note', content: b.content ?? '', display: false });
    }
  }
  close(Date.now());
  return out;
}
