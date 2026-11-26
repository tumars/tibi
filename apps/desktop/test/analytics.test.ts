import type { Config } from 'mixpanel-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  track: vi.fn(),
  optIn: vi.fn(),
  optOut: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('mixpanel-browser/src/loaders/loader-module-core.js', () => ({ default: { init: sdk.init } }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }));

const consentKey = 'tibi.analytics.v1';
const location = { hostname: '127.0.0.1', protocol: 'http:', search: '?analytics-test=1' };
let view: EventTarget;
let page: EventTarget & { visibilityState: string };
let navigator: { doNotTrack?: string; globalPrivacyControl?: boolean };
let storage: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('DEV', true);
  vi.stubEnv('PROD', false);
  Object.assign(location, { hostname: '127.0.0.1', protocol: 'http:', search: '?analytics-test=1' });
  view = Object.assign(new EventTarget(), { location });
  page = Object.assign(new EventTarget(), { visibilityState: 'visible', documentElement: { lang: 'en' } });
  navigator = {};
  storage = new Map();
  vi.stubGlobal('window', view);
  vi.stubGlobal('location', location);
  vi.stubGlobal('document', page);
  vi.stubGlobal('navigator', navigator);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  sdk.init.mockReturnValue({ track: sdk.track, opt_in_tracking: sdk.optIn, opt_out_tracking: sdk.optOut, reset: sdk.reset });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('可选使用统计', () => {
  it('默认关闭且不初始化 SDK', async () => {
    const { startUsageAnalytics, trackUsage } = await import('../src/lib/analytics');
    startUsageAnalytics();
    expect(trackUsage('reader_opened')).toBe(false);
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it.each([{ doNotTrack: '1' }, { globalPrivacyControl: true }])('浏览器隐私信号优先于已保存的同意 %j', async signal => {
    Object.assign(navigator, signal);
    storage.set(consentKey, 'allow');
    const { setUsageAnalytics, startUsageAnalytics, trackUsage } = await import('../src/lib/analytics');
    startUsageAnalytics();
    expect(setUsageAnalytics(true)).toBe(false);
    expect(trackUsage('reader_opened')).toBe(false);
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it('正式打包的预览域名不能用验收参数发送', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    Object.assign(location, { hostname: 'preview.example.test', protocol: 'https:' });
    storage.set(consentKey, 'allow');
    const { trackUsage } = await import('../src/lib/analytics');
    expect(trackUsage('reader_opened')).toBe(false);
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it('上报固定属性并在进入离线队列前去除 SDK 丰富字段', async () => {
    const { setUsageAnalytics, trackUsage } = await import('../src/lib/analytics');
    setUsageAnalytics(true);
    trackUsage('word_lookup_used', 'dictionary');
    await vi.dynamicImportSettled();
    expect(sdk.track.mock.calls.map(([event]) => event)).toEqual(['app_opened', 'word_lookup_used']);
    expect(sdk.track).toHaveBeenLastCalledWith('word_lookup_used', expect.objectContaining({
      product: 'tibi', site: 'app', platform: 'web', environment: 'development',
      locale: 'en', schema_version: 2, lookup_surface: 'dictionary', $mp_raw_user_agent: 'Tibi',
    }));
    const config = sdk.init.mock.calls[0]![1] as Partial<Config>;
    expect(config.hooks?.on_track?.('word_lookup_used', {
      distinct_id: 'random-id', lookup_surface: 'dictionary', $current_url: 'https://example.test/private', $referrer: 'private',
    })).toEqual(['word_lookup_used', { distinct_id: 'random-id', lookup_surface: 'dictionary' }]);
    expect(sdk.optIn).toHaveBeenCalledTimes(1);
  });

  it('撤回使加载中的事件失效，重新开启只发送新的打开事件', async () => {
    const { setUsageAnalytics, trackUsage } = await import('../src/lib/analytics');
    setUsageAnalytics(true);
    trackUsage('reader_opened');
    setUsageAnalytics(false);
    setUsageAnalytics(true);
    await vi.dynamicImportSettled();
    expect(sdk.track.mock.calls.map(([event]) => event)).toEqual(['app_opened']);
  });

  it('同步同源窗口的撤回，停止 SDK 并清除随机标识', async () => {
    const { startUsageAnalytics, trackUsage } = await import('../src/lib/analytics');
    storage.set(consentKey, 'allow');
    startUsageAnalytics();
    await vi.dynamicImportSettled();

    storage.set('mp_tibi_usage', 'previous-id');
    storage.set(consentKey, 'deny');
    view.dispatchEvent(Object.assign(new Event('storage'), { key: consentKey }));
    expect(sdk.optOut).toHaveBeenCalledWith({ delete_user: false });
    expect(sdk.reset).toHaveBeenCalledTimes(1);
    expect(storage.has('mp_tibi_usage')).toBe(false);
    expect(trackUsage('reader_opened')).toBe(false);
  });

  it('主界面前台去重，后台停留满 30 分钟后打开可再计一次', async () => {
    const { startUsageAnalytics } = await import('../src/lib/analytics');
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const visibility = (state: string) => {
      page.visibilityState = state;
      page.dispatchEvent(new Event('visibilitychange'));
    };
    storage.set(consentKey, 'allow');
    startUsageAnalytics();
    startUsageAnalytics();
    visibility('hidden');
    now.mockReturnValue(2_000);
    visibility('visible');
    visibility('hidden');
    now.mockReturnValue(2_000 + 30 * 60 * 1000);
    visibility('visible');
    await vi.dynamicImportSettled();
    expect(sdk.track.mock.calls.map(([event]) => event)).toEqual(['app_opened', 'app_opened']);
  });
});
