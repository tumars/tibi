import type { Status } from '@tibi/core';
import { tl } from '../../lib/i18n';
import { STATUS_NAMES } from '../../lib/util';

export interface StageBarProps {
  status?: Status;
  onSelect: (s: Status) => void;
  showShortcutTitle?: boolean;
  className?: string;
}

/** 六档熟练度选择器：生词 → 掌握，用于阅读器词卡与生词本详情抽屉 */
export function StageBar({ status, onSelect, showShortcutTitle = false, className }: StageBarProps) {
  return (
    <div className={`ui-stages${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={tl('熟练度')}>
      {([0, 1, 2, 3, 4, 5] as Status[]).map(s => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={status === s}
          data-s={s}
          className={`${status === s ? 'on' : ''}${status !== undefined && status <= 5 && s <= status ? ' fill' : ''}`}
          onClick={() => onSelect(s)}
          title={showShortcutTitle ? tl('{s} 键', { s }) : undefined}
        >
          <i />
          {STATUS_NAMES[s]}
        </button>
      ))}
    </div>
  );
}
