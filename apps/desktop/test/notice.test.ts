import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { currentPlatform, olderThan, parseNotices, pickNotices, type NoticeCtx } from '../src/lib/notice';

const ctx = (o: Partial<NoticeCtx> = {}): NoticeCtx => ({ version: '0.1.0', platform: 'macos', today: '2026-11-04', seen: {}, ...o });

describe('公告', () => {
  it('仓库里的 notice.json 格式正确', () => {
    const raw = JSON.parse(readFileSync(new URL('../../../notice.json', import.meta.url), 'utf8'));
    expect(() => parseNotices(raw)).not.toThrow();
  });

  it('写错的条目整个文件不用', () => {
    expect(() => parseNotices({})).toThrow();
    expect(() => parseNotices({ notices: [{ id: 'a' }] })).toThrow(/message/);
    expect(() => parseNotices({ notices: [{ id: 'a', message: 'x' }, { id: 'a', message: 'y' }] })).toThrow(/重复/);
    expect(() => parseNotices({ notices: [{ id: 'a', message: 'x', platforms: ['mac'] }] })).toThrow(/platforms/);
    expect(() => parseNotices({ notices: [{ id: 'a', message: 'x', below: 'v0.2' }] })).toThrow(/below/);
    expect(() => parseNotices({ notices: [{ id: 'a', message: 'x', url: 'http://a.com' }] })).toThrow(/url/);
    expect(parseNotices({ notices: [{ id: 'a', message: { zh: '你好', en: 'Hi' }, url: 'tibi://settings' }] })).toHaveLength(1);
  });

  it('比较版本号', () => {
    expect(olderThan('0.1.0', '0.2.0')).toBe(true);
    expect(olderThan('0.10.0', '0.9.0')).toBe(false);
    expect(olderThan('0.2.0', '0.2')).toBe(false);
    expect(olderThan('0.2.0-beta', '0.2.0')).toBe(false);
    expect(olderThan('1.0.0', '1.0.1')).toBe(true);
  });

  it('一般的公告只提醒一次', () => {
    const list = parseNotices({ notices: [{ id: 'hi', message: '你好' }] });
    expect(pickNotices(list, ctx())).toEqual([{ id: 'hi', text: '你好', urgent: false, url: undefined, label: undefined }]);
    expect(pickNotices(list, ctx({ seen: { hi: '2026-10-01' } }))).toEqual([]);
  });

  it('催升级的只给旧版本，每天提醒一次', () => {
    const list = parseNotices({ notices: [{ id: 'up', message: '该升级了', below: '0.2.0', url: 'https://dl.ferecord.com/latest/', label: '去下载' }] });
    expect(pickNotices(list, ctx())[0]).toMatchObject({ urgent: true, label: '去下载' });
    expect(pickNotices(list, ctx({ seen: { up: '2026-11-04' } }))).toEqual([]);
    expect(pickNotices(list, ctx({ seen: { up: '2026-11-03' } }))).toHaveLength(1);
    expect(pickNotices(list, ctx({ version: '0.2.0' }))).toEqual([]);
  });

  it('按平台和截止日期过滤', () => {
    const list = parseNotices({ notices: [{ id: 'a', message: 'x', platforms: ['android'] }, { id: 'b', message: 'y', until: '2026-11-03' }] });
    expect(pickNotices(list, ctx())).toEqual([]);
    expect(pickNotices(list, ctx({ platform: 'android', today: '2026-11-03' })).map(n => n.id)).toEqual(['a', 'b']);
  });

  it('从 UA 认出平台', () => {
    expect(currentPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macos');
    expect(currentPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(currentPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
    expect(currentPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
    expect(currentPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
  });
});
