import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { startNoticeCheck } from '../src/lib/notice';

vi.mock('../src/rpc', async original => ({ ...await original<object>(), isTauri: () => true }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.0' }));
let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.mocked(fetch).mockReset();
});
afterEach(() => { stop?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('公告分发源', () => {
  it('从腾讯云读取并显示公告', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ notices: [{ id: 'cloud', message: '新公告' }] })));
    const show = vi.fn();
    stop = startNoticeCheck(show);
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.dynamicImportSettled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://dl.ferecord.com/notice.json', expect.objectContaining({ cache: 'no-store' }));
    expect(show.mock.calls[0]?.[0]).toMatchObject({ id: 'cloud', text: '新公告' });
  });

  it('腾讯云失败时不回退 GitHub，也不显示错误公告', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 503 }));
    const show = vi.fn();
    stop = startNoticeCheck(show);
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.dynamicImportSettled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
  });
});
