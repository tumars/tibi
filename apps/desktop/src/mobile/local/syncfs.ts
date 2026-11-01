import { sync } from '@tibi/core';
import type { Invoke } from './driver';

/**
 * 手机上的同步文件夹后端（08 §8）：经壳的 sync_fs_* 命令读写"资料库根目录"（iOS 的 iCloud Drive 容器；桌面预览时是选的文件夹）。
 * 读不到（含 iCloud 还没下载下来的占位文件）时返回 undefined，下次同步再读。
 */
export function invokeFolderBackend(inv: Invoke, root: string, kind: 'icloud' | 'folder', readBytes: (cmd: string, args: Record<string, unknown>) => Promise<Uint8Array>): sync.SyncBackend {
  const b64 = (d: Uint8Array) => { let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000)); return btoa(s); };
  return {
    kind,
    async read(path) {
      try { return await readBytes('sync_fs_read', { root, path }); }
      catch (e) { if (String(e).includes('ENOENT')) return undefined; throw new sync.SyncError('other', String(e)); }
    },
    async write(path, data) {
      try { await inv('sync_fs_write', { root, path, data: b64(data) }); }
      catch (e) { throw new sync.SyncError(String(e).includes('QUOTA') ? 'quota' : 'other', String(e).includes('QUOTA') ? '存储空间不够了。' : String(e)); }
    },
    list: dir => inv<string[]>('sync_fs_list', { root, dir }),
    async remove(path) { await inv('sync_fs_remove', { root, path }); },
  };
}
