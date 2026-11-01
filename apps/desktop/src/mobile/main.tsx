import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import '../lib/i18n';
import { MobileApp } from './MobileApp';
import './mobile.css';
import { isTauri } from '../rpc';

// 在 Tauri 里打开手机壳 = 手机端（或桌面上的 mobile-preview）：Core 跑在这个 WebView 里，不连 sidecar
if (isTauri()) (window as { __TIBI_LOCAL_CORE__?: boolean }).__TIBI_LOCAL_CORE__ = true;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <MobileApp />
    </HashRouter>
  </React.StrictMode>,
);
