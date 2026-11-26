import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autoCheckOn,
  BackupFailed,
  CHECK_INTERVAL_MS,
  detectJustUpdated,
  downloadUpdate,
  formatReleaseNotes,
  getUpdateMode,
  installUpdate,
  markChecked,
  rememberInstallingUpdate,
  setUpdateMode,
  shouldAutoCheck,
  type InstallStage,
} from '../src/lib/update';

const invoke = vi.fn();
let emit: (payload: unknown) => void = () => undefined;
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_: string, f: (e: { payload: unknown }) => void) => {
    emit = payload => f({ payload });
    return () => undefined;
  },
}));

function stubStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  });
  return map;
}

describe('下载与安装更新', () => {
  beforeEach(() => invoke.mockReset());

  it('downloadUpdate 流式转发下载进度并调用 update_download', async () => {
    const progress: { got?: number; total?: number; ratio?: number }[] = [];
    invoke.mockImplementation(async cmd => {
      if (cmd === 'update_download') {
        emit({ stage: 'downloading', got: 50, total: 100 });
        emit({ stage: 'downloading', got: 100, total: 100 });
        return { version: '0.2.3', downloaded: true };
      }
      return undefined;
    });
    const r = await downloadUpdate(p => progress.push(p));
    expect(r).toEqual({ version: '0.2.3', downloaded: true });
    expect(progress).toEqual([
      { got: 50, total: 100, ratio: 0.5 },
      { got: 100, total: 100, ratio: 1 },
    ]);
    expect(invoke).toHaveBeenCalledWith('update_download');
  });

  it('installUpdate 把壳的进度事件转成阶段', async () => {
    const stages: InstallStage[] = [];
    invoke.mockImplementation(async () => {
      emit({ stage: 'downloading', got: 5, total: 10 });
      emit({ stage: 'downloading', got: 5, total: null });
      emit({ stage: 'backing_up' });
      emit({ stage: 'installing' });
    });
    await installUpdate(s => stages.push(s));
    expect(stages).toEqual([
      { stage: 'downloading', ratio: 0.5, got: 5, total: 10 },
      { stage: 'downloading', ratio: undefined, got: 5 },
      { stage: 'backing_up' },
      { stage: 'installing' },
    ]);
    expect(invoke).toHaveBeenCalledWith('update_install', { skipBackup: false });
  });

  it('备份失败抛 BackupFailed 并带原因，其他错误原样抛', async () => {
    invoke.mockRejectedValueOnce('backup_failed:磁盘满了');
    const e = await installUpdate(() => undefined).catch(x => x);
    expect(e).toBeInstanceOf(BackupFailed);
    expect(e.message).toBe('磁盘满了');
    invoke.mockRejectedValueOnce('签名不对');
    await expect(installUpdate(() => undefined)).rejects.toBe('签名不对');
  });

  it('用户确认后带 skipBackup 再调', async () => {
    invoke.mockResolvedValue(undefined);
    await installUpdate(() => undefined, { skipBackup: true });
    expect(invoke).toHaveBeenCalledWith('update_install', { skipBackup: true });
  });
});

describe('更新策略、冷却与版本变更检测', () => {
  beforeEach(() => stubStorage());
  afterEach(() => vi.unstubAllGlobals());

  it('默认策略为自动后台下载，兼容旧开关 tibi.update.auto=0', () => {
    expect(getUpdateMode()).toBe('auto');
    expect(autoCheckOn()).toBe(true);
    localStorage.setItem('tibi.update.auto', '0');
    expect(getUpdateMode()).toBe('off');
    expect(autoCheckOn()).toBe(false);
    setUpdateMode('notify');
    expect(getUpdateMode()).toBe('notify');
    expect(autoCheckOn()).toBe(true);
    setUpdateMode('off');
    expect(autoCheckOn()).toBe(false);
  });

  it('冷却仅在检查成功后记录，失败不消耗检查窗口', () => {
    const t0 = 1_700_000_000_000;
    expect(shouldAutoCheck(t0)).toBe(true);
    markChecked(t0);
    expect(shouldAutoCheck(t0 + CHECK_INTERVAL_MS - 1000)).toBe(false);
    expect(shouldAutoCheck(t0 + CHECK_INTERVAL_MS)).toBe(true);
  });

  it('升级重启后识别新版本并带回更新说明，重复启动不再重复提示', () => {
    expect(detectJustUpdated('0.2.2')).toBeUndefined();
    rememberInstallingUpdate('0.2.3', '- 新增后台静默下载');
    expect(detectJustUpdated('0.2.3')).toEqual({
      version: '0.2.3',
      prevVersion: '0.2.2',
      notes: '- 新增后台静默下载',
    });
    expect(detectJustUpdated('0.2.3')).toBeUndefined();
  });

  it('formatReleaseNotes 支持纯 Markdown 与 JSON 双语对象', () => {
    expect(formatReleaseNotes('  - 修复若干问题  ', 'zh')).toBe('- 修复若干问题');
    expect(formatReleaseNotes(JSON.stringify({ zh: '中文说明', en: 'English notes' }), 'zh')).toBe('中文说明');
    expect(formatReleaseNotes(JSON.stringify({ zh: '中文说明', en: 'English notes' }), 'en')).toBe('English notes');
    expect(formatReleaseNotes('   ')).toBeUndefined();
  });
});

