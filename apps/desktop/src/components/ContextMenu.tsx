import * as DM from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { isMacDesktop, popupNativeMenu, type NativeItem, type NativeMenuHandle } from '../lib/macNative';
import { tl } from '../lib/i18n';
import { errorInfo } from '../rpc';
import { toast } from '../store/ui';

export type ContextItem = NativeItem;
export interface MenuPosition { x: number; y: number; focus: HTMLElement }

/** 用现有 Radix 菜单处理焦点 / 子菜单 / 碰撞；锚点是本次指针坐标。mac 交给系统。 */
export function ContextMenu({ items, position, onClose, label = tl('阅读操作') }: { items: (ContextItem | null)[]; position: MenuPosition; onClose(): void; label?: string }) {
  const latest = useRef(items); latest.current = items;
  const native = useRef<NativeMenuHandle | undefined>(undefined);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!isMacDesktop) return;
    let disposed = false;
    // 系统菜单退出后仍把键盘留在原触发位置；取消时无需重新读取选区。
    position.focus.focus({ preventScroll: true });
    void popupNativeMenu(latest.current, position).then(async handle => {
      if (disposed) { await handle.close(); return; }
      native.current = handle;
      for (const item of latest.current) if (item?.id) await handle.update(item.id, item);
    }).catch(e => { if (!disposed) { toast(errorInfo(e).message, { kind: 'err' }); close.current(); } });
    return () => { disposed = true; const menu = native.current; native.current = undefined; void menu?.close().catch(() => undefined); };
  }, [position]);
  useEffect(() => {
    for (const item of items) if (item?.id) void native.current?.update(item.id, item).catch(() => undefined);
  }, [items]);
  if (isMacDesktop) return null;
  const restoreFocus = () => {
    const focused = document.activeElement;
    // 命令可能刚打开对话框或行内改名；已有的新焦点交给该控件，不能被菜单卸载抢回。
    if ((!focused || focused === document.body || focused.closest('.ctx-menu')) && position.focus.isConnected) position.focus.focus({ preventScroll: true });
  };
  // 先接收命令，再还焦点；反过来会触发 Radix 的 focus-outside，提前清掉本次目标。
  const select = (item: ContextItem) => { item.run?.(); restoreFocus(); };
  const rows = (list: (ContextItem | null)[]) => list.map((it, i) => {
    if (!it) return <DM.Separator className="ctx-sep" key={`sep-${i}`} />;
    if (it.items) return <DM.Sub key={it.id ?? it.label}>
      <DM.SubTrigger className="ctx-item"><span className="ctx-check" /><span>{it.label}</span><ChevronRight size={14} className="ctx-arrow" /></DM.SubTrigger>
      <DM.Portal><DM.SubContent className="dmenu ctx-menu" sideOffset={3} collisionPadding={8} loop onClick={e => e.stopPropagation()}>{rows(it.items)}</DM.SubContent></DM.Portal>
    </DM.Sub>;
    const children = <><span className="ctx-check">{it.checked && <Check size={13} />}</span><span>{it.label}</span></>;
    return it.checked === undefined
      ? <DM.Item key={it.id ?? it.label} className={`ctx-item${it.danger ? ' danger' : ''}`} disabled={it.enabled === false} onSelect={() => select(it)}>{children}</DM.Item>
      : <DM.CheckboxItem key={it.id ?? it.label} className="ctx-item" checked={it.checked} disabled={it.enabled === false} onSelect={() => select(it)}>{children}</DM.CheckboxItem>;
  });
  return <DM.Root open modal={false} onOpenChange={open => { if (!open) onClose(); }}>
    <DM.Trigger className="ctx-anchor" tabIndex={-1} aria-hidden="true" style={{ left: position.x, top: position.y }} />
    <DM.Portal><DM.Content className="dmenu ctx-menu" align="start" sideOffset={0} collisionPadding={8} loop aria-label={label} onClick={e => e.stopPropagation()}
      onCloseAutoFocus={e => {
        e.preventDefault();
        // 切到另一个右键目标时，旧菜单的延迟恢复焦点不能关闭新菜单。
        if (!document.querySelector('[role="menu"][data-state="open"]')) restoreFocus();
      }} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Tab') onClose(); }}>
      {rows(items)}
    </DM.Content></DM.Portal>
  </DM.Root>;
}
