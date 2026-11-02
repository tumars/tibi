import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttle } from '../src/lib/util';

describe('throttle.flush', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('把等着的那次立刻发出去，之后不再重复发', () => {
    const fn = vi.fn();
    const t = throttle(fn, 1500);
    t('a'); t('b'); t('c');
    expect(fn).toHaveBeenCalledTimes(1);
    t.flush();
    expect(fn).toHaveBeenLastCalledWith('c');
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('没有等着的就什么都不做', () => {
    const fn = vi.fn();
    const t = throttle(fn, 1500);
    t.flush();
    t('a');
    t.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
