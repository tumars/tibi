import { BarChart3, BookA, BookOpen, Bookmark, Home as HomeIcon, Moon, PanelLeft, RotateCw, Rss, Search, Settings as SettingsIcon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { OutsideApprovals } from './OutsideApprovals';
import { useCore } from '../store/core';
import { SIDE_W, useUi } from '../store/ui';
import { tl } from '../lib/i18n';
import { isMacDesktop } from '../lib/macNative';
import { RecentChats } from './RecentChats';
import { ResizeHandle } from './ResizeHandle';
import { SearchPalette } from './SearchPalette';

const NAV = [
  { to: '/', label: tl('首页'), icon: HomeIcon },
  { to: '/library', label: tl('书架'), icon: BookOpen, count: 'docCount' as const },
  { to: '/feeds', label: tl('订阅'), icon: Rss, count: 'feedUnread' as const },
  { to: '/words', label: tl('生词本'), icon: Bookmark, count: 'wordCount' as const },
  { to: '/dict', label: tl('词典'), icon: BookA },
  { to: '/review', label: tl('复习'), icon: RotateCw, badge: true },
  { to: '/stats', label: tl('统计'), icon: BarChart3 },
];

export function Shell() {
  const collapsed = useUi(s => s.collapsed); const toggleSide = useUi(s => s.toggleSide);
  const sideWidth = useUi(s => s.sideWidth); const setSideWidth = useUi(s => s.setSideWidth);
  const [resizing, setResizing] = useState(false);
  const due = useCore(s => s.due); const connected = useCore(s => s.connected);
  const counts = { docCount: useCore(s => s.docCount), wordCount: useCore(s => s.wordCount), feedUnread: useCore(s => s.feedUnread) };
  const goal = useCore(s => s.goal); const minutes = useCore(s => s.todayMinutes); const streak = useCore(s => s.streak);
  const loc = useLocation();
  const reading = loc.pathname.startsWith('/read/');
  const readingShelved = useUi(s => s.readingShelved);

  useEffect(() => {
    if (isMacDesktop) return;   // mac 上这个快捷键归菜单栏（lib/macNative）
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); toggleSide(); } };
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey);
  }, [toggleSide]);

  const ring = 87.96 * (1 - Math.min(1, minutes / goal));

  return (
    <div className={`app${collapsed ? ' collapsed' : ''}${isMacDesktop ? ' mac' : ''}${resizing ? ' resizing' : ''}`} style={collapsed ? undefined : { '--side': `${sideWidth}px` } as React.CSSProperties} data-tauri-drag-region>
      <aside className="side" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region="deep">
          <span className="logo"><img src="/logo.svg" alt="" /><span className="hide-c">Tibi</span></span>
          <span className="brand-acts">
            <button className="ibtn" title={tl('搜索（⌘K）')} onClick={() => window.dispatchEvent(new Event('tibi:search'))}><Search /></button>
            <button className="ibtn side-toggle" onClick={toggleSide} title={collapsed ? tl('展开侧栏（⌘\\）') : tl('折叠侧栏（⌘\\）')}><PanelLeft /></button>
          </span>
        </div>
        <nav className="nav">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive || (n.to === (readingShelved ? '/library' : '/feeds') && reading) ? 'cur' : '')} title={n.label}>
              <n.icon /><span className="hide-c">{n.label}</span>
              {n.badge && due > 0 && <span className="n badge hide-c">{due}</span>}
              {/* 订阅的未读是源推来的，数字只会越攒越大，侧栏只给一个点 */}
              {'count' in n && n.count && counts[n.count] > 0 && (n.count === 'feedUnread'
                ? <span className="dot hide-c" title={tl('{n} 篇未读', { n: counts[n.count] })} />
                : <span className="n hide-c">{counts[n.count]}</span>)}
            </NavLink>
          ))}
        </nav>
        <div className="sideh hide-c">{tl('最近')}</div>
        <RecentChats />
        <div className="sidefoot">
          <div className="streak" title={tl('今日 {minutes} / {goal} 分钟', { minutes, goal })}>
            <svg className="sring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" fill="none" stroke="var(--line-2)" strokeWidth="4" /><circle cx="18" cy="18" r="14" fill="none" stroke="var(--warm)" strokeWidth="4" strokeLinecap="round" strokeDasharray="87.96" strokeDashoffset={ring} transform="rotate(-90 18 18)" /></svg>
            <div className="hide-c"><div className="t">{!connected ? (import.meta.env.DEV ? tl('Core 未连接') : tl('暂时读不到数据')) : streak > 0 ? tl('连续 {streak} 天', { streak }) : tl('今天开始')}</div><div className="s">{connected ? tl('今日 {minutes} / {goal} 分钟', { minutes, goal }) : import.meta.env.DEV ? tl('界面只显示空状态') : tl('重启 Tibi 试试')}</div></div>
          </div>
          <div className="user">
            <span className="av">{tl('你')}</span>
            <span className="hide-c" style={{ flex: 1 }} />
            <NavLink to="/settings" className="ibtn" title={tl('设置')}><SettingsIcon /></NavLink>
          </div>
        </div>
        {!collapsed && <ResizeHandle className="side-resize" side="right" width={sideWidth} onChange={setSideWidth} onReset={() => setSideWidth(SIDE_W)} onDragging={setResizing} />}
      </aside>
      <SearchPalette />
      <section className="main">
        <Outlet />
        <OutsideApprovals />
      </section>
    </div>
  );
}

/** 深浅色切换（原型放在顶栏右侧） */
function ThemeButton() {
  const theme = useUi(s => s.theme); const setTheme = useUi(s => s.setTheme);
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  return <button className="ibtn" title={dark ? tl('切换到浅色') : tl('切换到深色')} onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? <Sun /> : <Moon />}</button>;
}

/** 顶栏：面包屑 + 右侧动作 + 深浅色 */
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
      <ThemeButton />
    </header>
  );
}
