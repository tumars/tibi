import { BookOpen, CircleUserRound, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Fox } from '../components/Fox';
import { tl } from '../lib/i18n';
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
    void rpc.call('settings.get', { keys: ['tts.engine', 'tts.voice', 'tts.rate'] }).then(s => void import('../lib/tts').then(t => t.configure({ engine: (s['tts.engine'] as 'system' | 'kokoro') ?? 'system', voice: (s['tts.voice'] as string) ?? '', rate: Number(s['tts.rate'] ?? 1) })), () => undefined);
    const off = rpc.on('task.done', d => { if (d.task.skill_id === 'importer' && d.task.trigger !== 'auto' && d.result?.document_id) toast(d.result.summary || tl('导入完成')); });
    return off;
  }, []);
  useEffect(() => { setImm(false); }, [loc.pathname]);
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
