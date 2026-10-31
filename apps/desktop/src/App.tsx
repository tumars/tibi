import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router';
import { Shell } from './components/Shell';
import { Toasts } from './components/Toasts';
import { Home } from './pages/Home';
import { Library } from './pages/Library';
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
    void useCore.getState().refresh();
    const offDone = rpc.on('task.done', d => {
      const r = d.result;
      // 已经打开了这篇（如点示例后自动跳进阅读器）就不再提示"开始阅读"
      if (r?.document_id) setTimeout(() => { if (!location.hash.includes(`/read/${r.document_id}`)) toast(r.summary || '导入完成', { action: { label: '开始阅读', run: () => nav(`/read/${r.document_id}`) } }); }, 80);
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
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="library" element={<Library />} />
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
