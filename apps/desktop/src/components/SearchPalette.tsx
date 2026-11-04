import * as Dialog from '@radix-ui/react-dialog';
import type { SearchResult, Term } from '@tibi/core';
import { BarChart3, BookA, BookOpen, Bookmark, CornerDownLeft, FileText, Home as HomeIcon, MessageSquare, Moon, Plus, RotateCcw, Search, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { tl } from '../lib/i18n';
import { isMacDesktop } from '../lib/macNative';
import { GENRE_NAMES, STATUS_NAMES, isImeKey } from '../lib/util';
import { errorInfo, rpc } from '../rpc';
import { SETTINGS } from '../settings/search';
import { useCore } from '../store/core';
import { toast, useUi } from '../store/ui';

/**
 * 全局搜索（00 §3.8，⌘K）：居中浮层，一个输入框搜文章、单词、对话、设置和操作；最后一行永远是"问 Tibi"。
 * 文章 / 单词 / 对话 / 词典走 Core 的 search.query；设置项和跳转 / 操作在这里本地匹配。
 * 键盘：↑↓ 选择、↵ 打开、⌘↵ 问 Tibi、Tab 切范围、Esc 先清空再关闭。
 */
type Scope = 'all' | 'docs' | 'words' | 'settings' | 'actions';
interface Row { key: string; group: string; icon: ReactNode; title: ReactNode; sub?: ReactNode; tag?: string; run: () => void | Promise<void> }

const SCOPES: [Scope, string][] = [['all', tl('全部')], ['docs', tl('文章')], ['words', tl('单词')], ['settings', tl('设置')], ['actions', tl('操作')]];
const RECENT_KEY = 'tibi.search.recent';
const loadRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; } };

/** 把匹配处标成浅蓝荧光笔 */
function Hl({ text, q }: { text: string; q: string }) {
  const t = q.trim(); if (!t) return <>{text}</>;
  const i = text.toLowerCase().indexOf(t.toLowerCase()); if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + t.length)}</mark>{text.slice(i + t.length)}</>;
}
/** FTS 片段：[命中] → 高亮 */
const Snippet = ({ s }: { s: string }) => <>{s.split(/(\[[^\]]*\])/).map((p, i) => (p.startsWith('[') ? <mark key={i}>{p.slice(1, -1)}</mark> : p))}</>;

