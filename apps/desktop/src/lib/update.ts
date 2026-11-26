import { isTauri } from '../rpc';
import { lang as currentLang, type Lang } from './i18n';
import { olderThan } from './notice-schema';

/**
 * 桌面端软件更新（T31）：下载、验签、落盘缓存与安装都在壳里（src-tauri/src/update.rs）。
 * 默认模式为 auto（后台检查并静默下载，下完后提示重启以更新，不强制重启）；
 * 设为 off 后公告（notice.ts）也不再自动查。配置属于当前设备，不参与同步，存 localStorage。
 */
const MODE_KEY = 'tibi.update.mode';
const LEGACY_AUTO_KEY = 'tibi.update.auto';
const LAST_AT_KEY = 'tibi.update.last_at';
const SKIPPED_KEY = 'tibi.update.skipped';
const SEEN_VERSION_KEY = 'tibi.update.seen_version';
const INSTALLED_NOTES_KEY = 'tibi.update.installed_notes';

export const CHECK_INTERVAL_MS = 6 * 3600_000;
export const POLL_TICK_MS = 3600_000;
export const RETRY_AFTER_ERROR_MS = 15 * 60_000;

export const isAppStore = import.meta.env.VITE_DISTRIBUTION === 'app-store';

/** 更新策略：auto = 自动后台下载并提示重启；notify = 仅检查提醒；off = 关闭自动检查 */
export type UpdateMode = 'auto' | 'notify' | 'off';

export type InstallIssue = 'translocated' | 'mounted_volume';

export type UpdateInfo =
  | { available: false; currentVersion?: string }
  | {
      available: true;
      version: string;
      currentVersion?: string;
      notes?: string | null;
      date?: string | null;
      downloaded?: boolean;
      installIssue?: InstallIssue | null;
      platform?: string;
    };

export interface DownloadProgress {
  got?: number;
  total?: number;
  ratio?: number;
}

export function getUpdateMode(): UpdateMode {
  if (isAppStore) return 'off';
  try {
    const mode = localStorage.getItem(MODE_KEY);
    if (mode === 'auto' || mode === 'notify' || mode === 'off') return mode;
    if (localStorage.getItem(LEGACY_AUTO_KEY) === '0') return 'off';
  } catch { /* 私密模式 / 非浏览器 */ }
  return 'auto';
}

export function setUpdateMode(mode: UpdateMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
    localStorage.setItem(LEGACY_AUTO_KEY, mode === 'off' ? '0' : '1');
  } catch { /* */ }
}

export const autoCheckOn = () => getUpdateMode() !== 'off';
export const setAutoCheck = (on: boolean) => setUpdateMode(on ? 'auto' : 'off');

export function getLastCheckedAt(): number {
  try {
    const n = Number(localStorage.getItem(LAST_AT_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

/** 只在检查真正成功后再记录时间，避免断网/超时白白消耗冷却窗口 */
export function markChecked(now = Date.now()) {
  try { localStorage.setItem(LAST_AT_KEY, String(now)); } catch { /* */ }
}

export function shouldAutoCheck(now = Date.now()): boolean {
  if (!autoCheckOn()) return false;
  const last = getLastCheckedAt();
  return !last || now - last >= CHECK_INTERVAL_MS;
}

export function getSkippedVersion(): string | undefined {
  try { return localStorage.getItem(SKIPPED_KEY) || undefined; } catch { return undefined; }
}

export function setSkippedVersion(version: string | undefined) {
  try {
    if (version) localStorage.setItem(SKIPPED_KEY, version);
    else localStorage.removeItem(SKIPPED_KEY);
  } catch { /* */ }
}

/** 安装重启前记下目标版本与更新说明，便于升级完成后弹「已更新到 vX.Y.Z」 */
export function rememberInstallingUpdate(version: string, notes?: string) {
  try {
    localStorage.setItem(INSTALLED_NOTES_KEY, JSON.stringify({ version, notes: notes || '' }));
  } catch { /* */ }
}

export interface JustUpdatedInfo {
  version: string;
  prevVersion?: string;
  notes?: string;
}

/** 启动后对比版本号：若是刚升级到新版本则返回版本与更新说明，并刷新本地已见版本 */
export function detectJustUpdated(currentVersion: string): JustUpdatedInfo | undefined {
  if (!currentVersion) return undefined;
  let seen = '';
  let pending: { version?: string; notes?: string } | undefined;
  try {
    seen = localStorage.getItem(SEEN_VERSION_KEY) ?? '';
    const raw = localStorage.getItem(INSTALLED_NOTES_KEY);
    if (raw) pending = JSON.parse(raw) as { version?: string; notes?: string };
  } catch { /* */ }

  const matchedPending = pending?.version === currentVersion ? pending : undefined;
  const upgraded = (!!seen && olderThan(seen, currentVersion)) || !!matchedPending;

  try {
    localStorage.setItem(SEEN_VERSION_KEY, currentVersion);
    if (pending) localStorage.removeItem(INSTALLED_NOTES_KEY);
  } catch { /* */ }

  if (!upgraded) return undefined;
  return {
    version: currentVersion,
    prevVersion: seen || undefined,
    notes: matchedPending?.notes || undefined,
  };
}

/** 支持纯 Markdown 文本，也兼容 JSON 双语结构 `{ "zh": "…", "en": "…" }` */
export function formatReleaseNotes(raw?: string | null, lang: Lang = currentLang): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as { zh?: unknown; en?: unknown };
      if (typeof parsed.zh === 'string' || typeof parsed.en === 'string') {
        const picked = lang === 'en' ? (parsed.en || parsed.zh) : (parsed.zh || parsed.en);
        if (typeof picked === 'string' && picked.trim()) return picked.trim();
      }
    } catch { /* 按普通文本渲染 */ }
  }
  return trimmed;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

export async function checkUpdate(): Promise<UpdateInfo> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<UpdateInfo>('update_check');
}

// 这两个下载地址同时写在 capabilities/default.json 的 opener:allow-open-url 里，改这里要一起改
export const DOWNLOAD_PAGE_URL = 'https://tibi.ferecord.com/#download';
const INSTALLER_LATEST = 'https://dl.ferecord.com/latest/';

/** 从腾讯云下载这台电脑能用的安装包；文件名由壳按编译目标给（芯片在 WebView 里看不准） */
export async function installerDownloadUrl(): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  const { invoke } = await import('@tauri-apps/api/core');
  return INSTALLER_LATEST + await invoke<string>('update_installer_asset');
}

