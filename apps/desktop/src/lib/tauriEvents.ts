import { isTauri } from '../rpc';

/**
 * 安全监听 Tauri 事件：处理组件在 listen() Promise 解析前就卸载的竞态，避免监听器泄漏。
 */
export function listenSafe<T = unknown>(event: string, handler: (payload: T) => void, onReady?: () => void): () => void {
  if (!isTauri()) return () => undefined;
  let active = true;
  let unlisten: (() => void) | undefined;
  void import('@tauri-apps/api/event')
    .then(({ listen }) => listen<T>(event, e => { if (active) handler(e.payload); }))
    .then(off => {
      if (active) {
        unlisten = off;
        onReady?.();
      } else {
        off();
      }
    })
    .catch(() => undefined);
  return () => {
    active = false;
    unlisten?.();
    unlisten = undefined;
  };
}

/** 安全监听桌面 WebView 文件拖放事件，处理挂载/卸载竞态 */
export function listenDragDropSafe(handler: (paths: string[]) => void | Promise<void>): () => void {
  if (!isTauri()) return () => undefined;
  let active = true;
  let unlisten: (() => void) | undefined;
  void import('@tauri-apps/api/webview')
    .then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent(ev => {
      if (active && ev.payload.type === 'drop') void handler(ev.payload.paths);
    }))
    .then(off => {
      if (active) unlisten = off;
      else off();
    })
    .catch(() => undefined);
  return () => {
    active = false;
    unlisten?.();
    unlisten = undefined;
  };
}
