import { create } from 'zustand';
import { lang, tl } from '../lib/i18n';
import {
  BackupFailed,
  checkUpdate,
  downloadUpdate,
  formatReleaseNotes,
  getSkippedVersion,
  getUpdateMode,
  installerDownloadUrl,
  installUpdate,
  isAppStore,
  markChecked,
  POLL_TICK_MS,
  rememberInstallingUpdate,
  RETRY_AFTER_ERROR_MS,
  setSkippedVersion,
  setUpdateMode,
  shouldAutoCheck,
  type DownloadProgress,
  type InstallIssue,
  type UpdateMode,
} from '../lib/update';
import { isTauri } from '../rpc';

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'backing_up'
  | 'installing'
  | 'backup_failed'
  | 'error';

export interface UpdateState {
  phase: UpdatePhase;
  mode: UpdateMode;
  version?: string;
  currentVersion?: string;
  notes?: string;
  date?: string;
  installIssue?: InstallIssue;
  platform?: string;
  progress: DownloadProgress;
  error?: string;
  installerUrl?: string;
  skippedVersion?: string;
  /** 本次会话中用户点了「稍后提醒」而收起侧栏胶囊的版本 */
  pillDismissedFor?: string;
  modalOpen: boolean;
  /** 刚完成更新重启后的「更新内容」弹窗 */
  whatsNew?: { version: string; notes?: string };
  setMode(mode: UpdateMode): void;
  openModal(): void;
  closeModal(): void;
  openWhatsNew(version: string, notes?: string): void;
  closeWhatsNew(): void;
  dismissPill(): void;
  skipVersion(version: string): void;
  check(opts?: { manual?: boolean; openModal?: boolean }): Promise<void>;
  download(opts?: { silent?: boolean }): Promise<void>;
  apply(opts?: { skipBackup?: boolean }): Promise<void>;
  cancelBackupFailed(): void;
  resetForTest(): void;
}

const BUSY_PHASES: ReadonlySet<UpdatePhase> = new Set(['checking', 'downloading', 'backing_up', 'installing']);

let lastTrayKey = '';

async function syncNativeUpdateUi(state: Pick<UpdateState, 'phase' | 'version' | 'progress'>) {
  if (!isTauri() || isAppStore) return;
  const stage =
    state.phase === 'ready' || state.phase === 'available' || state.phase === 'downloading'
      ? state.phase
      : null;
  const version = stage ? (state.version ?? null) : null;
  // 下载进度按 5% 步长同步到托盘，避免高频跨窗口广播
  const bucket = stage === 'downloading' && state.progress.ratio !== undefined
    ? Math.round(state.progress.ratio * 20) / 20
    : stage === 'ready' ? 1 : null;
  const key = `${stage ?? ''}|${version ?? ''}|${bucket ?? ''}|${lang}`;
  if (key === lastTrayKey) return;
  lastTrayKey = key;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('tray_sync_update', { version, stage, ratio: bucket, lang });
  } catch { /* 非桌面或托盘未就绪 */ }

  try {
    const { syncMacUpdateMenu } = await import('../lib/macNative');
    await syncMacUpdateMenu({ phase: state.phase, version: state.version });
  } catch { /* 非 macOS 或菜单未挂载 */ }
}

const initialState = () => ({
  phase: 'idle' as UpdatePhase,
  mode: getUpdateMode(),
  version: undefined as string | undefined,
  currentVersion: undefined as string | undefined,
  notes: undefined as string | undefined,
  date: undefined as string | undefined,
  installIssue: undefined as InstallIssue | undefined,
  platform: undefined as string | undefined,
  progress: {} as DownloadProgress,
  error: undefined as string | undefined,
  installerUrl: undefined as string | undefined,
  skippedVersion: getSkippedVersion(),
  pillDismissedFor: undefined as string | undefined,
  modalOpen: false,
  whatsNew: undefined as { version: string; notes?: string } | undefined,
});

