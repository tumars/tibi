import type { DocumentSummary, TaskSummary } from '@tibi/core';
import { ArrowUp, ChevronDown, Play, Plus, Search, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Empty } from '../components/Empty';
import { Fox } from '../components/Fox';
import { Modal } from '../components/Modal';
import { openSample, Samples } from '../components/Samples';
import { Top } from '../components/Shell';
import { classifyInput, fmtMinutes, fmtPct, GENRE_NAMES } from '../lib/util';
import { errorInfo, isTauri, rpc, type Result } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';
import { DocCard } from './Library';

/**
 * 首页：与原型 docs/prototypes/home.html 对齐（00 §3.5，R13）。
 * 自上而下：狐狸 + 欢迎语 → 大输入框（不分模式，按内容判断）→ 建议 → 继续读主卡 + 还在读 → 今天三张卡 → 书架。
 */
type Kind = 'all' | 'article' | 'book';

export function Home() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [stats, setStats] = useState<Result<'stats.summary'>>();
  const [week, setWeek] = useState<number[]>([]);
  const [task, setTask] = useState<TaskSummary>();
  const [confirmUrl, setConfirmUrl] = useState<string>();
  const [over, setOver] = useState(false);
  const [focus, setFocus] = useState(false);
  const [kind, setKind] = useState<Kind>('all');
  const due = useCore(s => s.due); const connected = useCore(s => s.connected); const status = useCore(s => s.status);
  const goal = useCore(s => s.goal); const nickname = useCore(s => s.nickname);
  const ta = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try { const r = await rpc.call('documents.list', { sort: 'opened', limit: 12 }); setDocs(r.items); } catch { setDocs([]); }
    try { setStats(await rpc.call('stats.summary', { range: 30 })); } catch { /* 没有统计时显示 0 */ }
    try { const s = await rpc.call('stats.series', { metrics: ['minutes'], days: 7 }); setWeek(s.series.minutes ?? []); } catch { setWeek([]); }
  }, []);
  useEffect(() => { void load(); return rpc.on('data.changed', d => { if (d.table === 'documents' || d.table === 'cards') void load(); }); }, [load]);
  useEffect(() => {
    const off1 = rpc.on('task.update', d => { if (d.task.skill_id === 'importer') setTask(d.task); });
    const off2 = rpc.on('task.done', d => { if (d.task.skill_id === 'importer' || d.result?.document_id) { setTask(undefined); void load(); } });
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
    const k = classifyInput(t);
    if (k === 'url') { await importSource({ type: 'url', url: t }); return; }
    if (k === 'text') { await importSource({ type: 'text', text: t }); return; }
    toast('问 Tibi 从 M2 起可用。粘贴网址或一段英文可以导入。');
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files[0];
    if (f && /\.(txt|md)$/i.test(f.name)) { await importSource({ type: 'text', text: await f.text() }); return; }
    if (f) { toast('M4 起支持 PDF、EPUB'); return; }
    const t = e.dataTransfer.getData('text'); if (t) setText(t);
  };

  const pickFile = async () => {
    if (!isTauri()) { toast('浏览器里不能选文件，可以把 .txt / .md 拖进输入框'); return; }
    const { invoke } = await import('@tauri-apps/api/core');
    const r = await invoke<{ paths: string[] }>('pick_file', { kinds: ['txt'], multiple: false }).catch(e => { toast(String(e), { kind: 'err' }); return undefined; });
    if (r?.paths[0]) await importSource({ type: 'file', path: r.paths[0] });
  };

  const reading = docs.filter(d => d.progress > 0 && d.progress < 1);
  const lead = reading[0] ?? docs.find(d => d.progress === 0);
  const also = reading.filter(d => d !== lead).slice(0, 3);
  const shelf = docs.filter(d => kind === 'all' || d.kind === kind);
  const todayMin = week.length ? Math.round(week[week.length - 1] ?? 0) : 0;
  const k = classifyInput(text.trim());
  const foxState = task ? 'reading' : focus ? 'listening' : 'idle';
  const hour = new Date().getHours();
  const greeting = hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 13 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  // 欢迎语第二行只是一句邀请，不报状态：在读的文章、待复习、没读的文章下面的卡片都有，这里再说就重复了（00 §3.5）
  const welcomeLine = docs.length === 0 ? '读过的文章里的生词会自动进入复习' : hour < 5 ? '睡前读一小段？' : '今天想读点什么？';

  return (
    <>
      <Top crumbs={[{ label: '首页' }]} />
      <div className="scroll"><div className="page home">
        <section className="hero">
          <div className="welcome">
            <Fox className="hero-fox" size={104} state={foxState} />
            <h1>{greeting}{nickname ? <>，<span className="name">{nickname}</span></> : ''}</h1>
            <div className="sub">{welcomeLine}</div>
          </div>
          <div className={`composer${over ? ' over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
              <textarea ref={ta} value={text} rows={2} aria-label="输入"
                placeholder="粘贴网址或一段英文就会导入，也可以直接问 Tibi；输入 / 选择要做的事"
                onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} />
              <div className="cbar">
                <button className="attach" title="添加文件" onClick={pickFile}><Plus size={16} /></button>
                {text.trim() && <span className="hint">{({ url: '导入这个网址', text: '导入这段英文', ask: '问 Tibi（M2 起）' } as const)[k]}</span>}
                <span className="sp" />
                <button className="tier" title="切换速度与深度" onClick={() => toast('"深入"档从 M2 起可用')}>快速 <ChevronDown size={12} /></button>
                <button className="send" disabled={!text.trim()} onClick={submit} aria-label="发送"><ArrowUp size={17} /></button>
              </div>
          </div>
          {/* 书架是空的：建议换成"读示例 / 测词汇量"（原型 home.html#empty） */}
          {docs.length === 0 && (connected || status) ? <div className="chips">
            <button className="chip" onClick={async () => { const list = await rpc.call('documents.samples', {}).catch(() => []); const s = list.find(x => x.is_default) ?? list[0]; if (s) void openSample(s, nav); }}><Play />读一篇示例文章</button>
            <button className="chip" onClick={() => nav('/welcome?step=2&from=home')}><Sparkles />先测一下我的词汇量</button>
          </div> : <div className="chips">
            <button className="chip" onClick={() => toast('找文章从 M5 起可用')}><Search />推荐一篇 10 分钟的科技新闻</button>
            <button className="chip" onClick={() => toast('M2 起可用')}><Sparkles />用这周的生词写个小故事</button>
          </div>}
        </section>
        {lead && (
          <section className="lead-wrap">
            <div className="lead" role="button" tabIndex={0} onClick={() => nav(`/read/${lead.id}`)} onKeyDown={e => { if (e.key === 'Enter') nav(`/read/${lead.id}`); }}>
              <div className="k">{lead.progress > 0 ? '继续读' : '开始读'} · {lead.book ? `书 · 第 ${lead.book.chapter} 章` : GENRE_NAMES[lead.genre] ?? lead.genre}</div>
              <div className="t">{lead.title}</div>
              {lead.excerpt && <p className="x">{lead.excerpt}</p>}
              <div className="m">
                <div className="bar2"><i style={{ width: fmtPct(lead.progress) }} /></div>
                <span>读到 {fmtPct(lead.progress)} · 还剩{fmtMinutes(lead.minutes * (1 - lead.progress))}</span>
                <span className="btn pri">{lead.progress > 0 ? '继续' : '开始读'}</span>
              </div>
            </div>
            {also.length > 0 && <div className="also"><span>还在读</span>{also.map(d => <a key={d.id} href={`#/read/${d.id}`}>{d.title}{d.book ? ` · 第 ${d.book.chapter} 章` : ` · ${fmtPct(d.progress)}`}</a>)}</div>}
          </section>
        )}

        {task && <div className="importing"><span className="lbl">正在导入</span><b style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{task.title}</b><span className="lbl" style={{ marginLeft: 'auto' }}>{task.step.label}</span></div>}

        <section>
          <div className="sech"><h2>今天</h2></div>
          <div className="tiles">
            <div className="tile">
              <span className="k">待复习</span>
              <span className="v">{due}<small>张</small></span>
              <span className="d">{due ? `约 ${Math.max(1, Math.round(due / 3))} 分钟` : '今天没有到期的'}</span>
              {due > 0 && <button className="go" onClick={() => nav('/review')}>开始</button>}
            </div>
            <div className="tile">
              <span className="k">今日阅读</span>
              <span className="v">{todayMin}<small>/ {goal} 分钟</small></span>
              <div className="bar2"><i style={{ width: `${Math.min(100, (todayMin / goal) * 100)}%` }} /></div>
            </div>
            <div className="tile">
              <span className="k">已知词</span>
              <span className="v">{(stats?.known ?? 0).toLocaleString()}<small>词</small></span>
              <span className="d">本周 +{stats?.known_delta ?? 0} · 连续 {stats?.streak ?? 0} 天</span>
              <div className="week">{Array.from({ length: 7 }, (_, i) => { const m = week[i] ?? 0; return <i key={i} className={i === 6 ? 'now' : m >= goal ? 'on' : ''} />; })}</div>
            </div>
          </div>
        </section>

        <section>
          <div className="sech">
            <h2>书架</h2>
            <div className="seg">{(['all', 'article', 'book'] as const).map(x => <button key={x} className={kind === x ? 'on' : ''} onClick={() => setKind(x)}>{{ all: '全部', article: '文章', book: '书' }[x]}</button>)}</div>
            <a className="more" href="#/library">全部书架 →</a>
          </div>
          {shelf.length ? <div className="docs">{shelf.slice(0, 8).map(d => <DocCard key={d.id} d={d} onOpen={() => nav(`/read/${d.id}`)} />)}</div>
            : connected || status ? <Empty title="书架还是空的" text="粘贴网址或拖入文件就能导入，也可以先读一篇示例。" action={<Samples />} />
            : <Empty title="连不上 Tibi Core" text="先运行 pnpm core:dev，再刷新。" />}
        </section>
      </div></div>

      <Modal open={!!confirmUrl} onOpenChange={o => { if (!o) setConfirmUrl(undefined); }} title="导入这个网址？"
        actions={<><button className="btn" onClick={() => setConfirmUrl(undefined)}>取消</button><button className="btn pri" onClick={() => { const u = confirmUrl!; setConfirmUrl(undefined); void importSource({ type: 'url', url: u }, 'deeplink'); }}>导入</button></>}>
        <p style={{ wordBreak: 'break-all' }}>{confirmUrl}</p>
      </Modal>
    </>
  );
}