/** 安装进行到哪一步；下载时 ratio 是 0–1，总大小未知时是 undefined */
export type InstallStage =
  | { stage: 'downloading'; ratio?: number; got?: number; total?: number }
  | { stage: 'backing_up' }
  | { stage: 'installing' };

/** 更新前备份失败：还没停 Core、没安装，要用户决定（确认后带 skipBackup 再调，不用重新下载） */
export class BackupFailed extends Error {}
const BACKUP_FAILED = 'backup_failed:';

interface ProgressPayload {
  stage: InstallStage['stage'];
  got?: number;
  total?: number | null;
}

function toDownloadProgress(p: ProgressPayload): DownloadProgress {
  const got = typeof p.got === 'number' ? p.got : undefined;
  const total = typeof p.total === 'number' && p.total > 0 ? p.total : undefined;
  const ratio = total && got !== undefined ? Math.min(1, Math.max(0, got / total)) : undefined;
  return { got, total, ratio };
}

/** 阶段 1：后台下载并验签、落盘缓存 */
export async function downloadUpdate(onProgress: (p: DownloadProgress) => void): Promise<{ version: string; downloaded: boolean }> {
  const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
  const off = await listen<ProgressPayload>('update_progress', ({ payload }) => {
    if (payload.stage === 'downloading') onProgress(toDownloadProgress(payload));
  });
  try { return await invoke<{ version: string; downloaded: boolean }>('update_download'); }
  finally { off(); }
}

/** 阶段 2：优先复用已下载缓存 → 备份 → 安装并重启（成功后进程会重启，Promise 不会再返回） */
export async function installUpdate(onStage: (s: InstallStage) => void, opts: { skipBackup?: boolean } = {}): Promise<void> {
  const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
  const off = await listen<ProgressPayload>('update_progress', ({ payload: p }) => {
    if (p.stage === 'downloading') {
      const dp = toDownloadProgress(p);
      onStage({ stage: 'downloading', ratio: dp.ratio, ...(dp.got !== undefined ? { got: dp.got } : {}), ...(dp.total !== undefined ? { total: dp.total } : {}) });
    } else {
      onStage({ stage: p.stage });
    }
  });
  try { await invoke('update_install', { skipBackup: !!opts.skipBackup }); }
  catch (e) { const m = String(e); throw m.startsWith(BACKUP_FAILED) ? new BackupFailed(m.slice(BACKUP_FAILED.length)) : e; }
  finally { off(); }
}

/** 兼容旧调用：按冷却窗口自动检查；推荐使用 store/update.ts 的 startUpdatePolling */
export function startAutoUpdateCheck(onFound: (version: string) => void): () => void {
  if (isAppStore || !isTauri()) return () => undefined;
  const tick = async () => {
    if (!shouldAutoCheck()) return;
    const r = await checkUpdate().catch(() => undefined);
    if (!r) return;
    markChecked();
    if (r.available) onFound(r.version);
  };
  const first = setTimeout(() => void tick(), 15_000);
  const h = setInterval(() => void tick(), POLL_TICK_MS);
  return () => { clearTimeout(first); clearInterval(h); };
}
