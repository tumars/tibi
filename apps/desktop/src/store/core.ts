import { create } from 'zustand';
import { errorInfo, rpc, type Result } from '../rpc';

/** Core 状态：启动时取一次，事件驱动刷新；连不上时 offline = true，界面显示空状态而不崩 */
interface CoreState {
  status?: Result<'system.status'>;
  connected: boolean;
  error?: string;
  due: number;
  refresh(): Promise<void>;
}

export const useCore = create<CoreState>((set) => ({
  connected: false, due: 0,
  async refresh() {
    try {
      const status = await rpc.call('system.status', {});
      set({ status, connected: true, error: undefined });
      try { const t = await rpc.call('terms.list', { view: 'due', limit: 1 }); set({ due: t.counts?.due ?? t.total ?? 0 }); } catch { /* 方法还没接上 */ }
    } catch (e) { set({ connected: false, error: errorInfo(e).message }); }
  },
}));

let bound = false;
export function bindCoreEvents() {
  if (bound) return; bound = true;
  const refresh = () => void useCore.getState().refresh();
  rpc.on('data.changed', d => { if (d.table === 'cards' || d.table === 'terms' || d.table === 'settings') refresh(); });
  rpc.on('task.done', refresh);
  rpc.on('approval.requested', refresh);
  rpc.on('approval.resolved', refresh);
}
