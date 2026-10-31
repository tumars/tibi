import type { Approval, Id, SkillId, TaskId, TaskStep, TaskSummary } from '../types.js';

/**
 * 内核对外的契约（05 §6，R9 自建）。实现见 ./kernel.ts；流水线（导入等）只依赖这里的类型。
 */

/** 任务运行时交给步骤函数的上下文：每一步写完即检查点，重开从最后完成的步骤接着跑 */
export interface JobContext {
  readonly job_id: TaskId;
  readonly signal: AbortSignal;
  /**
   * 执行一个有名字的步骤。同名步骤若已在 job_steps 里 done，直接返回保存的 output（续跑）。
   * output 必须可 JSON 序列化。
   */
  step<T>(name: string, fn: (ctx: JobContext) => Promise<T>, opts?: { kind?: 'pipeline' | 'tool' | 'model'; input?: unknown; label?: string }): Promise<T>;
  /** 并行子步骤：全部结束（成功或失败）再汇总；失败的步骤记 failed，不影响其他 */
  parallel<T extends Record<string, () => Promise<unknown>>>(steps: T): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> | undefined }>;
  /** 更新任务标题 / 当前步骤文案（走 task.update 事件） */
  progress(label: string, extra?: { total?: number; index?: number }): void;
  /** 等待用户审批；挂起时任务状态 = waiting_approval（tasks.approve 解除） */
  approve(req: Omit<Approval, 'task_id' | 'requested_at'>): Promise<{ decision: 'allow' | 'deny' | 'edit'; edited?: Record<string, unknown> }>;
  /** 本任务是否读过不可信内容（抓取的网页、导入正文、搜索结果）；读过之后写入与外联必须审批 */
  tainted: boolean;
  markTainted(): void;
  /** 记一条已经发生的步骤（模型调用这类不经 step() 包裹的事），返回 job_steps.id */
  record?(kind: 'pipeline' | 'tool' | 'model', name: string, input: unknown, output: unknown, status?: 'done' | 'failed'): Promise<string>;
}

export interface JobSpec {
  kind: 'import' | 'skill';
  title: string;
  skill_id?: SkillId;
  parent_job_id?: TaskId;
  conversation_id?: Id;
  trigger?: 'user' | 'auto' | 'mcp' | 'share';
  input: unknown;
}

export type JobFn = (ctx: JobContext, input: never) => Promise<unknown>;

export interface JobRunner {
  /** 注册一种任务的执行函数（按 kind + name 找到流水线） */
  register(name: string, fn: (ctx: JobContext, input: any) => Promise<unknown>): void;
  /** 新建并开始运行，立即返回 task_id */
  submit(pipeline: string, spec: JobSpec): Promise<{ task_id: TaskId }>;
  /** 启动时把 running / queued 的任务接着跑 */
  resumeAll(): Promise<number>;
  /** 等某个任务结束（测试与 wait=true 的 run_skill 用） */
  wait(task_id: TaskId, timeout_ms?: number): Promise<{ status: string; output?: unknown; error?: string }>;
  cancel(task_id: TaskId): Promise<void>;
  approve(task_id: TaskId, decision: 'allow' | 'deny' | 'edit', edited?: Record<string, unknown>, always?: boolean): Promise<void>;
  summary(task_id: TaskId): Promise<TaskSummary | undefined>;
  steps(task_id: TaskId): Promise<TaskStep[]>;
}

/** Core → 界面事件（06 §4） */
export type CoreEventName = 'chat.delta' | 'chat.tool' | 'task.update' | 'task.done' | 'approval.requested' | 'approval.resolved' | 'data.changed' | 'usage.updated' | 'sync.update' | 'model.status';
export interface EventSink { emit(event: CoreEventName, data: unknown): void }

export class EventBus implements EventSink {
  private listeners = new Set<(event: CoreEventName, data: unknown) => void>();
  emit(event: CoreEventName, data: unknown) { for (const l of this.listeners) l(event, data); }
  on(fn: (event: CoreEventName, data: unknown) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
