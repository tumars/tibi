import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router';
import { Shell } from './components/Shell';
import { Toasts } from './components/Toasts';
import { Chat } from './pages/Chat';
import { Dict } from './pages/Dict';
import { Feeds, FeedsManage } from './pages/Feeds';
import { Home } from './pages/Home';
import { Library } from './pages/Library';
import { Onboarding, ONBOARDING_KEY } from './pages/Onboarding';
import { Reader } from './pages/Reader';
import { Review } from './pages/Review';
import { Settings } from './pages/Settings';
import { Stats } from './pages/Stats';
import { Words } from './pages/Words';
import { isTauri, rpc } from './rpc';
import { bindCoreEvents, useCore } from './store/core';
import { toast } from './store/ui';
import { tl } from './lib/i18n';
import { startDesktopReminder, type ReminderTime } from './lib/reminder';
import { autoCheckOn, startAutoUpdateCheck } from './lib/update';
import { presentNotice, startNoticeCheck } from './lib/notice';
import { installMacNative } from './lib/macNative';
import { openDeepLink } from './lib/deeplink';

export function App() {
  const nav = useNavigate();
  const modelAsked = useRef(false);
  // 菜单栏只装一次，导航函数随路由变，所以经 ref 取最新的
  const navRef = useRef(nav); navRef.current = nav;
  useEffect(() => installMacNative(to => navRef.current(to)), []);
  // 每日提醒（J8）：应用开着（含托盘里）时到点提醒
  useEffect(() => {
    let time: ReminderTime = 'off';
    const load = () => rpc.call('settings.get', { keys: ['reminder.time'] }).then(r => { time = (r['reminder.time'] as ReminderTime) ?? 'off'; }, () => undefined);
    void load(); const off = rpc.on('data.changed', d => { if (d.table === 'settings') void load(); });
    const stop = startDesktopReminder(() => ({ time, due: useCore.getState().due }));
    return () => { off(); stop(); };
  }, []);
  // 软件更新（T31）：自动检查默认开，关掉就不联网；只提醒，装不装用户定。公告跟着同一个开关
  useEffect(() => startAutoUpdateCheck(v => toast(tl('Tibi {v0} 可以更新了', { v0: v }), { ms: 15_000, action: { label: tl('去看看'), run: () => nav('/settings?sec=about&item=检查更新') } })), [nav]);
  useEffect(() => startNoticeCheck(presentNotice, autoCheckOn), []);
  useEffect(() => {
    bindCoreEvents();
    // 朗读设置（tts.*）
    const loadTts = () => void rpc.call('settings.get', { keys: ['tts.engine', 'tts.voice', 'tts.ai_voice', 'tts.rate'] }).then(s => void import('./lib/tts').then(t => t.configure({ engine: (s['tts.engine'] as 'system' | 'kokoro') ?? 'system', voice: (s['tts.voice'] as string) ?? '', aiVoice: (s['tts.ai_voice'] as string) || undefined, rate: Number(s['tts.rate'] ?? 1) || 1 })), () => undefined);
    loadTts();
    // Tibi 或别的设备改了语速，马上生效
    const offTts = rpc.on('data.changed', d => { if (d.table === 'settings') loadTts(); });
    // 第一次打开（没走过引导、书架是空的）进首次启动引导，其中有连接模型一步；已有文章的老库直接记为走过（00 §3.9）
    void useCore.getState().refresh().then(async () => {
      const st = useCore.getState(); if (!st.connected) return;
      const s = await rpc.call('settings.get', { keys: [ONBOARDING_KEY] }).catch(() => ({} as Record<string, unknown>));
      // 走过引导但还没连模型：每次打开先问一次（可以"先不连"）；只在首页问，不打断深链和刷新。nav 随路由变，这段会重跑，所以记一下问过没有
      const first = !modelAsked.current; modelAsked.current = true;
      const askModel = () => { if (first && !st.status?.models.ok && /^#?\/?$/.test(location.hash)) nav('/welcome?step=3&from=home', { replace: true }); };
      if (s[ONBOARDING_KEY]) { askModel(); return; }
      if (st.docCount > 0) { void rpc.call('settings.set', { patch: { [ONBOARDING_KEY]: true } }); askModel(); return; }
      if (!location.hash.startsWith('#/welcome')) nav('/welcome', { replace: true });
    });
    const offDone = rpc.on('import.done', r => {
      // 对话里起的导入：进度和结果在对话的导入卡上，这里不提示
      if (r.origin === 'chat') return;
      // 导入失败：错误在发起的地方显示（首页进度条）；这里只提示成功
      if (!r.ok) { if (r.origin !== 'mcp' && !location.hash.startsWith('#/welcome')) toast(r.error || tl('导入失败'), { kind: 'err' }); return; }
      // 已经打开了这篇（如点示例后自动跳进阅读器）就不再提示"开始阅读"
      if (r.document_id) setTimeout(() => { if (!location.hash.includes(`/read/${r.document_id}`) && !location.hash.startsWith('#/welcome')) toast(r.summary || tl('导入完成'), { action: { label: tl('开始阅读'), run: () => nav(`/read/${r.document_id}`) } }); }, 80);
    });
    // 深链（Rust 发 deep_link 事件）：tibi://import?url=… 确认后导入；其余 tibi:// 和对话卡片上的按钮一样跳转
    let offDeep: (() => void) | undefined;
    if (isTauri()) {
      void import('@tauri-apps/api/event').then(({ listen }) => listen<{ action: string; url: string }>('deep_link', e => {
        if (e.payload.action === 'import') nav(`/?import=${encodeURIComponent(e.payload.url)}`);
        else if (e.payload.action === 'open') openDeepLink(e.payload.url);
      })).then(off => { offDeep = off; });
    }
    return () => { offTts(); offDone(); offDeep?.(); };
  }, [nav]);

  return (
    <>
      <Routes>
        <Route path="welcome" element={<Onboarding />} />
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="library" element={<Library />} />
          <Route path="feeds" element={<Feeds />} />
          <Route path="feeds/manage" element={<FeedsManage />} />
          <Route path="chat/:id" element={<Chat />} />
          <Route path="read/:id" element={<Reader />} />
          <Route path="read/:id/:section" element={<Reader />} />
          <Route path="words" element={<Words />} />
          <Route path="dict" element={<Dict />} />
          <Route path="review" element={<Review />} />
          <Route path="stats" element={<Stats />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toasts />
    </>
  );
}
