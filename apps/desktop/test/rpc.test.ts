import { describe, expect, it } from 'vitest';
import { errorInfo, RpcError } from '../src/rpc/client';

describe('rpc 错误归一', () => {
  it('RpcError 带业务码', () => {
    const e = new RpcError('没有这个方法', 'not_found', -32001);
    expect(errorInfo(e)).toEqual({ message: '没有这个方法', code: 'not_found' });
    expect(errorInfo(new Error('x'))).toEqual({ message: 'x', code: 'internal' });
    expect(errorInfo('y')).toEqual({ message: 'y', code: 'internal' });
  });
});
