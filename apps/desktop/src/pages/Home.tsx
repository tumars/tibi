import type { DocumentSummary, TaskSummary } from '@tibi/core';
import { ArrowUp, Newspaper, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Empty } from '../components/Empty';
import { Modal } from '../components/Modal';
import { Top } from '../components/Shell';
import { classifyInput, fmtMinutes, fmtPct, GENRE_NAMES } from '../lib/util';
import { errorInfo, isTauri, rpc, type Result } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';
import { DocCard } from './Library';

export function Home() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [stats, setStats] = useState<Result<'stats.summary'>>();
  const [task, setTask] = useState<TaskSummary>();
  const [confirmUrl, setConfirmUrl] = useState<string>();
  const [drop, setDrop] = useState(false);
  const status = useCore(s => s.status); const connected = useCore(s => s.connected);
  const ta = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try { const r = await rpc.call('documents.list', { sort: 'opened', limit: 8 }); setDocs(r.items); } catch { setDocs([]); }
    try { setStats(await rpc.call('stats.summary', { range: 30 })); } catch { /* M3 */ }
  }, []);
  useEffect(() => { void load(); return rpc.on('data.changed', d => { if (d.table === 'documents') void load(); }); }, [load]);
  useEffect(() => {
    const off1 = rpc.on('task.update', d => { if (d.task.skill_id === 'importer') setTask(d.task); });
    const off2 = rpc.on('task.done', d => { if (d.task.skill_id === 'importer') { setTask(undefined); void load(); } });
    return () => { off1(); off2(); };
  }, [load]);
  // 深链：先确认再导入
  useEffect(() => { const u = params.get('import'); if (u) { setConfirmUrl(u); setParams({}, { replace: true }); } }, [params, setParams]);

  const importSource = async (source: { type: 'text'; text: string } | { type: 'url'; url: string } | { type: 'file'; path: string }, origin: 'user' | 'deeplink' = 'user') => {
    try {
      const { task_id } = await rpc.call('documents.import', { source, origin });
      setTask({ id: task_id, state: 'run', skill_id: 'importer', title: source.type === 'url' ? source.url : '正在导入', trigger: origin, model: '', step: { index: 0, total: 0, label: '开始' }, started_at: Date.now(), duration_ms: 0, cost: 0 });
      setText('');
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const submit = async () => {
    const t = text.trim(); if (!t) return;
    const kind = classifyInput(t);
    if (kind === 'url') { await importSource({ type: 'url', url: t }); return; }
    if (kind === 'text') { await importSource({ type: 'text', text: t }); return; }
    toast('问 Tibi 从 M2 起可用。粘贴网址或一段英文可以导入。');
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDrop(false);
    const f = e.dataTransfer.files[0];
    if (f && /\.(txt|md)$/i.test(f.name)) { await importSource({ type: 'text', text: await f.text() }); return; }
    if (f) toast(isTauri() ? '拖入文件请用"选择文件"，M4 起支持 PDF / EPUB' : 'M4 起支持 PDF / EPUB');
    const t = e.dataTransfer.getData('text'); if (t) setText(t);
  };

  const pickFile = async () => {
    if (!isTauri()) { toast('浏览器模式不能选文件'); return; }
    const { invoke } = await import('@tauri-apps/api/core');
    const r = await invoke<{ paths: string[] }>('pick_file', { kinds: ['txt'], multiple: false }).catch(e => { toast(String(e), { kind: 'err' }); return undefined; });
    if (r?.paths[0]) await importSource({ type: 'file', path: r.paths[0] });
  };

  const current = docs.find(d => d.progress > 0 && d.progress < 1) ?? docs[0];
  const others = docs.filter(d => d !== current && d.progress > 0 && d.progress < 1).slice(0, 3);
  const greeting = (() => { const h = new Date().getHours(); return h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'; })();

  return (
    <>
      <Top crumbs={[{ label: '首页' }]} />
      <div className="scroll"><div className="page">
        {current ? (
          <div className="cont" onClick={() => nav(`/read/${current.id}`)} role="button" tabIndex={0} style={{ marginTop: 14, cursor: 'pointer' }}>
            <div style={{ minWidth: 0 }}>
              <div className="k">{current.progress > 0 ? '继续读' : '开始读'} · {GENRE_NAMES[current.genre] ?? current.genre}</div>
              <div className="t">{current.title}</div>
              {current.excerpt && <div className="ex">{current.excerpt}</div>}
              <div className="bar"><i style={{ width: fmtPct(current.progress) }} /></div>
              <div className="lbl" style={{ marginTop: 6 }}>读到 {fmtPct(current.progress)} · 还剩{fmtMinutes(current.minutes * (1 - current.progress))}</div>
              {others.length > 0 && <div className="lbl" style={{ marginTop: 8 }}>还在读：{others.map((d, i) => <span key={d.id}>{i > 0 && '、'}<a href={`#/read/${d.id}`} onClick={e => e.stopPropagation()} style={{ color: 'var(--ink-2)' }}>{d.title}</a></span>)}</div>}
            </div>
            <span className="btn pri">继续</span>
          </div>
        ) : (
          <h1 className="pt" style={{ marginTop: 18 }}>{greeting}，先读点什么？</h1>
        )}

        <div className={`ask${drop ? ' drop' : ''}`} onDragOver={e => { e.preventDefault(); setDrop(true); }} onDragLeave={() => setDrop(false)} onDrop={onDrop}>
          <img src="/logo.svg" alt="" style={{ width: 40, height: 40, borderRadius: 10, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <textarea ref={ta} value={text} onChange={e => setText(e.target.value)} placeholder="粘贴网址或一段英文就会导入，也可以直接问 Tibi" rows={2}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }} />
            <div className="foot">
              <button className="btn sm" onClick={pickFile}>选择文件</button>
              <span className="lbl">{text.trim() ? ({ url: '按 ⌘⏎ 导入这个网址', text: '按 ⌘⏎ 导入这段文字', ask: 'M2 起可以问 Tibi' } as const)[classifyInput(text)] : '⌘⏎ 发送'}</span>
              <span className="sp" />
              <button className="send" disabled={!text.trim()} onClick={submit} aria-label="发送"><ArrowUp size={16} /></button>
            </div>
          </div>
        </div>
        {task && <div className="card sunken" style={{ marginTop: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}><span className="lbl">正在导入</span><b style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</b><span className="lbl" style={{ marginLeft: 'auto' }}>{task.step.label}</span></div>}
        <div className="chips">
          <button className="chip" onClick={() => toast('M5 起可用')}><Newspaper size={14} />推荐一篇 10 分钟的新闻</button>
          <button className="chip" onClick={() => toast('M2 起可用')}><Sparkles size={14} />用这周的生词写个小故事</button>
        </div>

        <h2 className="st">今天</h2>
        <div className="today">
          <div className="k" onClick={() => nav('/review')} role="button" style={{ cursor: 'pointer' }}><b>{useCore.getState().due}</b><span>待复习 · 点击开始</span></div>
          <div className="k"><b>{stats?.minutes ?? 0}</b><span>今日阅读 / {20} 分钟</span></div>
          <div className="k"><b>{(stats?.known ?? 0).toLocaleString()}</b><span>已知词{stats?.known_delta ? ` · 本周 +${stats.known_delta}` : ''}</span></div>
        </div>

        <h2 className="st">书架<span className="sp" /><a className="linkbtn" href="#/library">全部书架 →</a></h2>
        {docs.length ? <div className="docs">{docs.slice(0, 6).map(d => <DocCard key={d.id} d={d} onOpen={() => nav(`/read/${d.id}`)} />)}</div>
          : <Empty title={connected ? '书架是空的' : (status ? '书架是空的' : '连不上 Tibi Core')} text={connected ? '粘贴一个网址或一段英文试试。' : '先运行 pnpm core:dev，再刷新。'} />}
      </div></div>

      <Modal open={!!confirmUrl} onOpenChange={o => { if (!o) setConfirmUrl(undefined); }} title="导入这个网址？"
        actions={<><button className="btn" onClick={() => setConfirmUrl(undefined)}>取消</button><button className="btn pri" onClick={() => { const u = confirmUrl!; setConfirmUrl(undefined); void importSource({ type: 'url', url: u }, 'deeplink'); }}>导入</button></>}>
        <p style={{ wordBreak: 'break-all' }}>{confirmUrl}</p>
      </Modal>
    </>
  );
}
