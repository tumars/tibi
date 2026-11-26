import { isTauri } from '../rpc';
import { useUi } from '../store/ui';
import { tl } from './i18n';
import { isAppStore } from './update';

/**
 * mac 原生感里要靠系统做的部分（E2、E5）：窗口外观跟 App 主题、菜单栏、右键菜单。
 * 只在 mac 桌面版生效；浏览器开发和 Windows / Linux 都不走这里。
 */
export const isMacDesktop = isTauri() && typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export interface NativeItem { id?: string; label: string; run?: () => void; enabled?: boolean; checked?: boolean; danger?: boolean; items?: (NativeItem | null)[] }
export interface NativeMenuHandle { close(): Promise<void>; update(id: string, item: NativeItem): Promise<void> }
let lastPopup: NativeMenuHandle | undefined;
let popupId = 0;

/** 弹系统右键菜单 */
export async function popupNativeMenu(items: (NativeItem | null)[], at?: { x: number; y: number }): Promise<NativeMenuHandle> {
  const { Menu } = await import('@tauri-apps/api/menu');
  const { LogicalPosition, Position } = await import('@tauri-apps/api/dpi');
  const { invoke } = await import('@tauri-apps/api/core');
  await lastPopup?.close();
  const prefix = `ctx-${++popupId}`;
  const convert = (list: (NativeItem | null)[], path = prefix): NonNullable<Parameters<typeof Menu.new>[0]>['items'] => list.map((it, i) => {
    if (!it) return { item: 'Separator' as const };
    const base = { id: it.id ?? `${path}-${i}`, text: it.label, enabled: it.enabled ?? true };
    if (it.items) return { ...base, items: convert(it.items, `${path}-${i}`) };
    return { ...base, ...(it.checked === undefined ? {} : { checked: it.checked }), action: it.run };
  });
  const menu = await Menu.new({ items: convert(items) });
  let closed = false;
  const handle: NativeMenuHandle = {
    async close() {
      if (closed) return;
      closed = true;
      if (lastPopup === handle) lastPopup = undefined;
      await menu.close();
    },
    async update(id, value) {
      if (closed) return;
      const item = await menu.get(id);
      if (!item) return;
      try {
        await item.setText(value.label);
        if ('setEnabled' in item) await item.setEnabled(value.enabled ?? true);
        if (value.checked !== undefined && 'setChecked' in item) await item.setChecked(value.checked);
      } finally { await item.close(); }
    },
  };
  lastPopup = handle;
  try {
    await invoke('popup_context_menu', { rid: menu.rid, at: at ? new Position(new LogicalPosition(at.x, at.y)) : undefined });
  } catch (e) {
    await handle.close();
    throw e;
  }
  // 菜单返回后命令事件仍可能在投递，保留资源到卸载或下一次弹出。
  return handle;
}

/** 侧栏材质由窗口外观决定：App 单独选了深 / 浅色时，窗口和菜单栏面板要跟着变，否则侧栏和内容区对不上 */
async function syncWindowTheme() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const { invoke } = await import('@tauri-apps/api/core');
  const win = getCurrentWindow();
  const apply = (t: 'auto' | 'light' | 'dark') => Promise.all([
    win.setTheme(t === 'auto' ? null : t).catch(() => undefined),
    invoke('tray_sync_theme', { theme: t }).catch(() => undefined),
  ]);
  await apply(useUi.getState().theme);
  let last = useUi.getState().theme;
  useUi.subscribe(s => { if (s.theme !== last) { last = s.theme; void apply(last); } });
}

let tibiMenu: Awaited<ReturnType<typeof import('@tauri-apps/api/menu').Submenu.new>> | undefined;

