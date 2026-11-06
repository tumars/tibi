import type { DocumentSummary } from '@tibi/core';
import { ArrowUp, Play, Plus, Search, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Empty } from '../components/Empty';
import { Fox } from '../components/Fox';
import { Modal } from '../components/Modal';
import { openSample, Samples } from '../components/Samples';
import { Top } from '../components/Shell';
import { ActionChip, ModelPicker, SlashMenu, useSlashMenu } from '../components/Composer';
import { parseSlash, type SlashAction } from '../lib/slash';
import { classifyInput, fmtMinutes, fmtPct, GENRE_NAMES, isImeKey } from '../lib/util';
import { errorInfo, isTauri, isWeb, rpc, type Result } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';
import { DocCard } from './Library';
import { tl } from '../lib/i18n';
import { pickFiles, registerFiles } from '../lib/files';

const IMPORTABLE = /\.(pdf|epub|docx|txt|md|markdown|png|jpe?g|webp|heic|tiff?)$/i;
const IMAGE = /\.(png|jpe?g|webp|heic|tiff?)$/i;

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
  const [task, setTask] = useState<{ id: string; title: string; label: string }>();   // 正在导入的那篇
  const [confirmUrl, setConfirmUrl] = useState<string>();
  const [over, setOver] = useState(false);
  const [focus, setFocus] = useState(false);
  const [kind, setKind] = useState<Kind>('all');
  const [model, setModel] = useState<string>();
  const due = useCore(s => s.due); const connected = useCore(s => s.connected); const status = useCore(s => s.status); const coreDown = useCore(s => !s.connected && !s.status && !!s.error);
  const goal = useCore(s => s.goal); const wordCount = useCore(s => s.wordCount); const nickname = useCore(s => s.nickname);
  const ta = useRef<HTMLTextAreaElement>(null);
  const [action, setAction] = useState<SlashAction>();   // / 选中的动作，显示在输入框上方
  const slash = useSlashMenu(text, focus, a => { setAction(a); setText(''); ta.current?.focus(); });
  const { actions, menu } = slash;

  const load = useCallback(async () => {
    try { const r = await rpc.call('documents.list', { sort: 'opened', limit: 12 }); setDocs(r.items); } catch { setDocs([]); }
    try { setStats(await rpc.call('stats.summary', { range: 30 })); } catch { /* 没有统计时显示 0 */ }
    try { const s = await rpc.call('stats.series', { metrics: ['minutes'], days: 7 }); setWeek(s.series.minutes ?? []); } catch { setWeek([]); }
  }, []);
  useEffect(() => { void load(); return rpc.on('data.changed', d => { if (d.table === 'documents' || d.table === 'cards') void load(); }); }, [load]);
  useEffect(() => {
    const off1 = rpc.on('import.progress', d => { if (d.origin !== 'mcp' && d.origin !== 'chat') setTask({ id: d.import_id, title: d.title, label: d.label }); });
    const off2 = rpc.on('import.done', d => { setTask(t => (t?.id === d.import_id ? undefined : t)); if (d.ok) void load(); });
    return () => { off1(); off2(); };
  }, [load]);
  // 深链：先确认再导入；书架的「导入」带 compose=1 过来，直接聚焦输入框
  useEffect(() => {
    const u = params.get('import'); if (u) { setConfirmUrl(u); setParams({}, { replace: true }); }
    if (params.has('compose')) { ta.current?.focus(); setParams({}, { replace: true }); }
  }, [params, setParams]);

  const importSource = async (source: { type: 'text'; text: string } | { type: 'url'; url: string } | { type: 'file'; path: string } | { type: 'images'; paths: string[] }, origin: 'user' | 'deeplink' = 'user') => {
    try {
      const { import_id } = await rpc.call('documents.import', { source, origin });
      setTask(t => t?.id === import_id ? t : { id: import_id, title: source.type === 'url' ? source.url : source.type === 'file' ? source.path.split(/[\\/]/).pop()! : source.type === 'images' ? tl('{length} 张图片', { length: source.paths.length }) : tl('正在导入'), label: tl('开始') });
      setText(''); setAction(undefined);
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const submit = async () => {
    const t = text.trim();
    const typed = action ? { action, rest: t } : parseSlash(t, actions);
    if (typed) {
      const q = typed.rest || typed.action.empty;
      if (typed.action.id === 'importer') { if (typed.rest) await importSource(classifyInput(typed.rest) === 'url' ? { type: 'url', url: typed.rest } : { type: 'text', text: typed.rest }); }
      else if (q) await ask(q, typed.action.id);
      return;
    }
    if (!t) return;
    const k = classifyInput(t);
    if (k === 'url') { await importSource({ type: 'url', url: t }); return; }
    if (k === 'text') { await importSource({ type: 'text', text: t }); return; }
    await ask(t);
  };

  // 问 Tibi（R13 不分模式：不是网址、不是整段英文就当提问）：新开一个对话，主区切到对话页
  const ask = async (q: string, skill?: string) => {
    try { const c = await rpc.call('chat.open', {}); setText(''); setAction(undefined); nav(`/chat/${c.id}?q=${encodeURIComponent(q)}${skill ? `&skill=${skill}` : ''}${model ? `&model=${encodeURIComponent(model)}` : ''}`); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files[0];
    if (f && /\.(txt|md)$/i.test(f.name)) { await importSource({ type: 'text', text: await f.text() }); return; }
    // Web 版：拖进来的文件直接读字节交给页面里的 Core
    if (f && isWeb()) { await importFiles(await registerFiles([...e.dataTransfer.files].filter(x => IMPORTABLE.test(x.name)))); return; }
    if (f) { if (!isTauri()) toast(tl('浏览器开发模式只能拖入 .txt / .md；PDF、EPUB、DOCX 请在桌面端里拖入或点 +')); return; }   // 桌面端的文件拖入走下面的 Tauri 事件（拿得到路径）
    const t = e.dataTransfer.getData('text'); if (t) setText(t);
  };
  // 桌面端：系统把拖进窗口的文件路径交给壳；登记给 Core 后按文件导入（M4：PDF / EPUB / DOCX / 图片）
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent(async ev => {
      if (ev.payload.type !== 'drop') return;
      const paths = ev.payload.paths.filter(p => IMPORTABLE.test(p));
      if (!paths.length) return;
      await rpc.call('system.registerPaths', { paths });
      await importFiles(paths);
    })).then(f => { off = f; });
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 图片合成一篇（OCR），别的文件一个一篇
  const importFiles = async (paths: string[]) => {
    const images = paths.filter(p => IMAGE.test(p));
    if (images.length) await importSource({ type: 'images', paths: images });
    for (const p of paths.filter(x => !images.includes(x))) await importSource({ type: 'file', path: p });
  };

  const pickFile = async () => {
    if (!isTauri() && !isWeb()) { toast(tl('浏览器里不能选文件，可以把 .txt / .md 拖进输入框')); return; }
    const paths = await pickFiles(['txt', 'pdf', 'epub', 'docx', 'image'], true).catch(e => { toast(String(e), { kind: 'err' }); return []; });
    if (paths.length) await importFiles(paths);
  };

  const reading = docs.filter(d => d.progress > 0 && d.progress < 1);
  const lead = reading[0] ?? docs.find(d => d.progress === 0);
  const also = reading.filter(d => d !== lead).slice(0, 3);
  const shelf = docs.filter(d => kind === 'all' || d.kind === kind);
  const todayMin = week.length ? Math.round(week[week.length - 1] ?? 0) : 0;
  const k = classifyInput(text.trim());
  const typedAction = action ? undefined : parseSlash(text, actions)?.action;
  const canSend = !!text.trim() || !!action?.empty;
  const hour = new Date().getHours();
  const late = hour >= 23 || hour < 5;
  const foxState = task ? 'reading' : focus ? 'listening' : late ? 'sleeping' : 'idle';
  const greeting = hour < 5 ? tl('夜深了') : hour < 11 ? tl('早上好') : hour < 13 ? tl('中午好') : hour < 18 ? tl('下午好') : tl('晚上好');
  // 欢迎语第二行只是一句邀请，不报状态：在读的文章、待复习、没读的文章下面的卡片都有，这里再说就重复了（00 §3.5）
  const welcomeLine = docs.length === 0 ? tl('读过的文章里的生词会自动进入复习') : late ? tl('Tibi 睡了，你随意。') : hour < 5 ? tl('睡前读一小段？') : tl('今天想读点什么？');

  return (
    <>
      <Top crumbs={[{ label: tl('首页') }]} />
      <div className="scroll"><div className="page home">
        <section className="hero">
          <div className="welcome">
            {!coreDown && <Fox className="hero-fox" size={124} state={foxState} />}
            <h1>{greeting}{nickname ? <><span className="p">{tl('，')}</span><span className="name">{nickname}</span></> : ''}</h1>
            <div className="sub">{welcomeLine}</div>
          </div>
          <div className={`composer${over ? ' over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
              {action && <ActionChip action={action} onClear={() => { setAction(undefined); ta.current?.focus(); }} />}
              <textarea ref={ta} value={text} rows={2} aria-label={tl('输入')}
                placeholder={action?.placeholder ?? tl('粘贴网址或英文来导入，也可以直接问 Tibi')}
                onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
                onChange={e => { setText(e.target.value); slash.textChanged(); }}
                onKeyDown={e => {
                  if (isImeKey(e.nativeEvent) || slash.handleKey(e)) return;
                  if (e.key === 'Backspace' && action && !text) { setAction(undefined); return; }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
                }} />
              <SlashMenu menu={menu} cur={slash.cur} setCur={slash.setMenuCur} pick={slash.pick} />
              <div className="cbar">
                <button className="attach" title={tl('添加文件')} onClick={pickFile}><Plus size={16} /></button>
                {!action && !menu.length && text.trim() && <span className="hint">{typedAction ? typedAction.title : ({ url: tl('导入这个网址'), text: tl('导入这段英文'), ask: tl('问 Tibi') } as const)[k]}</span>}
                {!action && !menu.length && !text.trim() && focus && <span className="hint">{tl('输入 / 选择要做的事')}</span>}
                <span className="sp" />
                <ModelPicker value={model} onChange={setModel} />
                <button className="send" disabled={!canSend} onClick={submit} aria-label={tl('发送')}><ArrowUp size={17} /></button>
              </div>
          </div>
          {/* 书架是空的：建议换成"读示例"（原型 home.html#empty） */}
          {docs.length === 0 && (connected || status) ? <div className="chips">
            <button className="chip" onClick={async () => { const list = await rpc.call('documents.samples', {}).catch(() => []); const s = list.find(x => x.is_default) ?? list[0]; if (s) void openSample(s, nav); }}><Play />{tl('读一篇示例文章')}</button>
          </div> : <div className="chips">
            <button className="chip" onClick={() => void ask(tl('推荐一篇 10 分钟左右的科技文章'), 'scout')}><Search />{tl('推荐一篇 10 分钟的科技新闻')}</button>
            <button className="chip" onClick={() => void ask(tl('用这周的生词写个小故事'))}><Sparkles />{tl('用这周的生词写个小故事')}</button>
          </div>}
        </section>
        {lead && (
          <section className="lead-wrap">
            <div className="lead" role="button" tabIndex={0} onClick={() => nav(`/read/${lead.id}`)} onKeyDown={e => { if (e.key === 'Enter') nav(`/read/${lead.id}`); }}>
              <div className="k">{lead.progress > 0 ? tl('继续读') : tl('开始读')} · {lead.book ? tl('书 · 第 {chapter} 章', { chapter: lead.book.chapter }) : GENRE_NAMES[lead.genre] ?? lead.genre}</div>
              <div className="t">{lead.title}</div>
              {lead.excerpt && <p className="x">{lead.excerpt}</p>}
              <div className="m">
                <div className="bar2"><i style={{ width: fmtPct(lead.progress) }} /></div>
                <span>{tl('读到 {progress} · 还剩{v1}', { progress: fmtPct(lead.progress), v1: fmtMinutes(lead.minutes * (1 - lead.progress)) })}</span>
                <span className="btn pri">{lead.progress > 0 ? tl('继续') : tl('开始读')}</span>
              </div>
            </div>
            {also.length > 0 && <div className="also"><span>{tl('还在读')}</span>{also.map(d => <a key={d.id} href={`#/read/${d.id}`}>{d.title}{d.book ? tl(' · 第 {chapter} 章', { chapter: d.book.chapter }) : ` · ${fmtPct(d.progress)}`}</a>)}</div>}
          </section>
        )}

        {task && <div className="importing"><span className="lbl">{tl('正在导入')}</span><b style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{task.title}</b><span className="lbl" style={{ marginLeft: 'auto' }}>{task.label}</span></div>}

        <section>
          <div className="sech"><h2>{tl('今天')}</h2></div>
          <div className="tiles">
            <div className="tile">
              <span className="k">{tl('待复习')}</span>
              <span className="v">{due}<small>{tl('张')}</small></span>
              <span className="d">{due ? tl('约 {v0} 分钟', { v0: Math.max(1, Math.round(due / 3)) }) : tl('今天没有到期的')}</span>
              {due > 0 && <button className="go" onClick={() => nav('/review?run=1')}>{tl('开始')}</button>}
            </div>
            <div className="tile">
              <span className="k">{tl('今日阅读')}</span>
              <span className="v">{todayMin}<small>/ {tl('{goal} 分钟', { goal })}</small></span>
              <div className="bar2"><i style={{ width: `${Math.min(100, (todayMin / goal) * 100)}%` }} /></div>
            </div>
            <div className="tile">
              <span className="k">{tl('生词本')}</span>
              <span className="v">{wordCount.toLocaleString()}<small>{tl('词')}</small></span>
              <span className="d">{tl('已掌握 {v0} · 连续 {v1} 天', { v0: (stats?.mastered ?? 0).toLocaleString(), v1: stats?.streak ?? 0 })}</span>
              <div className="week" title={tl('最近 7 天：读够每日目标的那天点亮，最右边是今天')}>{Array.from({ length: 7 }, (_, i) => { const m = week[i] ?? 0; return <i key={i} className={i === 6 ? 'now' : m >= goal ? 'on' : ''} title={i === 6 ? tl('今天 {m} 分钟', { m }) : tl('{d} 天前 {m} 分钟', { d: 6 - i, m })} />; })}</div>
            </div>
          </div>
        </section>

        <section>
          <div className="sech">
            <h2>{tl('书架')}</h2>
            <div className="seg">{(['all', 'article', 'book'] as const).map(x => <button key={x} className={kind === x ? 'on' : ''} onClick={() => setKind(x)}>{{ all: tl('全部'), article: tl('文章'), book: tl('书') }[x]}</button>)}</div>
            <a className="more" href="#/library">{tl('全部书架 →')}</a>
          </div>
          {shelf.length ? <div className="docs">{shelf.slice(0, 8).map(d => <DocCard key={d.id} d={d} onOpen={() => nav(`/read/${d.id}`)} />)}</div>
            : connected || status ? <Empty title={tl('书架还是空的')} text={tl('粘贴网址或拖入文件就能导入，也可以先读一篇示例。')} action={<Samples />} />
            : import.meta.env.DEV ? <Empty image={coreDown ? 'error-offline' : undefined} title={tl('连不上 Tibi Core')} text={tl('先运行 pnpm core:dev，再刷新。')} />
            : <Empty image={coreDown ? 'error-offline' : undefined} title={tl('暂时读不到你的数据')} text={tl('你的数据还在本机。可以重试，不行就重启 Tibi。')} action={<button className="btn" onClick={() => { void useCore.getState().refresh(); void load(); }}>{tl('重试')}</button>} />}
        </section>
      </div></div>

      <Modal open={!!confirmUrl} onOpenChange={o => { if (!o) setConfirmUrl(undefined); }} title={tl('导入这个网址？')}
        actions={<><button className="btn" onClick={() => setConfirmUrl(undefined)}>{tl('取消')}</button><button className="btn pri" onClick={() => { const u = confirmUrl!; setConfirmUrl(undefined); void importSource({ type: 'url', url: u }, 'deeplink'); }}>{tl('导入')}</button></>}>
        <p style={{ wordBreak: 'break-all' }}>{confirmUrl}</p>
      </Modal>
    </>
  );
}