export const useUpdate = create<UpdateState>((set, get) => ({
  ...initialState(),

  setMode(mode) {
    setUpdateMode(mode);
    set({ mode });
    // 从仅提醒切换到自动下载时，如果已经发现新版本且无安装位置问题，顺手开始后台下载
    const st = get();
    if (mode === 'auto' && st.phase === 'available' && !st.installIssue && st.version) {
      void get().download({ silent: true });
    }
  },

  openModal() {
    set({ modalOpen: true });
  },

  closeModal() {
    set({ modalOpen: false });
  },

  openWhatsNew(version, notes) {
    set({ whatsNew: { version, notes } });
  },

  closeWhatsNew() {
    set({ whatsNew: undefined });
  },

  dismissPill() {
    const v = get().version;
    set({ pillDismissedFor: v, modalOpen: false });
  },

  skipVersion(version) {
    setSkippedVersion(version);
    set({
      skippedVersion: version,
      pillDismissedFor: version,
      modalOpen: false,
      phase: 'idle',
      version: undefined,
      notes: undefined,
      date: undefined,
      progress: {},
      error: undefined,
    });
    void syncNativeUpdateUi(get());
  },

  async check(opts = {}) {
    const manual = !!opts.manual;
    if (isAppStore) return;
    if (opts.openModal) set({ modalOpen: true });

    if (!isTauri()) {
      if (manual) set({ phase: 'error', error: tl('浏览器模式不能更新') });
      return;
    }

    const cur = get();
    // 正在下载/备份/安装时绝不打断；手动触发只打开弹窗看当前进度
    if (BUSY_PHASES.has(cur.phase)) {
      if (manual) set({ modalOpen: true });
      return;
    }
    // 后台已经下好就绪时，自动轮询不再重复请求；手动检查直接展示就绪状态
    if (cur.phase === 'ready') {
      if (manual) set({ modalOpen: true, pillDismissedFor: undefined });
      return;
    }

    const prevPhase = cur.phase;
    if (manual) {
      set({ phase: 'checking', error: undefined, pillDismissedFor: undefined });
    }

    try {
      const r = await checkUpdate();
      markChecked();
      if (!r.available) {
        set({
          phase: manual ? 'latest' : 'idle',
          currentVersion: r.currentVersion,
          version: undefined,
          notes: undefined,
          date: undefined,
          installIssue: undefined,
          progress: {},
          error: undefined,
        });
        void syncNativeUpdateUi(get());
        return;
      }

      const skipped = getSkippedVersion();
      // 自动检查尊重「跳过此版本」；手动检查忽略跳过并恢复展示
      if (!manual && skipped && skipped === r.version) {
        set({ phase: 'idle', currentVersion: r.currentVersion, skippedVersion: skipped });
        return;
      }
      if (manual && skipped === r.version) {
        setSkippedVersion(undefined);
      }

      const notes = formatReleaseNotes(r.notes);
      const nextPhase: UpdatePhase = r.downloaded ? 'ready' : 'available';
      set({
        phase: nextPhase,
        version: r.version,
        currentVersion: r.currentVersion,
        notes,
        date: r.date ?? undefined,
        installIssue: r.installIssue ?? undefined,
        platform: r.platform,
        progress: r.downloaded ? { ratio: 1 } : {},
        error: undefined,
        installerUrl: undefined,
        skippedVersion: manual && skipped === r.version ? undefined : skipped,
        ...(manual ? { pillDismissedFor: undefined } : {}),
      });
      void syncNativeUpdateUi(get());

      // 若是 macOS 只读卷/AppTranslocation，顺手预取手动安装包地址方便引导
      if (r.installIssue) {
        void installerDownloadUrl().then(url => { if (url) set({ installerUrl: url }); }).catch(() => undefined);
      }

      // 默认 auto 模式下，没有安装位置问题且尚未缓存时，直接静默后台下载
      if (!r.downloaded && !r.installIssue && get().mode === 'auto') {
        void get().download({ silent: !manual });
      }
    } catch (e) {
      if (manual) {
        const installer = await installerDownloadUrl().catch(() => undefined);
        set({
          phase: 'error',
          error: tl('检查更新失败：{v0}', { v0: String(e) }),
          installerUrl: installer,
        });
      } else {
        set({ phase: prevPhase === 'checking' ? 'idle' : prevPhase });
      }
      void syncNativeUpdateUi(get());
    }
  },

  async download(opts = {}) {
    const silent = !!opts.silent;
    const cur = get();
    if (!isTauri() || isAppStore) return;
    if (cur.phase === 'downloading' || cur.phase === 'ready' || cur.phase === 'backing_up' || cur.phase === 'installing') return;
    if (!cur.version) return;

    set({ phase: 'downloading', progress: { ratio: undefined }, error: undefined });
    void syncNativeUpdateUi(get());

    try {
      await downloadUpdate(progress => {
        set({ progress });
        void syncNativeUpdateUi(get());
      });
      set({ phase: 'ready', progress: { ratio: 1 }, error: undefined });
      void syncNativeUpdateUi(get());
    } catch (e) {
      if (silent) {
        // 静默后台下载失败不弹红错，优雅退回「发现新版本」，用户可手动点击下载或等下次轮询
        set({ phase: 'available', progress: {}, error: undefined });
      } else {
        const installer = await installerDownloadUrl().catch(() => undefined);
        set({
          phase: 'error',
          progress: {},
          error: tl('下载更新失败：{v0}', { v0: String(e) }),
          installerUrl: installer,
        });
      }
      void syncNativeUpdateUi(get());
    }
  },

  async apply(opts = {}) {
    const cur = get();
    if (!isTauri() || isAppStore) return;
    if (cur.phase === 'backing_up' || cur.phase === 'installing') return;
    const version = cur.version;
    if (!version) return;

    const initialPhase: UpdatePhase = cur.phase === 'ready' || cur.phase === 'backup_failed' ? 'backing_up' : 'downloading';
    set({ phase: initialPhase, error: undefined });
    if (version) rememberInstallingUpdate(version, cur.notes);

    try {
      await installUpdate(st => {
        if (st.stage === 'downloading') {
          set({ phase: 'downloading', progress: { ratio: st.ratio, got: st.got, total: st.total } });
        } else if (st.stage === 'backing_up') {
          set({ phase: 'backing_up' });
        } else {
          set({ phase: 'installing' });
        }
        void syncNativeUpdateUi(get());
      }, { skipBackup: !!opts.skipBackup });
    } catch (e) {
      if (e instanceof BackupFailed) {
        set({ phase: 'backup_failed', error: e.message, modalOpen: true });
      } else {
        const installer = await installerDownloadUrl().catch(() => undefined);
        set({
          phase: 'error',
          error: tl('更新失败：{v0}', { v0: String(e) }),
          installerUrl: installer,
          modalOpen: true,
        });
      }
      void syncNativeUpdateUi(get());
    }
  },

  cancelBackupFailed() {
    set({ phase: 'ready', error: undefined });
    void syncNativeUpdateUi(get());
  },

  resetForTest() {
    lastTrayKey = '';
    set(initialState());
  },
}));

/** 启动后台轮询：15s 首查 + 6 小时冷却 + 失败 15 分钟重试 + 切回前台/重新联网时补查 */
export function startUpdatePolling(): () => void {
  if (isAppStore || !isTauri()) return () => undefined;

  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const tick = async () => {
    if (stopped || !shouldAutoCheck()) return;
    const before = Date.now();
    await useUpdate.getState().check({ manual: false });
    // 检查失败时 lastCheckedAt 没更新，安排一次温和退避重试
    if (!stopped && shouldAutoCheck(before) && !retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void tick();
      }, RETRY_AFTER_ERROR_MS);
    }
  };

  const first = setTimeout(() => void tick(), 15_000);
  const hourly = setInterval(() => void tick(), POLL_TICK_MS);
  const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') void tick();
  };
  const onOnline = () => { void tick(); };

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(hourly);
    if (retryTimer) clearTimeout(retryTimer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
  };
}
