import { isTauri, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';

/**
 * 和 iOS 扩展交换数据（00 §3.13 J3、J7；壳的 app_group.rs，扩展在 src-tauri/ios-extensions/）：
 * - 分享扩展放进收件箱的网址：打开 / 回到前台时取走导入
 * - 小组件快照：状态刷新后写一份（待复习数、连续天数、今日分钟、继续读的文章）
 * 不是 iOS 时壳返回空、写快照什么都不做。
 */
export async function takeSharedImports() {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  const items = await invoke<{ url: string; title?: string; later?: boolean }[]>('share_take_pending').catch(() => []);
  for (const it of items) {
    try { await rpc.call('documents.import', { source: { type: 'url', url: it.url }, origin: 'deeplink' }); }
    catch { /* 单篇失败不影响别的 */ }
  }
  if (items.length) toast(tl('正在导入从 Safari 分享的 {n} 篇', { n: items.length }));
}

let timer: ReturnType<typeof setTimeout> | undefined;
export function startWidgetSnapshots() {
  if (!isTauri()) return () => undefined;
  const write = async () => {
    const st = useCore.getState(); const lead = st.recentDocs.find(d => d.progress > 0 && d.progress < 1);
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('widget_write', { snapshot: { due: st.due, streak: st.streak, todayMinutes: st.todayMinutes, goal: st.goal, readingTitle: lead?.title ?? null, readingProgress: lead?.progress ?? null } }).catch(() => undefined);
  };
  return useCore.subscribe(() => { if (timer) clearTimeout(timer); timer = setTimeout(() => void write(), 1000); });
}
