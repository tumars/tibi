import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: unknown[] = []; const toasts: string[] = [];
let pending: { url: string }[] = [];
vi.mock('../src/rpc', () => ({
  isTauri: () => true,
  rpc: { call: vi.fn(async (_m: string, p: { source: { url: string } }) => { calls.push(p); if (p.source.url.includes('bad')) throw new Error('抓不到'); return { task_id: 't' }; }) },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (cmd: string) => { if (cmd === 'share_take_pending') { const r = pending; pending = []; return r; } return null; }) }));
vi.mock('../src/store/ui', () => ({ toast: (m: string) => toasts.push(m) }));
vi.mock('../src/store/core', () => ({ useCore: { getState: () => ({}), subscribe: () => () => undefined } }));

const { takeSharedImports, widgetSnapshot } = await import('../src/mobile/native');

describe('和 iOS 扩展交换数据（J3、J7）', () => {
  beforeEach(() => { calls.length = 0; toasts.length = 0; });
  it('取走分享的网址逐条导入，单篇失败不影响别的', async () => {
    pending = [{ url: 'https://bad.example/a' }, { url: 'https://go.dev/blog/go1.21' }];
    await takeSharedImports();
    expect(calls).toEqual([
      { source: { type: 'url', url: 'https://bad.example/a' }, origin: 'deeplink' },
      { source: { type: 'url', url: 'https://go.dev/blog/go1.21' }, origin: 'deeplink' },
    ]);
    expect(toasts).toHaveLength(1);
  });
  it('收件箱空时不导入也不提示', async () => {
    await takeSharedImports();
    expect(calls).toHaveLength(0); expect(toasts).toHaveLength(0);
  });
  it('小组件快照：继续读的取读了一部分的那篇', () => {
    const docs = [{ title: '读完的', progress: 1 }, { title: '没开始', progress: 0 }, { title: 'Go 1.21', progress: 0.4 }] as never;
    expect(widgetSnapshot({ due: 3, streak: 5, todayMinutes: 12, goal: 20, recentDocs: docs })).toEqual({ due: 3, streak: 5, todayMinutes: 12, goal: 20, readingTitle: 'Go 1.21', readingProgress: 0.4 });
    expect(widgetSnapshot({ due: 0, streak: 0, todayMinutes: 0, goal: 20, recentDocs: [] }).readingTitle).toBeNull();
  });
});
