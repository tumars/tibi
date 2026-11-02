import type { Status } from '@tibi/core';
import { STATUS_NAMES } from '../lib/util';

/** 熟练度变化：升档时新档弹一下（03 §8），降档只显示文字 */
export function LevelUp({ from, to }: { from: Status; to: Status }) {
  return (
    <div className="lvup">
      <span className={`stage s${from}`}>{STATUS_NAMES[from]}</span>→<span className={`stage s${to}${to > from ? ' pop' : ''}`}>{STATUS_NAMES[to]}</span>
    </div>
  );
}
