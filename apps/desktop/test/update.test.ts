import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupFailed, installUpdate, type InstallStage } from '../src/lib/update';

const invoke = vi.fn();
let emit: (payload: unknown) => void = () => undefined;
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async (_: string, f: (e: { payload: unknown }) => void) => { emit = payload => f({ payload }); return () => undefined; } }));

describe('安装更新', () => {
  beforeEach(() => invoke.mockReset());

  it('把壳的进度事件转成阶段', async () => {
    const stages: InstallStage[] = [];
    invoke.mockImplementation(async () => {
      emit({ stage: 'downloading', got: 5, total: 10 });
      emit({ stage: 'downloading', got: 5, total: null });
      emit({ stage: 'backing_up' });
      emit({ stage: 'installing' });
    });
    await installUpdate(s => stages.push(s));
    expect(stages).toEqual([{ stage: 'downloading', ratio: 0.5 }, { stage: 'downloading', ratio: undefined }, { stage: 'backing_up' }, { stage: 'installing' }]);
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
