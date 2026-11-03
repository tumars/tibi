/**
 * 内核对外的事件契约（06 §4）。进行中的回答见 ./turns.ts。
 */

/** Core → 界面事件（06 §4） */
export type CoreEventName = 'chat.delta' | 'chat.thinking' | 'chat.block' | 'chat.tool' | 'chat.turn' | 'chat.end' | 'import.progress' | 'import.done' | 'approval.requested' | 'approval.resolved' | 'data.changed' | 'sync.update' | 'model.status';
export interface EventSink { emit(event: CoreEventName, data: unknown): void }

export class EventBus implements EventSink {
  private listeners = new Set<(event: CoreEventName, data: unknown) => void>();
  emit(event: CoreEventName, data: unknown) { for (const l of this.listeners) l(event, data); }
  on(fn: (event: CoreEventName, data: unknown) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
