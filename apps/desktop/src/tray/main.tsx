import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import '../components/dict.css';
import './tray.css';
import { TrayApp } from './TrayApp';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TrayApp />
  </React.StrictMode>,
);
