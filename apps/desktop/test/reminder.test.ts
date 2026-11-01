import { describe, expect, it } from 'vitest';
import { nextAt, reminderBody } from '../src/lib/reminder';

describe('每日提醒（J8）', () => {
  it('下一次的时间：今天的点没过就是今天，过了就是明天', () => {
    const at7 = new Date(2026, 9, 31, 7, 30);
    expect(nextAt('morning', at7).getDate()).toBe(31);
    expect(nextAt('morning', new Date(2026, 9, 31, 9, 0)).getDate()).toBe(1);
    expect(nextAt('evening', at7).getHours()).toBe(20);
  });
  it('内容是待复习数', () => {
    expect(reminderBody(12)).toContain('12');
    expect(reminderBody(0)).toMatch(/没有要复习/);
  });
});
