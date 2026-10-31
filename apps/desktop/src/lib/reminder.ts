import { tl } from './i18n';
import { isTauri } from '../rpc';

/**
 * 每日提醒（00 §3.13 J8）：每天一条，时间可选（关闭 / 早上 / 中午 / 晚上），内容是当天待复习数。
 * - 手机：交给系统定时（通知插件的 Schedule），每次打开 / 回到前台按当前待复习数重排下一条
 * - 电脑：应用开着（含托盘里）时每分钟看一次，到点且今天还没提醒过就发一条
 * 设置键 reminder.time 是这台设备自己的，不同步。
 */
export type ReminderTime = 'off' | 'morning' | 'noon' | 'evening';
export const REMINDER_HOURS: Record<Exclude<ReminderTime, 'off'>, number> = { morning: 8, noon: 12, evening: 20 };
const ID = 4201;
const LAST = 'tibi.reminder.last';

export const reminderBody = (due: number) => (due > 0 ? tl('今天有 {n} 个词等你复习，几分钟就好。', { n: due }) : tl('今天没有要复习的词，读一小段吧。'));

/** 下一次提醒的时间（今天的点已过就是明天） */
export function nextAt(time: Exclude<ReminderTime, 'off'>, now = new Date()): Date {
  const d = new Date(now); d.setHours(REMINDER_HOURS[time], 0, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

async function permitted(): Promise<boolean> {
  if (!isTauri()) return false;
  const n = await import('@tauri-apps/plugin-notification');
  if (await n.isPermissionGranted()) return true;
  return (await n.requestPermission()) === 'granted';
}

/** 手机：取消旧的、按当前待复习数排下一条 */
export async function scheduleMobile(time: ReminderTime, due: number) {
  if (!isTauri()) return;
  const n = await import('@tauri-apps/plugin-notification');
  try { await n.cancel([ID]); } catch { /* 没有旧的 */ }
  if (time === 'off' || !(await permitted())) return;
  n.sendNotification({ id: ID, title: 'Tibi', body: reminderBody(due), schedule: n.Schedule.at(nextAt(time), false, true) });
}

/** 电脑：开着时每分钟检查一次；返回停止函数 */
export function startDesktopReminder(get: () => { time: ReminderTime; due: number }): () => void {
  const tick = async () => {
    const { time, due } = get(); if (time === 'off') return;
    const now = new Date(); const today = now.toDateString();
    let last = ''; try { last = localStorage.getItem(LAST) ?? ''; } catch { /* */ }
    if (now.getHours() !== REMINDER_HOURS[time] || last === today) return;
    try { localStorage.setItem(LAST, today); } catch { /* */ }
    if (!(await permitted())) return;
    const n = await import('@tauri-apps/plugin-notification');
    n.sendNotification({ title: 'Tibi', body: reminderBody(due) });
  };
  const h = setInterval(() => void tick(), 60_000); void tick();
  return () => clearInterval(h);
}
