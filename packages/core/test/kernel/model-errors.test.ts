import { describe, expect, it } from 'vitest';
import { friendlyModelError, retryReason } from '../../src/kernel/model-errors.js';

describe('模型错误转成人话', () => {
  it('常见状态码', () => {
    expect(friendlyModelError('401: {"message":"Authentication Fails, Your api key: ****fake is invalid"}')).toMatch(/API Key 不对/);
    expect(friendlyModelError('402 Insufficient Balance')).toMatch(/余额不足/);
    expect(friendlyModelError('429 Too Many Requests')).toMatch(/太频繁/);
    expect(friendlyModelError('fetch failed')).toMatch(/连不上/);
    expect(friendlyModelError('503 Service Unavailable')).toMatch(/暂时出错（503）/);
    expect(friendlyModelError('something odd')).toBe('模型调用失败：something odd');
  });
});

describe('重试原因', () => {
  it('按真实原因说，认不出来才说模型忙', () => {
    expect(retryReason('Request timed out.')).toBe('连不上模型服务');
    expect(retryReason('429 Too Many Requests')).toBe('请求太频繁或额度用完了（429）');
    expect(retryReason('503 Service Unavailable')).toBe('模型服务暂时出错（503）');
    expect(retryReason('overloaded')).toBe('模型忙');
    expect(retryReason()).toBe('模型忙');
  });
});
