import { useSyncExternalStore } from 'react';
import { isTauri, isWeb } from '../rpc/client';

/**
 * 电台本地音频路径解析（同 imageSrc.ts 约定）：
 * - `media:podcasts/<file>`：Tauri 下用 convertFileSrc 读 $APPDATA/media/podcasts/<file>；
 *   浏览器开发模式（pnpm core:dev）经 http://127.0.0.1:3456/media/podcasts/<file> 带 Range 播放。
 * - `http(s)://...`：原样流式播放。
 */
let mediaUrl: ((rel: string) => string) | undefined;
const listeners = new Set<() => void>();

if (isTauri()) {
  void Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/path')]).then(async ([core, path]) => {
    const dir = await path.appDataDir(); const sep = path.sep();
    mediaUrl = rel => core.convertFileSrc([dir.replace(/[\\/]+$/, ''), 'media', ...rel.split('/')].join(sep));
    for (const l of listeners) l();
  }).catch(() => undefined);
} else if (!isWeb()) {
  // 浏览器开发桥（ws://127.0.0.1:3456 → http://127.0.0.1:3456）
  const ws = (import.meta.env.VITE_CORE_WS as string | undefined) || 'ws://127.0.0.1:3456';
  const httpBase = ws.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:').replace(/\/+$/, '');
  mediaUrl = rel => `${httpBase}/media/${rel}`;
}

export function useMediaSrcReady(): boolean {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => !!mediaUrl);
}

/** 优先用本地缓存音频，没有或未就绪时退回远程流式地址 */
export function resolveMediaSrc(mediaPath?: string, mediaUrlFallback?: string): string | undefined {
  if (mediaPath) {
    if (mediaPath.startsWith('media:')) {
      const rel = mediaPath.slice('media:'.length);
      if (/^podcasts\/[\w-][\w.-]*$/.test(rel)) {
        const resolved = mediaUrl?.(rel);
        if (resolved) return resolved;
      }
    } else if (/^https?:\/\//i.test(mediaPath)) {
      return mediaPath;
    }
  }
  if (mediaUrlFallback && /^https?:\/\//i.test(mediaUrlFallback)) return mediaUrlFallback;
  return undefined;
}

/** 毫秒 → MM:SS 或 H:MM:SS */
export function fmtClock(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
