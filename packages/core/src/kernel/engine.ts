import type { TSchema } from '@sinclair/typebox';
import type { Api, Model, Provider, Usage } from '@earendil-works/pi-ai';

/**
 * Agent 引擎的契约（10 §3）：Core 只认这个接口，不依赖具体 SDK。
 * 桌面端由 core-node 的 PiEngine（pi-coding-agent）实现；以后的手机端、其他引擎各写一个实现。
 *
 * 分工：会话与上下文维护、压缩和摘要、重试、工具按需加载、插话都归引擎；
 * 审批、撤销、预算、任务、对话记录都归 Core——工具在 Core 里执行，记录由 Core 写库。
 */

/** 存在 messages 表里的一条对话记录（10 §5）：body 是 Tibi 消息格式 v1，和 pi-ai 的 Message 同构 */
export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool_result' | 'compaction' | 'note';
  body: unknown;
  created_at: number;
}

/** compaction 消息的 body：引擎压缩条目原样存，first_kept_id 换成了 Tibi 的消息 ID */
export interface CompactionBody { summary: string; first_kept_id: string; tokens_before: number; [k: string]: unknown }

export interface EngineToolResult { text: string; details?: unknown; isError?: boolean }

export interface EngineTool {
  name: string;
  description: string;
  parameters: TSchema;
  /** 只读工具 */
  readOnly: boolean;
  /** 按需加载：平时不带给模型，搜到后才启用 */
  deferred?: boolean;
  execute(toolCallId: string, params: unknown, signal?: AbortSignal): Promise<EngineToolResult>;
}

/** 模型：Core 从 providers 表解析，交给引擎注册 */
export interface ModelSpec {
  model: Model<Api>;
  /** pi-ai 的 Provider（DeepSeek 内置的或按服务商配置建的）；测试和开发用假的 */
  provider: Provider;
  apiKey?: string;
  thinking?: 'off' | 'low' | 'medium' | 'high';
}

export type EngineEvent =
  | { type: 'text_delta'; delta: string }
  /** 模型的思考过程（开了思考的模型才有），和回答正文分开 */
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_start'; toolCallId: string; name: string; args: unknown }
  | { type: 'tool_end'; toolCallId: string; name: string; isError: boolean }
  | { type: 'retry'; attempt: number; maxAttempts: number; error?: string }
  | { type: 'retry_end'; ok: boolean; error?: string }
  | { type: 'compaction'; phase: 'start' | 'end'; ok?: boolean };

/** 引擎交回一条定稿的消息，Core 写库后返回它的 ID */
export type EngineMessage =
  | { role: 'assistant'; body: unknown; usage?: Usage; model: string }
  | { role: 'tool_result'; body: unknown; toolCallId: string }
  | { role: 'compaction'; body: CompactionBody; usage?: Usage };

export interface EngineRunHooks {
  /** 每轮请求模型前调用：查预算、数回合；抛错就中止这次运行 */
  beforeTurn(turn: number): Promise<void>;
  onMessage(m: EngineMessage): Promise<string>;
  onEvent(e: EngineEvent): void;
}

export interface EngineRun {
  /** 有对话时引擎可以常驻会话；没有（子技能、后台技能）时用完即丢 */
  conversation_id?: string;
  config: {
    systemPrompt: string;
    tools: EngineTool[];
    model: ModelSpec;
    /** 系统提示、工具、模型任何一个变了就变：常驻会话据此重建 */
    version: string;
    compaction?: { reserveTokens?: number; keepRecentTokens?: number };
  };
  /** 用户这一句：文本块（原话 + 附件） */
  input: string | { type: 'text'; text: string }[];
  /** 这一句之前库里最后一条消息的 ID：和常驻会话对不上就重建 */
  lastMessageId?: string;
  /** 这一句在库里的 ID */
  inputMessageId?: string;
  /** 重建会话用：这一句之前的记录（按时间） */
  history(): Promise<StoredMessage[]>;
  signal: AbortSignal;
  hooks: EngineRunHooks;
}

export interface EngineOutcome {
  status: 'done' | 'aborted' | 'error';
  error?: string;
}

export interface AgentEngine {
  readonly id: string;
  run(req: EngineRun): Promise<EngineOutcome>;
  /** 运行中插话：会话正在跑就排进去，返回 true */
  steer(conversation_id: string, text: string, messageId: string): boolean;
  /** 对话之外的事（撤销等）：会话在内存里就交给它，下一轮模型能看到 */
  note(conversation_id: string, text: string, messageId: string): void;
  /** 记录被改过（回退、删除）：丢掉常驻会话 */
  invalidate(conversation_id: string): void;
  dispose(): void;
}
