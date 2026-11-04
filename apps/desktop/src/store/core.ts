import type { Conversation, DocumentSummary } from '@tibi/core';
import { create } from 'zustand';
import { errorInfo, rpc, type Result } from '../rpc';

/**
 * Core 状态：启动时取一次，事件驱动刷新；连不上时 connected = false，界面显示空状态而不崩。
 * 左栏（最近、连续天数）与首页"今天"共用这里的数。
 */
interface CoreState {
  status?: Result<'system.status'>;
  connected: boolean;
  error?: string;
  due: number;
  goal: number;
  nickname: string;
  todayMinutes: number;
  streak: number;
  docCount: number;
  wordCount: number;
  /** 订阅未读数（侧栏角标） */
  feedUnread: number;
  recentDocs: DocumentSummary[];
  recentChats: Conversation[];
  refresh(): Promise<void>;
  refreshChats(): Promise<void>;
  refreshFeeds(): Promise<void>;
}

export const useCore = create<CoreState>((set, get) => ({
  connected: false, due: 0, docCount: 0, wordCount: 0, feedUnread: 0, goal: 20, nickname: '', todayMinutes: 0, streak: 0, recentDocs: [], recentChats: [],
  async refresh() {
    try {
      const status = await rpc.call('system.status', {});
      set({ status, connected: true, error: undefined });
    } catch (e) { set({ connected: false, error: errorInfo(e).message }); return; }
    // 下面各项互不依赖，哪个方法没接上就跳过
    await Promise.all([
      rpc.call('terms.list', { view: 'due', limit: 1 }).then(t => set({ due: t.counts?.due ?? t.total ?? 0, wordCount: t.counts?.all ?? 0 }), () => {}),
      rpc.call('documents.list', { limit: 1 }).then(r => set({ docCount: r.total }), () => {}),
      get().refreshFeeds(),
      rpc.call('profile.get', {}).then(p => set({ goal: p.daily_goal_minutes || 20, nickname: (p.assistant_prefs?.nickname || p.display_name || '').trim() === '你' ? '' : (p.assistant_prefs?.nickname || p.display_name || '').trim() }), () => {}),
      rpc.call('stats.summary', { range: 30 }).then(s => set({ streak: s.streak ?? 0 }), () => {}),
      rpc.call('stats.series', { metrics: ['minutes'], days: 1 }).then(s => set({ todayMinutes: Math.round(s.series.minutes?.at(-1) ?? 0) }), () => {}),
      rpc.call('documents.list', { sort: 'opened', status: 'reading', limit: 5 }).then(r => set({ recentDocs: r.items }), () => {}),
      get().refreshChats(),
    ]);
  },
  async refreshChats() {
    await rpc.call('chat.list', { limit: 50 }).then(c => set({ recentChats: c }), () => {});
  },
  async refreshFeeds() {
    await rpc.call('feeds.status', {}).then(s => set({ feedUnread: s.unread }), () => {});
  },
}));

let bound = false;
export function bindCoreEvents() {
  if (bound) return; bound = true;
  const refresh = () => void useCore.getState().refresh();
  rpc.on('data.changed', d => { if (d.table === 'cards' || d.table === 'terms' || d.table === 'settings' || d.table === 'documents') refresh(); });
  rpc.on('data.changed', d => { if (d.table === 'feed_items' || d.table === 'feeds') void useCore.getState().refreshFeeds(); });
  rpc.on('import.done', refresh);
  rpc.on('approval.requested', refresh);
  rpc.on('approval.resolved', refresh);
}