describe('全局 useUpdate 状态机', () => {
  beforeEach(() => {
    stubStorage();
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    invoke.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('默认 auto 模式检查到新版本后自动在后台下载并进入 ready', async () => {
    const { useUpdate } = await import('../src/store/update');
    useUpdate.getState().resetForTest();
    invoke.mockImplementation(async cmd => {
      if (cmd === 'update_check') {
        return { available: true, version: '0.2.3', currentVersion: '0.2.2', notes: '亮点功能', date: '2026-11-27', downloaded: false, installIssue: null, platform: 'macos' };
      }
      if (cmd === 'update_download') {
        emit({ stage: 'downloading', got: 40, total: 100 });
        return { version: '0.2.3', downloaded: true };
      }
      return { ok: true };
    });

    await useUpdate.getState().check({ manual: false });
    // 等待异步后台 download 完成
    await vi.waitFor(() => expect(useUpdate.getState().phase).toBe('ready'));
    expect(useUpdate.getState().version).toBe('0.2.3');
    expect(useUpdate.getState().notes).toBe('亮点功能');
    expect(useUpdate.getState().date).toBe('2026-11-27');
  });

  it('notify 模式只提醒不自动下载；跳过版本后自动检查保持静默', async () => {
    setUpdateMode('notify');
    const { useUpdate } = await import('../src/store/update');
    useUpdate.getState().resetForTest();
    invoke.mockImplementation(async cmd => {
      if (cmd === 'update_check') {
        return { available: true, version: '0.2.3', currentVersion: '0.2.2', notes: '更新说明', downloaded: false, installIssue: null };
      }
      return { ok: true };
    });

    await useUpdate.getState().check({ manual: false });
    expect(useUpdate.getState().phase).toBe('available');
    expect(invoke).not.toHaveBeenCalledWith('update_download');

    useUpdate.getState().skipVersion('0.2.3');
    expect(useUpdate.getState().phase).toBe('idle');

    await useUpdate.getState().check({ manual: false });
    expect(useUpdate.getState().phase).toBe('idle');

    // 手动检查忽略「跳过此版本」
    await useUpdate.getState().check({ manual: true });
    expect(useUpdate.getState().phase).toBe('available');
  });

  it('静默后台下载失败时优雅退回 available，不弹错误；手动下载失败进入 error 并提供安装包链接', async () => {
    const { useUpdate } = await import('../src/store/update');
    useUpdate.getState().resetForTest();
    invoke.mockImplementation(async cmd => {
      if (cmd === 'update_check') return { available: true, version: '0.2.3', currentVersion: '0.2.2', downloaded: false };
      if (cmd === 'update_download') throw new Error('network reset');
      if (cmd === 'update_installer_asset') return 'Tibi_aarch64.dmg';
      return { ok: true };
    });

    await useUpdate.getState().check({ manual: false });
    await vi.waitFor(() => expect(useUpdate.getState().phase).toBe('available'));
    expect(useUpdate.getState().error).toBeUndefined();

    await useUpdate.getState().download({ silent: false });
    expect(useUpdate.getState().phase).toBe('error');
    expect(useUpdate.getState().installerUrl).toBe('https://dl.ferecord.com/latest/Tibi_aarch64.dmg');
  });
});

describe('App Store 分发', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.useRealTimers(); });

  it('不启动更新检查，也不读取旧的自动更新设置', async () => {
    vi.stubEnv('VITE_DISTRIBUTION', 'app-store');
    vi.resetModules();
    vi.useFakeTimers();
    const { isAppStore, autoCheckOn: autoOn, startAutoUpdateCheck } = await import('../src/lib/update');
    invoke.mockReset();
    const found = vi.fn();
    expect(isAppStore).toBe(true);
    expect(autoOn()).toBe(false);
    const stop = startAutoUpdateCheck(found);
    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    expect(invoke).not.toHaveBeenCalled();
    expect(found).not.toHaveBeenCalled();
    stop();
  });
});