async function installMenuBar(go: (to: string) => void, onCheckUpdate?: () => void) {
  const { Menu, Submenu } = await import('@tauri-apps/api/menu');
  const nav = (text: string, to: string, n: number) => ({ id: `go-${n}`, text, accelerator: `Cmd+${n}`, action: () => go(to) });
  const win = await Submenu.new({
    text: tl('窗口'),
    items: [
      { item: 'Minimize', text: tl('最小化') },
      { item: 'Maximize', text: tl('缩放') },
      { item: 'Separator' },
      { item: 'CloseWindow', text: tl('关闭窗口') },
    ],
  });
  const appSubmenu = await Submenu.new({
    text: 'Tibi',
    items: [
      { item: { About: null }, text: tl('关于 Tibi') },
      { item: 'Separator' },
      { id: 'settings', text: tl('设置…'), accelerator: 'Cmd+,', action: () => go('/settings') },
      ...(isAppStore ? [] : [{ id: 'update', text: tl('检查更新…'), action: () => (onCheckUpdate ? onCheckUpdate() : go('/settings?sec=about')) }]),
      { item: 'Separator' },
      { item: 'Services', text: tl('服务') },
      { item: 'Separator' },
      { item: 'Hide', text: tl('隐藏 Tibi') },
      { item: 'HideOthers', text: tl('隐藏其他') },
      { item: 'ShowAll', text: tl('全部显示') },
      { item: 'Separator' },
      { item: 'Quit', text: tl('退出 Tibi') },
    ],
  });
  tibiMenu = appSubmenu;
  const menu = await Menu.new({
    items: [
      appSubmenu,
      await Submenu.new({
        text: tl('文件'),
        items: [
          { id: 'new-chat', text: tl('新对话'), accelerator: 'Cmd+N', action: () => go('/') },
          { id: 'search', text: tl('搜索…'), accelerator: 'Cmd+K', action: () => window.dispatchEvent(new Event('tibi:search-toggle')) },
          { item: 'Separator' },
          { item: 'CloseWindow', text: tl('关闭窗口') },
        ],
      }),
      await Submenu.new({
        text: tl('编辑'),
        items: [
          { item: 'Undo', text: tl('撤销') },
          { item: 'Redo', text: tl('重做') },
          { item: 'Separator' },
          { item: 'Cut', text: tl('剪切') },
          { item: 'Copy', text: tl('拷贝') },
          { item: 'Paste', text: tl('粘贴') },
          { item: 'SelectAll', text: tl('全选') },
          { item: 'Separator' },
          { id: 'find', text: tl('查找…'), accelerator: 'Cmd+F', action: () => window.dispatchEvent(new Event('tibi:find')) },
        ],
      }),
      await Submenu.new({
        text: tl('显示'),
        items: [
          { id: 'side', text: tl('显示或隐藏侧栏'), accelerator: 'Cmd+\\', action: () => useUi.getState().toggleSide() },
          { item: 'Separator' },
          { item: 'Fullscreen', text: tl('进入全屏幕') },
        ],
      }),
      await Submenu.new({
        text: tl('前往'),
        items: [
          nav(tl('首页'), '/', 1), nav(tl('书架'), '/library', 2), nav(tl('生词本'), '/words', 3), nav(tl('词典'), '/dict', 4),
          nav(tl('复习'), '/review', 5), nav(tl('统计'), '/stats', 6),
        ],
      }),
      win,
    ],
  });
  await menu.setAsAppMenu();
  await win.setAsWindowsMenuForNSApp();
}

/** WebView 自带的右键菜单（重新载入等）不该出现；输入框和选中的文字保留系统的拷贝、查询 */
function blockWebviewContextMenu() {
  if (import.meta.env.DEV) return;   // 开发时留着"检查元素"
  document.addEventListener('contextmenu', e => {
    if (e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('input, textarea, [contenteditable="true"]')) return;
    if (t?.closest('[data-reader-body] figure')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    e.preventDefault();
  });
}

/** 动态更新 macOS 应用菜单里的「检查更新…」文案（如发现新版本 / 正在下载 / 重启以更新） */
export async function syncMacUpdateMenu(info: { phase: string; version?: string }) {
  if (!isMacDesktop || isAppStore || !tibiMenu) return;
  const item = await tibiMenu.get('update');
  if (!item) return;
  const label =
    info.phase === 'ready' && info.version ? tl('重启以更新到 {v0}…', { v0: info.version })
    : info.phase === 'downloading' && info.version ? tl('正在下载更新 {v0}…', { v0: info.version })
    : info.phase === 'available' && info.version ? tl('发现新版本 {v0}…', { v0: info.version })
    : tl('检查更新…');
  try {
    if ('setText' in item) await item.setText(label);
  } finally {
    await item.close();
  }
}

let installed = false;
export function installMacNative(go: (to: string) => void, onCheckUpdate?: () => void) {
  if (!isMacDesktop || installed) return;
  installed = true;
  blockWebviewContextMenu();
  void syncWindowTheme().catch(e => console.warn('窗口外观同步失败', e));
  void installMenuBar(go, onCheckUpdate).catch(e => console.warn('菜单栏安装失败', e));
}
