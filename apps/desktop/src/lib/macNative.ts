import { isTauri } from '../rpc';
import { useUi } from '../store/ui';
import { tl } from './i18n';

/**
 * mac 原生感里要靠系统做的部分（E2、E5）：窗口外观跟 App 主题、菜单栏、右键菜单。
 * 只在 mac 桌面版生效；浏览器开发和 Windows / Linux 都不走这里。
 */
export const isMacDesktop = isTauri() && typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export interface NativeItem { label: string; run: () => void }

/** 弹系统右键菜单 */
export async function popupNativeMenu(items: NativeItem[]) {
  const { Menu } = await import('@tauri-apps/api/menu');
  const menu = await Menu.new({ items: items.map((it, i) => ({ id: `ctx-${i}`, text: it.label, action: it.run })) });
  await menu.popup();
}

/** 侧栏材质由窗口外观决定：App 单独选了深 / 浅色时，窗口要跟着变，否则侧栏和内容区对不上 */
async function syncWindowTheme() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  const apply = (t: 'auto' | 'light' | 'dark') => win.setTheme(t === 'auto' ? null : t).catch(() => undefined);
  await apply(useUi.getState().theme);
  let last = useUi.getState().theme;
  useUi.subscribe(s => { if (s.theme !== last) { last = s.theme; void apply(last); } });
}

async function installMenuBar(go: (to: string) => void) {
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
  const menu = await Menu.new({
    items: [
      await Submenu.new({
        text: 'Tibi',
        items: [
          { item: { About: null }, text: tl('关于 Tibi') },
          { item: 'Separator' },
          { id: 'settings', text: tl('设置…'), accelerator: 'Cmd+,', action: () => go('/settings') },
          { id: 'update', text: tl('检查更新…'), action: () => go('/settings?sec=about') },
          { item: 'Separator' },
          { item: 'Services', text: tl('服务') },
          { item: 'Separator' },
          { item: 'Hide', text: tl('隐藏 Tibi') },
          { item: 'HideOthers', text: tl('隐藏其他') },
          { item: 'ShowAll', text: tl('全部显示') },
          { item: 'Separator' },
          { item: 'Quit', text: tl('退出 Tibi') },
        ],
      }),
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
    const t = e.target as HTMLElement | null;
    if (t?.closest('input, textarea, [contenteditable="true"]')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    e.preventDefault();
  });
}

let installed = false;
export function installMacNative(go: (to: string) => void) {
  if (!isMacDesktop || installed) return;
  installed = true;
  blockWebviewContextMenu();
  void syncWindowTheme().catch(e => console.warn('窗口外观同步失败', e));
  void installMenuBar(go).catch(e => console.warn('菜单栏安装失败', e));
}
