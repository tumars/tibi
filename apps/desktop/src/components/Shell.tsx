import { BarChart3, BookOpen, Bookmark, Home as HomeIcon, ListChecks, Moon, PanelLeft, RotateCw, Search, Settings as SettingsIcon, Sun } from 'lucide-react';
import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { isTauri } from '../rpc';
import { useCore } from '../store/core';
import { useUi } from '../store/ui';

const NAV = [
  { to: '/', label: '首页', icon: HomeIcon },
  { to: '/library', label: '书架', icon: BookOpen },
  { to: '/words', label: '生词本', icon: Bookmark },
  { to: '/review', label: '复习', icon: RotateCw, badge: true },
  { to: '/stats', label: '统计', icon: BarChart3 },
  { to: '/tasks', label: '任务', icon: ListChecks },
];

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export function Shell() {
  const collapsed = useUi(s => s.collapsed); const toggleSide = useUi(s => s.toggleSide);
  const theme = useUi(s => s.theme); const setTheme = useUi(s => s.setTheme);
  const status = useCore(s => s.status); const due = useCore(s => s.due); const connected = useCore(s => s.connected);
  const loc = useLocation();
  const reading = loc.pathname.startsWith('/read/');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); toggleSide(); } };
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey);
  }, [toggleSide]);

  const dark = document.documentElement.dataset.theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const minutes = 0; const goal = 20;
  const ring = 87.96 * (1 - Math.min(1, minutes / goal));

  return (
    <div className={`app${collapsed ? ' collapsed' : ''}${isMac && isTauri() ? ' mac' : ''}`} data-tauri-drag-region>
      <aside className="side">
        <div className="brand">
          <span className="logo"><img src="/logo.svg" alt="" /><span className="hide-c">Tibi</span></span>
          <button className="ibtn hide-c" onClick={toggleSide} title="折叠侧栏（⌘\\）"><PanelLeft /></button>
        </div>
        <button className="nav-search" style={{ display: 'flex', alignItems: 'center', gap: 10, height: 32, padding: '0 10px', borderRadius: 8, color: 'var(--ink-2)' }} title="搜索（M1 后）"><Search size={17} /><span className="hide-c">搜索</span><span className="kbd hide-c" style={{ marginLeft: 'auto' }}>⌘K</span></button>
        <nav className="nav">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive || (n.to === '/library' && reading) ? 'cur' : '')} title={n.label}>
              <n.icon /><span className="hide-c">{n.label}</span>
              {n.badge && due > 0 && <span className="n hide-c">{due}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidefoot">
          <div className="streak" title={`今日 ${minutes} / ${goal} 分钟`}>
            <svg className="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" fill="none" stroke="var(--line-2)" strokeWidth="4" /><circle cx="18" cy="18" r="14" fill="none" stroke="var(--warm)" strokeWidth="4" strokeLinecap="round" strokeDasharray="87.96" strokeDashoffset={ring} transform="rotate(-90 18 18)" /></svg>
            <div className="hide-c"><div className="t">{connected ? '今天开始' : 'Core 未连接'}</div><div className="s">{connected ? `今日 ${minutes} / ${goal} 分钟` : '界面只显示空状态'}</div></div>
          </div>
          <div className="user">
            <span className="av">你</span>
            <span className="hide-c lbl" style={{ flex: 1 }}>{status?.version ? `v${status.version}` : ''}</span>
            <button className="ibtn hide-c" title={dark ? '切换到浅色' : '切换到深色'} onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? <Sun /> : <Moon />}</button>
            <NavLink to="/settings" className="ibtn hide-c" title="设置"><SettingsIcon /></NavLink>
          </div>
        </div>
      </aside>
      <section className="main">
        <Outlet />
      </section>
    </div>
  );
}

/** 顶栏：面包屑 + 右侧动作 */
export function Top({ crumbs, right }: { crumbs: { label: string; to?: string }[]; right?: React.ReactNode }) {
  return (
    <header className="top" data-tauri-drag-region>
      <span className="crumb">
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: 'contents' }}>
            {i > 0 && <span>/</span>}
            {c.to ? <NavLink to={c.to}>{c.label}</NavLink> : <b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420 }}>{c.label}</b>}
          </span>
        ))}
      </span>
      <span className="sp" />
      {right}
    </header>
  );
}
