import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import '../lib/i18n';
import { MobileApp } from './MobileApp';
import './mobile.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <MobileApp />
    </HashRouter>
  </React.StrictMode>,
);
