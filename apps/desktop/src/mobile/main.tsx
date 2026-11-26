import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { startUsageAnalytics } from '../lib/analytics';
import '../lib/i18n';
import './mobile.css';

// 在 Tauri 里打开手机壳 = 手机端（或桌面上的 mobile-preview）：Core 跑在这个 WebView 里，不连 sidecar。
// 必须在加载任何会初始化 RPC 的组件之前打标（与 web/main.tsx 保持一致）。
if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
  (window as { __TIBI_LOCAL_CORE__?: boolean }).__TIBI_LOCAL_CORE__ = true;
}

void import('./MobileApp').then(({ MobileApp }) => {
  startUsageAnalytics();
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <HashRouter>
        <MobileApp />
      </HashRouter>
    </React.StrictMode>,
  );
});
