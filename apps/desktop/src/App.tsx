import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router';
import { Shell } from './components/Shell';
import { Toasts } from './components/Toasts';
import { Chat } from './pages/Chat';
import { Home } from './pages/Home';
import { Library } from './pages/Library';
import { Onboarding, ONBOARDING_KEY } from './pages/Onboarding';
import { Placeholder } from './pages/Placeholder';
import { Reader } from './pages/Reader';
import { Review } from './pages/Review';
import { Settings } from './pages/Settings';
import { Words } from './pages/Words';
import { isTauri, rpc } from './rpc';
import { bindCoreEvents, useCore } from './store/core';
import { toast } from './store/ui';

export function App() {
  const nav = useNavigate();
  useEffect(() => {
    bindCoreEvents();
    // 第一次打开（没走过引导、书架是空的）进首次启动引导；已有文章的老库直接记为走过（00 §3.9）
    void useCore.getState().refresh().then(async () => {
      const st = useCore.getState(); if (!st.connected) return;
      const s = await rpc.call('settings.get', { keys: [ONBOARDING_KEY] }).catch(() => ({} as Record<string, unknown>));
      if (s[ONBOARDING_KEY]) return;
      if (st.docCount > 0) { void rpc.call('settings.set', { patch: { [ONBOARDING_KEY]: true } }); return; }
      if (!location.hash.startsWith('#/welcome')) nav('/welcome', { replace: true });
    });
    const offDone = rpc.on('task.done', d => {
      const r = d.result;
      if (d.task.trigger === 'auto') return;   // 后台自动的任务（补做总结等）不打扰
      // 已经打开了这篇（如点示例后自动跳进阅读器）就不再提示"开始阅读"
      if (r?.document_id) setTimeout(() => { if (!location.hash.includes(`/read/${r.document_id}`) && !location.hash.startsWith('#/welcome')) toast(r.summary || '导入完成', { action: { label: '开始阅读', run: () => nav(`/read/${r.document_id}`) } }); }, 80);
      else if (r?.summary) toast(r.summary);
    });
    // 深链：tibi://import?url=…（Rust 发 deep_link 事件）→ 确认后导入
    let offDeep: (() => void) | undefined;
    if (isTauri()) {
      void import('@tauri-apps/api/event').then(({ listen }) => listen<{ action: string; url: string }>('deep_link', e => {
        if (e.payload.action === 'import') nav(`/?import=${encodeURIComponent(e.payload.url)}`);
      })).then(off => { offDeep = off; });
    }
    return () => { offDone(); offDeep?.(); };
  }, [nav]);

  return (
    <>
      <Routes>
        <Route path="welcome" element={<Onboarding />} />
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="library" element={<Library />} />
          <Route path="chat/:id" element={<Chat />} />
          <Route path="read/:id" element={<Reader />} />
          <Route path="read/:id/:section" element={<Reader />} />
          <Route path="words" element={<Words />} />
          <Route path="review" element={<Review />} />
          <Route path="stats" element={<Placeholder title="统计" text="M3 起提供。" />} />
          <Route path="tasks" element={<Placeholder title="任务" text="M2 起提供。" />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toasts />
    </>
  );
}
