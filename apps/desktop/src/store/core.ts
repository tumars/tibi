import type { Conversation, DocumentSummary } from '@tibi/core';
import { create } from 'zustand';
import { errorInfo, rpc, type Result } from '../rpc';

/**
 * Core 状态：启动时取一次，事件驱动刷新；连不上时 connected = false，界面显示空状态而不崩。
 * 左栏（最近、连续天数、词汇量）与首页"今天"共用这里的数。
 */
interface CoreState {
  status?: Result<'system.status'>;
  connected: boolean;
  error?: string;
  due: number;
  goal: number;
  vocab: number;
  nickname: string;
  todayMinutes: number;
  streak: number;
  docCount: number;
  wordCount: number;
  recentDocs: DocumentSummary[];
  recentChats: Conversation[];
  refresh(): Promise<void>;
}

export const useCore = create<CoreState>((set) => ({
  connected: false, due: 0, docCount: 0, wordCount: 0, goal: 20, vocab: 0, nickname: '', todayMinutes: 0, streak: 0, recentDocs: [], recentChats: [],
  async refresh() {
    try {
      const status = await rpc.call('system.status', {});
      set({ status, connected: true, error: undefined });
    } catch (e) { set({ connected: false, error: errorInfo(e).message }); return; }
    // 下面各项互不依赖，哪个方法没接上就跳过
    await Promise.all([
      rpc.call('terms.list', { view: 'due', limit: 1 }).then(t => set({ due: t.counts?.due ?? t.total ?? 0, wordCount: t.counts?.all ?? 0 }), () => {}),
      rpc.call('documents.list', { limit: 1 }).then(r => set({ docCount: r.total }), () => {}),
      rpc.call('profile.get', {}).then(p => set({ goal: p.daily_goal_minutes || 20, vocab: p.vocab_estimate || 0, nickname: (p.assistant_prefs?.nickname || p.display_name || '').trim() === '你' ? '' : (p.assistant_prefs?.nickname || p.display_name || '').trim() }), () => {}),
      rpc.call('stats.summary', { range: 30 }).then(s => set({ streak: s.streak ?? 0 }), () => {}),
      rpc.call('stats.series', { metrics: ['minutes'], days: 1 }).then(s => set({ todayMinutes: Math.round(s.series.minutes?.at(-1) ?? 0) }), () => {}),
      rpc.call('documents.list', { sort: 'opened', status: 'reading', limit: 5 }).then(r => set({ recentDocs: r.items }), () => {}),
      rpc.call('chat.list', { limit: 3 }).then(c => set({ recentChats: c }), () => {}),
    ]);
  },
}));

let bound = false;
export function bindCoreEvents() {
  if (bound) return; bound = true;
  const refresh = () => void useCore.getState().refresh();
  rpc.on('data.changed', d => { if (d.table === 'cards' || d.table === 'terms' || d.table === 'settings' || d.table === 'documents') refresh(); });
  rpc.on('task.done', refresh);
  // 任务开始 / 状态变化时只刷新左栏徽标用的 system.status（不整页刷新）
  let t: ReturnType<typeof setTimeout> | undefined;
  rpc.on('task.update', () => { if (t) return; t = setTimeout(() => { t = undefined; void rpc.call('system.status', {}).then(st => useCore.setState({ status: st }), () => undefined); }, 800); });
  rpc.on('approval.requested', refresh);
  rpc.on('approval.resolved', refresh);
}