export function SearchPalette() {
  const nav = useNavigate(); const loc = useLocation();
  const setTheme = useUi(s => s.setTheme);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [res, setRes] = useState<SearchResult>();
  const [resQ, setResQ] = useState('');   // res 是哪个词搜出来的；和输入框不一致 = 还在搜
  const [sel, setSel] = useState(0);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const list = useRef<HTMLDivElement>(null);
  const recentDocs = useCore(st => st.recentDocs);
  const [recentWords, setRecentWords] = useState<Term[]>([]);
  useEffect(() => { if (open && scope === 'words' && !q) rpc.call('terms.list', { view: 'all', sort: 'added', limit: 6 }).then(r => setRecentWords(r.items), () => undefined); }, [open, scope, q]);

  // ⌘K / Ctrl+K 全局打开；左栏按钮发 tibi:search 事件
  useEffect(() => {
    // mac 上 ⌘K 归菜单栏（lib/macNative），发 tibi:search-toggle，这里不再监听按键，免得开了又关
    const onKey = (e: KeyboardEvent) => { if (!isMacDesktop && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); } };
    const onToggle = () => setOpen(o => !o);
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey); window.addEventListener('tibi:search', onOpen); window.addEventListener('tibi:search-toggle', onToggle);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('tibi:search', onOpen); window.removeEventListener('tibi:search-toggle', onToggle); };
  }, []);
  useEffect(() => { if (!open) { setQ(''); setScope('all'); setRes(undefined); setResQ(''); } }, [open]);
  const searching = !!q.trim() && resQ !== q.trim();
  useEffect(() => {
    const t = q.trim(); if (!t) { setRes(undefined); return; }
    let live = true;
    const h = setTimeout(() => { rpc.call('search.query', { q: t, limit: 6 }).then(r => { if (live) { setRes(r); setResQ(t); } }, () => { if (live) { setRes({ documents: [], terms: [], conversations: [] }); setResQ(t); } }); }, 120);
    return () => { live = false; clearTimeout(h); };
  }, [q]);

  const remember = (s: string) => { const t = s.trim(); if (!t) return; const r = [t, ...recent.filter(x => x !== t)].slice(0, 6); setRecent(r); try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch { /* 无存储 */ } };
  const go = (to: string) => { remember(q); setOpen(false); nav(to); };
  const ask = async (text: string) => {
    remember(text); setOpen(false);
    if (loc.pathname.startsWith('/read/')) { window.dispatchEvent(new CustomEvent('tibi:ask', { detail: text })); return; }
    try { const c = await rpc.call('chat.open', {}); nav(`/chat/${c.id}?q=${encodeURIComponent(text)}`); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const ACTIONS = useMemo(() => [
    { label: tl('首页'), kw: 'home', icon: <HomeIcon size={15} />, run: () => go('/') },
    { label: tl('书架'), kw: 'library 文章', icon: <BookOpen size={15} />, run: () => go('/library') },
    { label: tl('生词本'), kw: 'words 单词', icon: <Bookmark size={15} />, run: () => go('/words') },
    { label: tl('词典'), kw: 'dictionary dict 查词', icon: <BookA size={15} />, run: () => go(q.trim() && /^[a-z][a-z' -]*$/i.test(q.trim()) ? `/dict?w=${encodeURIComponent(q.trim())}` : '/dict') },
    { label: tl('开始复习'), kw: 'review 复习', icon: <RotateCcw size={15} />, run: () => go('/review?run=1') },
    { label: tl('练习'), kw: 'practice 听写 拼写', icon: <RotateCcw size={15} />, run: () => go('/review?tab=practice') },
    { label: tl('统计'), kw: 'stats', icon: <BarChart3 size={15} />, run: () => go('/stats') },
    { label: tl('设置'), kw: 'settings', icon: <SettingsIcon size={15} />, run: () => go('/settings') },
    { label: tl('导入文章'), kw: 'import url 网址 导入', icon: <Plus size={15} />, run: () => { go('/'); setTimeout(() => (document.querySelector('.composer textarea, textarea') as HTMLTextAreaElement | null)?.focus(), 150); } },
    { label: tl('切换深浅色'), kw: 'dark light theme 深色 浅色', icon: <Moon size={15} />, run: () => { setOpen(false); setTheme(document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) ? 'light' : 'dark'); } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [q, recent]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase(); const out: Row[] = [];
    const want = (s: Scope) => scope === 'all' || scope === s;
    if (!t) {
      if (scope === 'all' || scope === 'docs' || scope === 'words') recent.forEach(r => out.push({ key: `r-${r}`, group: tl('最近搜索'), icon: <Search size={15} />, title: r, run: () => setQ(r) }));
      if (scope === 'all' || scope === 'docs') recentDocs.filter(d => d.progress > 0 && d.progress < 1).slice(0, 2).forEach(d => out.push({ key: `cd-${d.id}`, group: tl('继续阅读'), icon: <FileText size={15} />, title: d.title, tag: `${Math.round(d.progress * 100)}%`, run: () => go(`/read/${d.id}`) }));
      if (scope === 'words') recentWords.forEach(w => out.push({ key: `rw-${w.id}`, group: tl('最近加入的词'), icon: <BookA size={15} />, title: w.display, sub: w.meaning, tag: STATUS_NAMES[w.status], run: () => go(`/words?term=${w.id}`) }));
      if (want('settings') && scope === 'settings') SETTINGS.forEach(s => out.push({ key: `s-${s.label}`, group: tl('设置'), icon: <SettingsIcon size={15} />, title: tl(s.label), run: () => go(`/settings?sec=${s.sec}&item=${encodeURIComponent(s.label)}`) }));
      if (want('actions')) ACTIONS.forEach(a => out.push({ key: `a-${a.label}`, group: tl('跳转与操作'), icon: a.icon, title: a.label, run: a.run }));
      return out;
    }
    const docs: Row[] = want('docs') ? (res?.documents ?? []).map(d => ({ key: `d-${d.id}`, group: tl('文章'), icon: <FileText size={15} />, title: <Hl text={d.title} q={q} />, sub: d.snippet ? <Snippet s={d.snippet} /> : undefined, tag: GENRE_NAMES[d.genre] ?? d.genre, run: () => go(`/read/${d.id}`) })) : [];
    const words: Row[] = want('words') ? (res?.terms ?? []).map(w => ({ key: `t-${w.id}`, group: tl('单词与短语'), icon: <BookA size={15} />, title: <Hl text={w.display} q={q} />, sub: w.meaning ? <Hl text={w.meaning} q={q} /> : undefined, tag: STATUS_NAMES[w.status], run: () => go(`/words?term=${w.id}`) })) : [];
    if (want('words') && res?.dict) {
      const d = res.dict;
      words.push({ key: `dict-${d.lemma}`, group: tl('单词与短语'), icon: <BookA size={15} />, title: <>{d.lemma} {d.entry.phonetic && <span className="lbl">/{d.entry.phonetic}/</span>}</>, sub: d.entry.translation.split('\n').slice(0, 2).join('；'), tag: tl('词典 · ↵ 加入生词本'), run: async () => {
        try { const r = await rpc.call('terms.add', { entries: [{ text: d.lemma }] }); remember(q); setOpen(false); toast(r.created.length ? tl('已加入生词本：{w}', { w: d.lemma }) : tl('{w} 已经在生词本里了', { w: d.lemma })); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
      } });
    }
    if (want('words') && /^[a-z\u3400-\u9fff][a-z\u3400-\u9fff' -]*$/i.test(t)) words.push({ key: 'dict-open', group: tl('单词与短语'), icon: <BookA size={15} />, title: tl('在词典里查“{w}”', { w: q.trim() }), run: () => go(`/dict?w=${encodeURIComponent(q.trim())}`) });
    const convs: Row[] = scope === 'all' ? (res?.conversations ?? []).map(c => ({ key: `c-${c.id}`, group: tl('对话'), icon: <MessageSquare size={15} />, title: c.kind === 'document' ? <>{tl('讲解 · ')}<Hl text={c.title} q={q} /></> : <Hl text={c.title} q={q} />, run: () => go(`/chat/${c.id}`) })) : [];
    const sets: Row[] = want('settings') ? SETTINGS.filter(s => tl(s.label).toLowerCase().includes(t) || s.label.toLowerCase().includes(t) || s.kw.toLowerCase().includes(t)).map(s => ({ key: `s-${s.label}`, group: tl('设置'), icon: <SettingsIcon size={15} />, title: <Hl text={tl(s.label)} q={q} />, sub: tl(SECTION_LABEL[s.sec] ?? ''), run: () => go(`/settings?sec=${s.sec}&item=${encodeURIComponent(s.label)}`) })) : [];
    const acts: Row[] = want('actions') ? ACTIONS.filter(a => a.label.toLowerCase().includes(t) || a.kw.toLowerCase().includes(t)).map(a => ({ key: `a-${a.label}`, group: tl('跳转与操作'), icon: a.icon, title: <Hl text={a.label} q={q} />, run: a.run })) : [];
    // 分组顺序按匹配程度：像英文单词时单词在前；命中页面名 / 设置名时它们在前
    const wordy = /^[a-z][a-z' -]*$/i.test(t) && words.length > 0;
    const navFirst = ACTIONS.some(a => a.label.toLowerCase().startsWith(t)) || SETTINGS.some(x => tl(x.label).toLowerCase().startsWith(t));
    const groups = navFirst && !wordy ? [acts, sets, docs, words, convs] : wordy ? [words, docs, convs, sets, acts] : [docs, words, convs, sets, acts];
    for (const g of groups) out.push(...g);
    out.push({ key: 'ask', group: '', icon: <Sparkles size={15} />, title: <>{tl('问 Tibi')}：“{q.trim()}”</>, tag: '⌘↵', run: () => ask(q) });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, scope, res, recent, ACTIONS, loc.pathname, recentDocs, recentWords]);

  useEffect(() => { setSel(0); }, [q, scope]);
  useEffect(() => { list.current?.querySelector('.pal-row.on')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (isImeKey(e.nativeEvent)) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(rows.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (q.trim()) void ask(q); }
    else if (e.key === 'Enter') { e.preventDefault(); void rows[sel]?.run(); }
    else if (e.key === 'Tab') { e.preventDefault(); const i = SCOPES.findIndex(([k]) => k === scope); setScope(SCOPES[(i + (e.shiftKey ? SCOPES.length - 1 : 1)) % SCOPES.length]![0]); }
  };

  let lastGroup = '';
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-ov pal-ov" />
        <Dialog.Content className="pal" aria-describedby={undefined} onKeyDown={onKey} onEscapeKeyDown={e => { if (q) { e.preventDefault(); setQ(''); } }}>
          <Dialog.Title className="sr-only">{tl('搜索')}</Dialog.Title>
          <div className="pal-in"><Search size={17} /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={tl('搜文章、单词、设置，或者直接问 Tibi')} aria-label={tl('搜索')} /><span className="kbd">esc</span></div>
          <div className="pal-scopes">{SCOPES.map(([k, l]) => <button key={k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{l}</button>)}
            {!q && recent.length > 0 && scope !== 'settings' && scope !== 'actions' && <button className="linkbtn" style={{ marginLeft: 'auto' }} onClick={() => { setRecent([]); try { localStorage.removeItem(RECENT_KEY); } catch { /* */ } }}>{tl('清除最近搜索')}</button>}
          </div>
          <div className="pal-list" ref={list}>
            {/* 文章、单词、对话是一次查出来的：没回来之前说一声，免得以为只有"问 Tibi" */}
            {searching && <div className="pal-empty">{tl('正在搜索…')}</div>}
            {rows.map((r, i) => {
              const head = r.group && r.group !== lastGroup ? <div className="pal-group">{r.group}</div> : null; lastGroup = r.group || lastGroup;
              return <div key={r.key}>{head}<div className={`pal-row${i === sel ? ' on' : ''}${r.key === 'ask' ? ' ask' : ''}`} onMouseMove={() => setSel(i)} onClick={() => void r.run()}>
                <span className="ic">{r.icon}</span><span className="body"><span className="tt">{r.title}</span>{r.sub && <span className="sb">{r.sub}</span>}</span>
                {r.tag && <span className="tg">{r.tag}</span>}{i === sel && <CornerDownLeft size={13} className="ent" />}
              </div></div>;
            })}
            {q.trim() && res && !searching && rows.length === 1 && <div className="pal-empty">{tl('没有找到，可以直接问 Tibi')}</div>}
          </div>
          <div className="pal-foot"><span><span className="kbd">↑↓</span> {tl('选择')}</span><span><span className="kbd">↵</span> {tl('打开')}</span><span><span className="kbd">⌘↵</span> {tl('问 Tibi')}</span><span><span className="kbd">tab</span> {tl('切换范围')}</span></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const SECTION_LABEL: Record<string, string> = { general: '通用', model: '模型', learning: '学习与复习', memory: '记忆', advanced: '高级', data: '数据' };
