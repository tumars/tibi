import { isTauri } from '../rpc';

/**
 * 桌面端软件更新（T31）：下载、验签、安装都在壳里（src-tauri/src/update.rs）。
 * 自动检查默认关（PRIVACY：只有用到的功能才联网）；开关是这台设备自己的，不同步，所以放 localStorage。
 */
const AUTO = 'tibi.update.auto';
const LAST = 'tibi.update.last';
const HOUR = 3600_000;

export type UpdateInfo = { available: false } | { available: true; version: string };

export const autoCheckOn = () => { try { return localStorage.getItem(AUTO) === '1'; } catch { return false; } };
export const setAutoCheck = (on: boolean) => { try { localStorage.setItem(AUTO, on ? '1' : '0'); } catch { /* */ } };

export async function checkUpdate(): Promise<UpdateInfo> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<UpdateInfo>('update_check');
}

/** 下载并安装，成功后应用会重启（这个 Promise 不会再返回）；onProgress 收到 0–1，总大小未知时是 undefined */
export async function installUpdate(onProgress: (ratio?: number) => void): Promise<void> {
  const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
  const off = await listen<{ got: number; total?: number | null }>('update_progress', e => onProgress(e.payload.total ? e.payload.got / e.payload.total : undefined));
  try { await invoke('update_install'); } finally { off(); }
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
