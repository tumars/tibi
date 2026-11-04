import { BookOpen, CircleUserRound, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Fox } from '../components/Fox';
import { tl } from '../lib/i18n';
import { presentNotice, startNoticeCheck } from '../lib/notice';
import { scheduleMobile, type ReminderTime } from '../lib/reminder';
import { startWidgetSnapshots, takeSharedImports } from './native';
import { rpc } from '../rpc';
import { bindCoreEvents, useCore } from '../store/core';
import { toast } from '../store/ui';
import { Library } from './Library';
import { Me } from './Me';
import { MReader } from './Reader';
import { MReview } from './Review';
import { Today } from './Today';
import { MToasts } from './ui';
import { Welcome } from './Welcome';

/**
 * 手机端独立的壳（00 §3.13，D8，M7）：今天 / 书架 / 复习 / 我 + 全屏阅读器。和桌面共用 Core 方法、rpc、i18n、复习与对话的逻辑，界面单独画。
 * 浏览器里打开 mobile.html 预览（宽屏时放在手机框里）；Tauri 移动端的窗口指向 mobile.html。
 */
export function MobileApp() {
  const loc = useLocation();
  const tab = loc.pathname.startsWith('/library') ? 'lib' : loc.pathname.startsWith('/review') ? 'review' : loc.pathname.startsWith('/me') ? 'me' : loc.pathname.startsWith('/read') ? 'read' : 'home';
  const [imm, setImm] = useState(false);
  useEffect(() => {
    bindCoreEvents(); void useCore.getState().refresh();
    const loadTts = () => void rpc.call('settings.get', { keys: ['tts.engine', 'tts.voice', 'tts.ai_voice', 'tts.rate'] }).then(s => void import('../lib/tts').then(t => t.configure({ engine: (s['tts.engine'] as 'system' | 'kokoro') ?? 'system', voice: (s['tts.voice'] as string) ?? '', aiVoice: (s['tts.ai_voice'] as string) || undefined, rate: Number(s['tts.rate'] ?? 1) })), () => undefined);
    loadTts();
    // Tibi 或别的设备改了语速，马上生效
    const offTts = rpc.on('data.changed', d => { if (d.table === 'settings') loadTts(); });
    const off = rpc.on('import.done', d => { if (d.origin === 'mcp' || d.origin === 'chat') return; if (d.ok) toast(d.summary || tl('导入完成')); else toast(d.error || tl('导入失败'), { kind: 'err' }); });
    return () => { off(); offTts(); };
  }, []);
  useEffect(() => { setImm(false); }, [loc.pathname]);
  // 公告：手机没有应用内更新，催升级也靠它（notice.json 的 below）
  useEffect(() => startNoticeCheck(presentNotice), []);
  // iOS 扩展：Safari 分享进来的网址、小组件快照
  useEffect(() => {
    void takeSharedImports();
    const vis = () => { if (document.visibilityState === 'visible') void takeSharedImports(); };
    document.addEventListener('visibilitychange', vis);
    const stop = startWidgetSnapshots();
    return () => { document.removeEventListener('visibilitychange', vis); stop(); };
  }, []);
  // 每日提醒（J8）：交给系统定时，按当前待复习数重排下一条；回到前台再排一次
  useEffect(() => {
    const plan = () => rpc.call('settings.get', { keys: ['reminder.time'] }).then(r => scheduleMobile((r['reminder.time'] as ReminderTime) ?? 'off', useCore.getState().due), () => undefined);
    const t = setTimeout(plan, 3000);
    const vis = () => { if (document.visibilityState === 'visible') void plan(); };
    document.addEventListener('visibilitychange', vis);
    const off = rpc.on('data.changed', d => { if (d.table === 'settings' || d.table === 'cards') void plan(); });
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', vis); off(); };
  }, []);
  return (
    <div className={`phone${imm ? ' imm' : ''}`} data-tab={tab}>
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/library" element={<Library />} />
        <Route path="/review" element={<MReview />} />
        <Route path="/me" element={<Me />} />
        <Route path="/read/:id" element={<MReader onImmersive={setImm} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {tab !== 'read' && !(tab === 'review' && loc.search.includes('run=1')) && <Tabs tab={tab} />}
      <Welcome />
      <MToasts />
    </div>
  );
}

function Tabs({ tab }: { tab: string }) {
  const nav = useNavigate();
  const due = useCore(s => s.due);
  const items: [string, string, typeof BookOpen, string][] = [['lib', tl('书架'), BookOpen, '/library'], ['review', tl('复习'), RotateCcw, '/review'], ['me', tl('我'), CircleUserRound, '/me']];
  return (
    <nav className="tabs">
      {/* 狐狸就是"今天"：已在今天时再点，光标进输入框 */}
      <button className="foxtab" aria-label={tl('今天')} onClick={() => { if (tab === 'home') (document.querySelector('.dock input') as HTMLInputElement | null)?.focus(); else nav('/'); }}><Fox size={50} className="fx" /></button>
      <div className="pill">{items.map(([k, label, Icon, to]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => nav(to)} aria-current={tab === k ? 'page' : undefined}><Icon strokeWidth={tab === k ? 2.2 : 1.8} />{label}{k === 'review' && due > 0 && <span className="n">{due}</span>}</button>)}</div>
    </nav>
  );
}
