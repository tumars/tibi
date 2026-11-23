import { MoreHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { tl } from '../lib/i18n';
import { ContextMenu, type ContextItem, type MenuPosition } from './ContextMenu';

/** 列表对象共用右键、更多按钮和菜单键；命令仍由各页面直接提供。scope 变化即作废旧目标。 */
export function useObjectMenu<T>(itemsFor: (target: T) => (ContextItem | null)[], scope: unknown) {
  const [opened, setOpened] = useState<{ target: T; position: MenuPosition; scope: unknown }>();
  const active = useRef(opened);
  const currentScope = useRef(scope); currentScope.current = scope;
  const close = useCallback(() => { active.current = undefined; setOpened(undefined); }, []);
  useEffect(() => { close(); }, [scope, close]);
  useEffect(() => () => { active.current = undefined; }, []);

  const open = (target: T, e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    if ((e.target as Element).closest('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault(); e.stopPropagation();
    const origin = (e.target as Element).closest<HTMLElement>('button, a, [tabindex]');
    const focus = origin && e.currentTarget.contains(origin) ? origin : e.currentTarget;
    const r = focus.getBoundingClientRect();
    const pointer = 'clientX' in e && e.type === 'contextmenu' && (e.clientX !== 0 || e.clientY !== 0);
    const next = { target, scope, position: { x: pointer ? e.clientX : r.left, y: pointer ? e.clientY : r.bottom, focus } };
    active.current = next; setOpened(next);
  };
  const onKeyDown = (target: T, e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) open(target, e);
  };
  useEffect(() => {
    if (!opened) return;
    // 忽略弹出前已发生、延迟派发的 scroll，也不因菜单自身滚动关闭菜单。
    const ancestors: { el: HTMLElement; top: number; left: number }[] = [];
    for (let el: HTMLElement | null = opened.position.focus; el; el = el.parentElement) ancestors.push({ el, top: el.scrollTop, left: el.scrollLeft });
    const scroll = () => { if (ancestors.some(p => p.el.scrollTop !== p.top || p.el.scrollLeft !== p.left)) close(); };
    const down = (e: PointerEvent) => { if (!(e.target as Element).closest('.ctx-menu')) close(); };
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('blur', close); window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('scroll', scroll, true); document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('blur', close); window.removeEventListener('resize', close);
    };
  }, [opened, close]);
  const wrap = (list: (ContextItem | null)[]): (ContextItem | null)[] => list.map(item => !item ? null : item.items ? { ...item, items: wrap(item.items) } : {
    ...item, run: () => {
      if (!opened || active.current !== opened || opened.scope !== currentScope.current || !opened.position.focus.isConnected) return;
      close(); item.run?.();
    },
  });
  return { open, onKeyDown, close, isOpen: !!opened && opened.scope === scope,
    menu: opened && opened.scope === scope ? <ContextMenu items={wrap(itemsFor(opened.target))} position={opened.position} label={tl('更多操作')}
      onClose={() => { if (active.current === opened) close(); }} /> : null };
}

export function ObjectMenuButton({ onClick, className = '' }: { onClick: (e: MouseEvent<HTMLButtonElement>) => void; className?: string }) {
  return <button type="button" className={`ibtn object-more ${className}`} aria-label={tl('更多操作')} title={tl('更多操作')} aria-haspopup="menu" onClick={onClick}><MoreHorizontal /></button>;
}
