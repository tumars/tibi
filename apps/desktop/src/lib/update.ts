import { isTauri } from '../rpc';

/**
 * 桌面端软件更新（T31）：下载、验签、安装都在壳里（src-tauri/src/update.rs）。
 * 自动检查默认开（2026-11-04 起），关掉后公告（notice.ts）也不再查；开关是这台设备自己的，不同步，所以放 localStorage。
 */
const AUTO = 'tibi.update.auto';
const LAST = 'tibi.update.last';
const HOUR = 3600_000;

export type UpdateInfo = { available: false } | { available: true; version: string };

export const autoCheckOn = () => { try { return localStorage.getItem(AUTO) !== '0'; } catch { return true; } };
export const setAutoCheck = (on: boolean) => { try { localStorage.setItem(AUTO, on ? '1' : '0'); } catch { /* */ } };

export async function checkUpdate(): Promise<UpdateInfo> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<UpdateInfo>('update_check');
}

// 这两个下载地址同时写在 capabilities/default.json 的 opener:allow-open-url 里，改这里要一起改
export const RELEASES_URL = 'https://github.com/tumars/tibi/releases/latest';
const MIRROR_LATEST = 'https://dl.ferecord.com/latest/';

/** 国内下载这台电脑能用的安装包；文件名由壳按编译目标给（芯片在 WebView 里看不准） */
export async function mirrorDownloadUrl(): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  const { invoke } = await import('@tauri-apps/api/core');
  return MIRROR_LATEST + await invoke<string>('update_mirror_asset');
}

/** 安装进行到哪一步；下载时 ratio 是 0–1，总大小未知时是 undefined */
export type InstallStage = { stage: 'downloading'; ratio?: number } | { stage: 'backing_up' } | { stage: 'installing' };

/** 更新前备份失败：还没停 Core、没安装，要用户决定（确认后带 skipBackup 再调，不用重新下载） */
export class BackupFailed extends Error {}
const BACKUP_FAILED = 'backup_failed:';

/** 下载、备份并安装，成功后应用会重启（这个 Promise 不会再返回） */
export async function installUpdate(onStage: (s: InstallStage) => void, opts: { skipBackup?: boolean } = {}): Promise<void> {
  const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
  const off = await listen<{ stage: InstallStage['stage']; got?: number; total?: number | null }>('update_progress', ({ payload: p }) => onStage(p.stage === 'downloading' ? { stage: p.stage, ratio: p.total && p.got !== undefined ? p.got / p.total : undefined } : { stage: p.stage }));
  try { await invoke('update_install', { skipBackup: !!opts.skipBackup }); }
  catch (e) { const m = String(e); throw m.startsWith(BACKUP_FAILED) ? new BackupFailed(m.slice(BACKUP_FAILED.length)) : e; }
  finally { off(); }
}

/** 开着自动检查时每天看一次（托盘里常驻也算）；检查失败不打扰，第二天再试。返回停止函数 */
export function startAutoUpdateCheck(onFound: (version: string) => void): () => void {
  if (!isTauri()) return () => undefined;
  const tick = async () => {
    if (!autoCheckOn()) return;
    const today = new Date().toDateString();
    let last = ''; try { last = localStorage.getItem(LAST) ?? ''; } catch { /* */ }
    if (last === today) return;
    try { localStorage.setItem(LAST, today); } catch { /* */ }
    const r = await checkUpdate().catch(() => undefined);
    if (r?.available) onFound(r.version);
  };
  const first = setTimeout(() => void tick(), 15_000);
  const h = setInterval(() => void tick(), HOUR);
  return () => { clearTimeout(first); clearInterval(h); };
}
