import type { CoreEventName } from '../kernel/types.js';

export interface AutoSyncTarget {
  call<T = unknown>(method: string, params: unknown): Promise<T>;
  events: { on(fn: (event: CoreEventName, data: unknown) => void): () => void };
}

export interface AutoSyncOptions {
  initialMs?: number;
  intervalMs?: number;
  debounceMs?: number;
  /** Node 端可传 true，不阻塞进程退出 */
  unref?: boolean;
}

/**
 * 定时 + 本机改动防抖自动同步（桌面端与手机端共用）：
 * 启动后 initialMs 触发一次、每 intervalMs 定时触发、非 sync 来源的 data.changed 防抖 debounceMs 后触发。
 * 返回停止函数以释放所有定时器与事件监听。
 */
export function startAutoSync(target: AutoSyncTarget, opts: AutoSyncOptions = {}): () => void {
  const initialMs = opts.initialMs ?? 10_000;
  const intervalMs = opts.intervalMs ?? 5 * 60_000;
  const debounceMs = opts.debounceMs ?? 30_000;
  const unref = (t: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>) => {
    if (opts.unref) (t as { unref?: () => void }).unref?.();
  };
  let stopped = false;
  const run = () => { if (!stopped) void target.call('sync.auto', {}).catch(() => undefined); };
  const tInit = setTimeout(run, initialMs);
  unref(tInit);
  const tLoop = setInterval(run, intervalMs);
  unref(tLoop);
  let pending: ReturnType<typeof setTimeout> | undefined;
  const off = target.events.on((event, data) => {
    if (stopped || event !== 'data.changed' || (data as { source?: string } | undefined)?.source === 'sync') return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(run, debounceMs);
    unref(pending);
  });
  return () => {
    stopped = true;
    clearTimeout(tInit);
    clearInterval(tLoop);
    if (pending) clearTimeout(pending);
    off();
  };
}
