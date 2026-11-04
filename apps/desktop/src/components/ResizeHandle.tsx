import { tl } from '../lib/i18n';

/**
 * 拖动改栏宽的把手：拖动中只改内存（save=false），松手才落盘；双击恢复默认。
 * side 是把手所在的那一侧：栏在左、把手在右边缘时往右拖变宽，反之往左拖变宽。
 */
export function ResizeHandle({ className, width, side, onChange, onReset, onDragging }: {
  className: string; width: number; side: 'left' | 'right';
  onChange(w: number, save: boolean): void; onReset(): void; onDragging(on: boolean): void;
}) {
  const start = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, sign = side === 'right' ? 1 : -1;
    onDragging(true);
    const move = (ev: PointerEvent) => onChange(width + sign * (ev.clientX - x0), false);
    const up = (ev: PointerEvent) => {
      onChange(width + sign * (ev.clientX - x0), true); onDragging(false);
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  return <div className={`resize-h ${className}`} onPointerDown={start} onDoubleClick={onReset} title={tl('拖动调整宽度，双击恢复')} />;
}
