import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { sync } from '@tibi/core';
type SyncBackend = sync.SyncBackend;

/**
 * 同步的文件夹后端（08 §8）：写文件先写临时文件再改名，别的设备不会读到写了一半的文件。
 * iCloud Drive：用应用自己的容器 iCloud~app~tibi/Documents/Tibi Sync（和 iPhone 上的 Tibi 是同一个），
 * 需要签名并带 iCloud 权限的版本才有这个容器；没有时提示改用 WebDAV 或自选文件夹。
 */
export function folderBackend(root: string, kind: 'folder' | 'icloud' = 'folder'): SyncBackend {
  const abs = (p: string) => join(root, ...p.split('/'));
  return {
    kind,
    async read(p) { try { return new Uint8Array(await readFile(abs(p))); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } },
    async write(p, d) {
      const f = abs(p); await mkdir(dirname(f), { recursive: true });
      const tmp = `${f}.tmp-${process.pid}`;
      try { await writeFile(tmp, d); await rename(tmp, f); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOSPC') throw new sync.SyncError('quota', '磁盘空间不够了。'); throw e; }
    },
    async list(dir) { try { return (await readdir(abs(dir), { withFileTypes: true })).filter(e => e.isFile() && !e.name.includes('.tmp-')).map(e => e.name); } catch { return []; } },
    async remove(p) { await rm(abs(p), { force: true }); },
  };
}

export function icloudRoot(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  const container = join(homedir(), 'Library', 'Mobile Documents', 'iCloud~app~tibi');
  return existsSync(container) ? join(container, 'Documents', 'Tibi Sync') : undefined;
}

export async function syncFolder(o: { kind: 'icloud' } | { kind: 'folder'; path: string }): Promise<SyncBackend> {
  if (o.kind === 'icloud') {
    const root = icloudRoot();
    if (!root) throw new sync.SyncError('other', process.platform === 'darwin' ? '这台 Mac 上的 Tibi 没有 iCloud 权限（需要签名的正式版本）。可以改用 WebDAV，或选一个文件夹。' : 'iCloud Drive 只在 Mac 和 iPhone 上可用，这里请用 WebDAV 或选一个文件夹。');
    await mkdir(root, { recursive: true });
    return folderBackend(root, 'icloud');
  }
  const root = join(o.path, o.path.endsWith('Tibi Sync') ? '' : 'Tibi Sync');
  await mkdir(root, { recursive: true });
  return folderBackend(root);
}

export const deviceName = () => hostname().replace(/\.local$/, '');
