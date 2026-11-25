import { Info } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { tl } from '../../lib/i18n';

export interface InfoTipProps {
  /** 提示气泡内容，默认隐藏，悬停或点击 ① 触发 */
  content: ReactNode;
  /** 无障碍标签，默认「说明」 */
  label?: string;
  className?: string;
}

/**
 * ① 提示气泡：将低频规则、计算口径与操作说明折叠在 ⓘ 触发器内，默认不占版面。
 * 使用 body Portal + 视口边界钳制，避免在滚动容器或侧边栏内被裁切。
 */
export function InfoTip({ content, label, className }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();

  const updatePos = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const popW = popRef.current?.offsetWidth ?? 260;
    const popH = popRef.current?.offsetHeight ?? 64;
    const gap = 8;
    const margin = 12;
    const preferTop = rect.top - gap - popH >= margin;
    const top = preferTop ? rect.top - gap - popH : Math.min(window.innerHeight - popH - margin, rect.bottom + gap);
    const idealLeft = rect.left + rect.width / 2 - popW / 2;
    const left = Math.min(Math.max(margin, idealLeft), Math.max(margin, window.innerWidth - popW - margin));
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    const raf = requestAnimationFrame(updatePos);
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
      setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const showHover = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const hideHover = () => {
    if (pinned) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`ui-tip-btn${className ? ` ${className}` : ''}`}
        aria-label={label ?? tl('说明')}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={showHover}
        onMouseLeave={hideHover}
        onFocus={showHover}
        onBlur={hideHover}
        onClick={e => {
          e.stopPropagation();
          clearTimeout(timer.current);
          setPinned(p => {
            const next = !p;
            setOpen(next);
            return next;
          });
        }}
      >
        <Info aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          id={id}
          role="tooltip"
          className="ui-tip-pop"
          style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
          onMouseEnter={() => clearTimeout(timer.current)}
          onMouseLeave={hideHover}
          onClick={e => e.stopPropagation()}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
