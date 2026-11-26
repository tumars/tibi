import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router';
import { Shell } from './components/Shell';
import { Toasts } from './components/Toasts';
import { Chat } from './pages/Chat';
import { Dict } from './pages/Dict';
import { Feeds, FeedsManage } from './pages/Feeds';
import { Radio, RadioManage } from './pages/Radio';
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
import { trackUsage } from './lib/analytics';
import { lang, tl } from './lib/i18n';
import { startDesktopReminder, type ReminderTime } from './lib/reminder';
import { autoCheckOn, detectJustUpdated, isAppStore } from './lib/update';
import { presentNotice, startNoticeCheck } from './lib/notice';
import { startUpdatePolling, useUpdate } from './store/update';
import { installMacNative, isMacDesktop } from './lib/macNative';
import { openDeepLink } from './lib/deeplink';
import { listenSafe } from './lib/tauriEvents';
import { syncTtsFromSettings } from './lib/ttsConfig';
import { DEFAULT_TRAY_HOTKEY } from './tray/classify';

export function App() {
  const nav = useNavigate();
  const modelAsked = useRef(false);
  // 菜单栏只装一次，导航函数随路由变，所以经 ref 取最新的
  const navRef = useRef(nav); navRef.current = nav;
  useEffect(() => installMacNative(
    to => navRef.current(to),
    () => {
      const u = useUpdate.getState();
      if (u.phase === 'available' || u.phase === 'downloading' || u.phase === 'ready' || u.phase === 'backup_failed') u.openModal();
      else void u.check({ manual: true, openModal: true });
    },
  ), []);
  // 托盘菜单待复习数、文案语言与设置同步
  const due = useCore(s => s.due);
  useEffect(() => {
    if (!isTauri()) return;
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke('tray_update_summary', { due, lang })).catch(() => undefined);
  }, [due]);
  useEffect(() => {
    if (!isTauri()) return;
    const syncTraySettings = () => {
      void rpc.call('settings.get', { keys: ['tray.keep_running', 'tray.hotkey'] }).then(async s => {
        const { invoke } = await import('@tauri-apps/api/core');
        const keep = typeof s['tray.keep_running'] === 'boolean' ? s['tray.keep_running'] : isMacDesktop;
        await invoke('window_set_tray_mode', { keepRunning: keep }).catch(() => undefined);
        if (isMacDesktop) {
          const preset = typeof s['tray.hotkey'] === 'string' ? s['tray.hotkey'] : DEFAULT_TRAY_HOTKEY;
          await invoke('tray_set_hotkey', { preset }).catch(() => undefined);
        }
      }, () => undefined);
    };
    syncTraySettings();
    const offSettings = rpc.on('data.changed', d => { if (d.table === 'settings') syncTraySettings(); });
    const offNav = listenSafe<{ route?: string | null; ask?: string | null }>('tray_navigate', async payload => {
      const { route, ask } = payload ?? {};
      if (ask) {
        try {
          const c = await rpc.call('chat.open', {});
          navRef.current(`/chat/${c.id}?q=${encodeURIComponent(ask)}`);
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), { kind: 'err' });
        }
        return;
      }
      if (route === '__update__') {
        const u = useUpdate.getState();
        if (u.phase === 'available' || u.phase === 'downloading' || u.phase === 'ready' || u.phase === 'backup_failed') u.openModal();
        else void u.check({ manual: true, openModal: true });
        return;
      }
      if (route) navRef.current(route);
    });
    return () => { offSettings(); offNav(); };
  }, []);
  // 每日提醒（J8）：应用开着（含托盘里）时到点提醒
  useEffect(() => {
    let time: ReminderTime = 'off';
    const load = () => rpc.call('settings.get', { keys: ['reminder.time'] }).then(r => { time = (r['reminder.time'] as ReminderTime) ?? 'off'; }, () => undefined);
    void load(); const off = rpc.on('data.changed', d => { if (d.table === 'settings') void load(); });
    const stop = startDesktopReminder(() => ({ time, due: useCore.getState().due }));
    return () => { off(); stop(); };
  }, []);
  // 软件更新（T31）：默认后台静默下载，下完在侧栏/菜单栏/托盘提示重启以更新；不强制重启。公告跟着同一个开关并自动去重
  useEffect(() => startUpdatePolling(), []);
  useEffect(() => startNoticeCheck(presentNotice, autoCheckOn, () => useUpdate.getState().version), []);
  // 刚完成升级重启进入新版本：弹一条轻提示并允许查看更新说明
  useEffect(() => {
    if (!isTauri() || isAppStore) return;
    void import('@tauri-apps/api/app')
      .then(a => a.getVersion())
      .then(v => {
        const info = detectJustUpdated(v);
        if (!info) return;
        toast(tl('已更新到 Tibi {v0}', { v0: info.version }), {
          ms: 10_000,
          ...(info.notes ? { action: { label: tl('查看更新内容'), run: () => useUpdate.getState().openWhatsNew(info.version, info.notes) } } : {}),
        });
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    bindCoreEvents();
    // 朗读设置（tts.*）与本地离线转写设置（radio.local_asr.*）
    const loadLocalAsr = () => void import('./lib/localAsr').then(m => m.hydrateLocalAsrConfig(true)).catch(() => undefined);
    void syncTtsFromSettings();
    loadLocalAsr();
    // Tibi 或别的设备改了语速 / 设置，马上生效
    const offTts = rpc.on('data.changed', d => { if (d.table === 'settings') { void syncTtsFromSettings(); loadLocalAsr(); } });
    // 第一次打开（没走过引导、书架是空的）进首次启动引导，其中有连接模型一步；已有文章的老库直接记为走过（00 §3.9）
    void useCore.getState().refresh().then(async () => {
      const st = useCore.getState(); if (!st.connected) return;
      const s = await rpc.call('settings.get', { keys: [ONBOARDING_KEY] }).catch(() => ({} as Record<string, unknown>));
      // 走过引导但还没连模型：每次打开先问一次（可以"先不连"）；只在首页问，不打断深链和刷新
      const first = !modelAsked.current; modelAsked.current = true;
      const askModel = () => { if (first && !st.status?.models.ok && /^#?\/?$/.test(location.hash)) navRef.current('/welcome?step=3&from=home', { replace: true }); };
      if (s[ONBOARDING_KEY]) { askModel(); return; }
      if (st.docCount > 0) { void rpc.call('settings.set', { patch: { [ONBOARDING_KEY]: true } }); askModel(); return; }
      if (!location.hash.startsWith('#/welcome') && !location.hash.includes('import=')) navRef.current('/welcome', { replace: true });
    });
    const offDone = rpc.on('import.done', r => {
      if (r.ok && r.document_id && !r.duplicate) trackUsage('import_succeeded');
      // 对话里起的导入：进度和结果在对话的导入卡上，这里不提示
      if (r.origin === 'chat') return;
      // 导入失败：错误在发起的地方显示（首页进度条）；这里只提示成功
      if (!r.ok) { if (r.origin !== 'mcp' && !location.hash.startsWith('#/welcome')) toast(r.error || tl('导入失败'), { kind: 'err' }); return; }
      // 已经打开了这篇（如点示例后自动跳进阅读器）就不再提示"开始阅读"
      if (r.document_id) setTimeout(() => { if (!location.hash.includes(`/read/${r.document_id}`) && !location.hash.startsWith('#/welcome')) toast(r.summary || tl('导入完成'), { action: { label: tl('开始阅读'), run: () => navRef.current(`/read/${r.document_id}`) } }); }, 80);
    });
    // 深链（Rust 发 deep_link 事件；冷启动时可能早于 WebView 监听，补拉一次待消费队列）：tibi://import?url=… 确认后导入；其余 tibi:// 按白名单跳转
    const handleDeep = (payload: { action: string; url: string }) => {
      if (payload.action === 'import') navRef.current(`/?import=${encodeURIComponent(payload.url)}`);
      else if (payload.action === 'open') openDeepLink(payload.url);
    };
    const offDeep = listenSafe<{ action: string; url: string }>('deep_link', handleDeep, () => {
      void import('@tauri-apps/api/core')
        .then(c => c.invoke<{ action: string; url: string }[]>('take_pending_deep_links'))
        .then(list => { for (const p of list) handleDeep(p); })
        .catch(() => undefined);
    });
    const onUnload = () => {
      if (isTauri()) void import('@tauri-apps/api/core').then(c => c.invoke('reset_deep_link_ready')).catch(() => undefined);
    };
    window.addEventListener('beforeunload', onUnload);
    return () => { offTts(); offDone(); offDeep(); window.removeEventListener('beforeunload', onUnload); };
  }, []);

  return (
    <>
      <Routes>
        <Route path="welcome" element={<Onboarding />} />
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="library" element={<Library />} />
          <Route path="feeds" element={<Feeds />} />
          <Route path="feeds/manage" element={<FeedsManage />} />
          <Route path="radio" element={<Radio />} />
          <Route path="radio/manage" element={<RadioManage />} />
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
