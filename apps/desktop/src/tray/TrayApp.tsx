import type { DictEntryResult, DictSuggestResult, DocumentSummary, Status } from '@tibi/core';
import {
  ArrowUpCircle, ArrowUpRight, BookA, Bookmark, BookOpen, ChevronDown, ChevronUp,
  FileText, Globe, Pin, RotateCcw, RotateCw, Search, Settings as SettingsIcon, Sparkles, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SpeakButtons, stopSpeaking } from '../components/Speak';
import { Toasts } from '../components/Toasts';
import { TRAY_LOOKUP_USED } from '../lib/analytics';
import { clearRecentLookups, EXAM_NAMES, INFLECTION_NAMES, loadRecentLookups, parseGloss, rememberLookup } from '../lib/dict';
import { tl } from '../lib/i18n';
import { listenSafe } from '../lib/tauriEvents';
import { applyTtsSettings } from '../lib/ttsConfig';
import { fmtPct, isImeKey, STATUS_NAMES } from '../lib/util';
import { errorInfo, isTauri, rpc } from '../rpc';
import { toast } from '../store/ui';
import { classifyClipboardHint, classifyTrayQuery, DEFAULT_TRAY_HOTKEY, hotkeyKeys, type ClipboardHint } from './classify';

interface TrayUpdateBanner {
  version?: string | null;
  stage?: string | null;
  ratio?: number | null;
}

interface Snapshot {
  due: number;
  todayMin: number;
  goal: number;
  streak: number;
  recentDoc?: DocumentSummary;
}

const Snippet = ({ s }: { s: string }) => (
  <>{s.replace(/[*`#>]+/g, '').split(/(⟦[^⟧]*⟧)/).map((p, i) => (p.startsWith('⟦') ? <mark key={i}>{p.slice(1, -1)}</mark> : p))}</>
);

async function invokeSafe<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!isTauri()) return undefined;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

export function TrayApp() {
  const [q, setQ] = useState('');
  const [pinned, setPinned] = useState(false);
  const [hotkey, setHotkey] = useState<string>(DEFAULT_TRAY_HOTKEY);
  const [snap, setSnap] = useState<Snapshot>({ due: 0, todayMin: 0, goal: 20, streak: 0 });
  const [recent, setRecent] = useState<string[]>(loadRecentLookups);
  const [clipHint, setClipHint] = useState<ClipboardHint | null>(null);
  const dismissedClip = useRef<string>('');
  const [updateBanner, setUpdateBanner] = useState<TrayUpdateBanner | null>(null);
  const [dismissedUpdate, setDismissedUpdate] = useState<string>('');

  // 词典状态
  const [sug, setSug] = useState<DictSuggestResult>();
  const [sel, setSel] = useState(0);
  const [word, setWord] = useState<string>();
  const [locked, setLocked] = useState(false);
  const [data, setData] = useState<DictEntryResult>();
  const [busyWord, setBusyWord] = useState(false);

  // 快速导入状态
  const [importing, setImporting] = useState<{ id?: string; label: string; docId?: string; err?: string }>();

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const intent = useMemo(() => classifyTrayQuery(q), [q]);

  const hidePopover = useCallback(() => {
    stopSpeaking();
    void invokeSafe('tray_hide');
  }, []);

  const openMain = useCallback((route?: string, ask?: string) => {
    stopSpeaking();
    void invokeSafe('tray_open_main', { route: route ?? null, ask: ask ?? null });
  }, []);

  const togglePin = useCallback(async () => {
    const next = !pinned;
    setPinned(next);
    await invokeSafe('tray_set_pinned', { pinned: next });
  }, [pinned]);

  const refreshSnapshot = useCallback(async () => {
    setRecent(loadRecentLookups());
    const [terms, profile, stats, series, docs, settings] = await Promise.all([
      rpc.call('terms.list', { view: 'due', limit: 1 }).catch(() => undefined),
      rpc.call('profile.get', {}).catch(() => undefined),
      rpc.call('stats.summary', { range: 30 }).catch(() => undefined),
      rpc.call('stats.series', { metrics: ['minutes'], days: 1 }).catch(() => undefined),
      rpc.call('documents.list', { sort: 'opened', status: 'reading', limit: 1 }).catch(() => undefined),
      rpc.call('settings.get', { keys: ['tray.hotkey', 'tts.engine', 'tts.voice', 'tts.ai_voice', 'tts.rate'] }).catch(() => undefined),
    ]);
    setSnap({
      due: terms?.counts?.due ?? terms?.total ?? 0,
      goal: profile?.daily_goal_minutes || 20,
      streak: stats?.streak ?? 0,
      todayMin: Math.round(series?.series.minutes?.at(-1) ?? 0),
      recentDoc: docs?.items[0],
    });
    if (settings) {
      if (typeof settings['tray.hotkey'] === 'string') setHotkey(settings['tray.hotkey']);
      applyTtsSettings(settings);
    }
  }, []);

  const refreshClipboard = useCallback(async () => {
    const raw = await invokeSafe<string | null>('tray_read_clipboard');
    if (!raw || raw.trim() === dismissedClip.current) {
      setClipHint(null);
      return;
    }
    setClipHint(classifyClipboardHint(raw));
  }, []);

  // 启动与跨窗口事件同步
  useEffect(() => {
    void refreshSnapshot();
    void refreshClipboard();
    void invokeSafe<TrayUpdateBanner>('tray_get_update').then(u => { if (u) setUpdateBanner(u); });
    inputRef.current?.focus({ preventScroll: true });

    const offData = rpc.on('data.changed', d => {
      if (d.table === 'terms' || d.table === 'cards' || d.table === 'documents' || d.table === 'settings') {
        void refreshSnapshot();
      }
    });
    const offProg = rpc.on('import.progress', d => {
      setImporting(cur => (cur?.id && cur.id === d.import_id ? { ...cur, label: d.label } : cur));
    });
    const offDone = rpc.on('import.done', d => {
      if (startingImport.current) {
        earlyImportDone.current.set(d.import_id, { ok: d.ok, summary: d.summary, document_id: d.document_id, error: d.error });
        if (earlyImportDone.current.size > 16) earlyImportDone.current.delete(earlyImportDone.current.keys().next().value!);
      }
      setImporting(cur => {
        if (!cur?.id || cur.id !== d.import_id) return cur;
        return d.ok
          ? { id: d.import_id, label: d.summary || tl('导入完成'), docId: d.document_id }
          : { id: d.import_id, label: tl('导入失败'), err: d.error || tl('导入失败') };
      });
      if (d.ok) void refreshSnapshot();
    });

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'tibi-theme') {
        if (e.newValue === 'light' || e.newValue === 'dark') document.documentElement.dataset.theme = e.newValue;
        else delete document.documentElement.dataset.theme;
      } else if (e.key === 'tibi.lang') {
        location.reload();
      } else if (e.key === 'tibi.dict.recent') {
        setRecent(loadRecentLookups());
      }
    };
    window.addEventListener('storage', onStorage);

    const offOpened = listenSafe<{ update?: TrayUpdateBanner }>('tray_opened', payload => {
      void refreshSnapshot();
      void refreshClipboard();
      if (payload?.update) setUpdateBanner(payload.update);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) { el.focus({ preventScroll: true }); el.select(); }
      });
    });
    const offUpdate = listenSafe<TrayUpdateBanner>('tray_update', payload => {
      setUpdateBanner(payload ?? null);
    });
    const offHidden = listenSafe('tray_hidden', () => { stopSpeaking(); });
    const offTheme = listenSafe<{ theme?: string }>('tray_theme', payload => {
      const t = payload?.theme;
      if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
      else delete document.documentElement.dataset.theme;
    });

    return () => {
      offData(); offProg(); offDone();
      window.removeEventListener('storage', onStorage);
      offOpened(); offUpdate(); offHidden(); offTheme();
    };
  }, [refreshSnapshot, refreshClipboard]);

  // 词典联想
  const skipNextAutoPick = useRef(false);
  const importingFor = useRef<string | undefined>(undefined);
  const startingImport = useRef(0);
  const earlyImportDone = useRef(new Map<string, { ok: boolean; summary?: string; document_id?: string; error?: string }>());
  const wordRef = useRef<string | undefined>(undefined);
  wordRef.current = word;
  const entryReq = useRef(0);
  useEffect(() => {
    const curKey = intent.kind === 'url' ? intent.url : intent.kind === 'passage' ? intent.text : undefined;
    if (!curKey || importingFor.current !== curKey) {
      importingFor.current = undefined;
      setImporting(undefined);
    }
    if (intent.kind !== 'dict') {
      setSug(undefined);
      setWord(undefined);
      setLocked(false);
      return;
    }
    const text = intent.text;
    let live = true;
    const h = setTimeout(() => {
      rpc.call('dict.suggest', { q: text, limit: 8 }).then(r => {
        if (!live) return;
        setSug(r);
        setSel(0);
        if (skipNextAutoPick.current) { skipNextAutoPick.current = false; return; }
        setWord(r.mode === 'similar' ? text : r.items[0]?.word ?? text);
      }, () => {
        if (live) { setSug({ available: true, mode: 'prefix', items: [] }); setWord(text); }
      });
    }, 80);
    return () => { live = false; clearTimeout(h); };
  }, [intent]);

  // 词条加载
  const loadEntry = useCallback((w: string, isLive: () => boolean = () => true, recordLookup = false) => {
    const req = ++entryReq.current;
    return rpc.call('dict.entry', { word: w }).then(
      r => {
        if (!isLive() || req !== entryReq.current || wordRef.current !== w) return;
        setData(r);
        if (recordLookup && (r.entry || r.term) && isTauri()) {
          void import('@tauri-apps/api/event')
            .then(({ emitTo }) => emitTo('main', TRAY_LOOKUP_USED))
            .catch(() => undefined);
        }
      },
      e => { if (isLive() && req === entryReq.current && wordRef.current === w) { setData(undefined); toast(errorInfo(e).message, { kind: 'err' }); } },
    );
  }, []);

  useEffect(() => {
    if (!word) { setData(undefined); return; }
    let live = true;
    void loadEntry(word, () => live, true);
    const off = rpc.on('data.changed', d => { if (d.table === 'terms') void loadEntry(word, () => live); });
    return () => { live = false; off(); };
  }, [word, loadEntry]);

  const lookWord = useCallback((w: string, lock = true) => {
    skipNextAutoPick.current = w.trim() !== q.trim();
    setQ(w);
    setWord(w);
    setLocked(lock);
    setRecent(rememberLookup(w));
    scrollRef.current?.scrollTo({ top: 0 });
  }, [q]);

  const addToWordbook = useCallback(async (lemma: string) => {
    setBusyWord(true);
    try {
      const r = await rpc.call('terms.add', { entries: [{ text: lemma }] });
      const undo = r.undo;
      toast(
        tl('已加入生词本：{w}', { w: lemma }),
        undo && r.created.length
          ? { action: { label: tl('撤销'), run: () => void rpc.call('system.undo', { undo_id: undo.undo_id }).catch(e => toast(errorInfo(e).message, { kind: 'err' })) } }
          : undefined,
      );
      if (word) void loadEntry(word);
    } catch (e) {
      toast(errorInfo(e).message, { kind: 'err' });
    } finally {
      setBusyWord(false);
    }
  }, [word, loadEntry]);

  const markStatus = useCallback(async (text: string, status: Status) => {
    try {
      await rpc.call('terms.mark', { text, status });
      if (word) void loadEntry(word);
    } catch (e) {
      toast(errorInfo(e).message, { kind: 'err' });
    }
  }, [word, loadEntry]);

  const startImport = useCallback(async (source: { type: 'url'; url: string } | { type: 'text'; text: string }) => {
    const key = source.type === 'url' ? source.url : source.text;
    if (startingImport.current > 0 || (importingFor.current === key && importing && !importing.err && !importing.docId)) return;
    importingFor.current = key;
    startingImport.current++;
    setImporting({ label: tl('开始导入…') });
    try {
      const { import_id } = await rpc.call('documents.import', { source, origin: 'user' });
      if (importingFor.current !== key) return;
      const early = earlyImportDone.current.get(import_id);
      if (early) {
        earlyImportDone.current.delete(import_id);
        setImporting(early.ok
          ? { id: import_id, label: early.summary || tl('导入完成'), docId: early.document_id }
          : { id: import_id, label: tl('导入失败'), err: early.error || tl('导入失败') });
        if (early.ok) void refreshSnapshot();
        return;
      }
      setImporting(cur => (cur?.docId || cur?.err ? cur : { id: import_id, label: tl('正在导入…') }));
    } catch (e) {
      if (importingFor.current !== key) return;
      const msg = errorInfo(e).message;
      setImporting({ label: tl('导入失败'), err: msg });
      toast(msg, { kind: 'err' });
    } finally {
      startingImport.current = Math.max(0, startingImport.current - 1);
    }
  }, [importing, refreshSnapshot]);

  const items = sug?.items ?? [];
  const visibleItems = items.slice(0, 5);
  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeKey(e.nativeEvent)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (q) { setQ(''); setLocked(false); }
      else hidePopover();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (intent.kind === 'dict' && data && !busyWord) {
        const inBook = !!data.term && data.term.status <= 5 && (data.in_wordbook || data.term.status === 5);
        if (!inBook && (data.entry || data.term)) void addToWordbook(data.lemma);
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && q.trim()) {
      e.preventDefault();
      openMain(undefined, q.trim());
      return;
    }
    if (intent.kind === 'dict') {
      if (e.key === 'ArrowDown' && visibleItems.length) {
        e.preventDefault();
        setLocked(false);
        const next = Math.min(visibleItems.length - 1, sel + 1);
        setSel(next);
        setWord(visibleItems[next]!.word);
        return;
      }
      if (e.key === 'ArrowUp' && visibleItems.length) {
        e.preventDefault();
        setLocked(false);
        const next = Math.max(0, sel - 1);
        setSel(next);
        setWord(visibleItems[next]!.word);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const target = sug?.mode === 'similar' ? intent.text : visibleItems[sel]?.word ?? intent.text;
        if (target) lookWord(target, true);
        return;
      }
    } else if (intent.kind === 'url' && e.key === 'Enter') {
      e.preventDefault();
      void startImport({ type: 'url', url: intent.url });
    } else if (intent.kind === 'ask' && e.key === 'Enter') {
      e.preventDefault();
      openMain(undefined, intent.text);
    } else if (intent.kind === 'passage' && e.key === 'Enter') {
      e.preventDefault();
      void startImport({ type: 'text', text: intent.text });
    }
  };

  const hkLabel = hotkeyKeys(hotkey);

  return (
    <div className="tray-shell">
      <header className="tray-top" {...(pinned ? { 'data-tauri-drag-region': '' } : {})}>
        <label className="tray-search">
          <Search size={15} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => { skipNextAutoPick.current = false; setQ(e.target.value); setLocked(false); }}
            onKeyDown={onInputKey}
            placeholder={tl('查词、粘贴网址或问 Tibi…')}
            aria-label={tl('快速查词')}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {q && (
            <button type="button" className="tray-clear" onClick={() => { setQ(''); setLocked(false); inputRef.current?.focus(); }} aria-label={tl('清空')}>
              <X size={13} />
            </button>
          )}
        </label>
        <button
          type="button"
          className={`tray-tbtn${pinned ? ' on' : ''}`}
          onClick={() => void togglePin()}
          title={pinned ? tl('取消固定在最前') : tl('固定在最前（切换应用不自动收起）')}
          aria-label={pinned ? tl('取消固定') : tl('固定在最前')}
        >
          <Pin size={14} />
        </button>
        <button
          type="button"
          className="tray-tbtn"
          onClick={() => openMain()}
          title={tl('打开 Tibi 主窗口')}
          aria-label={tl('打开 Tibi')}
        >
          <ArrowUpRight size={15} />
        </button>
      </header>

      <main className="tray-scroll" ref={scrollRef}>
        {intent.kind === 'empty' && (
          <>
            {updateBanner?.version && (updateBanner.stage === 'ready' || updateBanner.stage === 'available' || updateBanner.stage === 'downloading') && dismissedUpdate !== `${updateBanner.version}:${updateBanner.stage}` && (
              <div className={`tray-update${updateBanner.stage === 'ready' ? ' ready' : ''}`}>
                <span className="tray-update-ic" aria-hidden="true">
                  {updateBanner.stage === 'ready' ? <RotateCw size={14} /> : <ArrowUpCircle size={14} />}
                </span>
                <span className="tray-update-txt">
                  {updateBanner.stage === 'ready'
                    ? tl('Tibi {v0} 已就绪，可重启更新', { v0: updateBanner.version })
                    : updateBanner.stage === 'downloading'
                    ? (typeof updateBanner.ratio === 'number'
                        ? tl('正在下载 Tibi {v0}（{v1}%）', { v0: updateBanner.version, v1: Math.round(updateBanner.ratio * 100) })
                        : tl('正在下载 Tibi {v0}…', { v0: updateBanner.version }))
                    : tl('发现新版本 Tibi {v0}', { v0: updateBanner.version })}
                </span>
                <button type="button" className={`btn sm${updateBanner.stage === 'ready' ? ' pri' : ''}`} onClick={() => openMain('__update__')}>
                  {updateBanner.stage === 'ready' ? tl('重启更新') : tl('查看')}
                </button>
                <button
                  type="button"
                  className="tray-clip-x"
                  aria-label={tl('忽略更新提示')}
                  onClick={() => setDismissedUpdate(`${updateBanner.version}:${updateBanner.stage}`)}
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {clipHint && (
              <div className="tray-clip">
                <div className="tray-clip-meta">
                  <span className="tray-clip-k">
                    {clipHint.kind === 'url' ? tl('剪贴板网址') : tl('剪贴板中的词')}
                  </span>
                  <span className={`tray-clip-v${clipHint.kind === 'word' ? ' word' : ''}`}>
                    {clipHint.kind === 'url' ? clipHint.host : clipHint.text}
                  </span>
                </div>
                {clipHint.kind === 'word' ? (
                  <button type="button" className="btn pri sm" onClick={() => lookWord(clipHint.text, true)}>
                    {tl('查词')}
                  </button>
                ) : (
                  <button type="button" className="btn pri sm" onClick={() => { setQ(clipHint.url); void startImport({ type: 'url', url: clipHint.url }); }}>
                    {tl('导入')}
                  </button>
                )}
                <button
                  type="button"
                  className="tray-clip-x"
                  aria-label={tl('忽略剪贴板建议')}
                  onClick={() => {
                    dismissedClip.current = clipHint.kind === 'url' ? clipHint.url : clipHint.text;
                    setClipHint(null);
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            )}

            <div className="tray-stats">
              <button type="button" className={`tray-stat${snap.due > 0 ? ' due' : ''}`} onClick={() => openMain(snap.due > 0 ? '/review?run=1' : '/review')}>
                <span className="k">{tl('待复习')}</span>
                <span className="v">{snap.due}<small>{tl('张')}</small></span>
              </button>
              <button type="button" className="tray-stat" onClick={() => openMain('/')}>
                <span className="k">{tl('今日阅读')}</span>
                <span className="v">{snap.todayMin}<small>/{snap.goal}{tl('分')}</small></span>
                <span className="tray-stat-bar"><i style={{ width: `${Math.min(100, (snap.todayMin / Math.max(1, snap.goal)) * 100)}%` }} /></span>
              </button>
              <button type="button" className={`tray-stat${snap.streak > 0 ? ' streak' : ''}`} onClick={() => openMain('/stats')}>
                <span className="k">{tl('连续学习')}</span>
                <span className="v">{snap.streak}<small>{tl('天')}</small></span>
              </button>
            </div>

            {snap.recentDoc && (
              <>
                <div className="tray-sec"><span>{tl('继续阅读')}</span></div>
                <button type="button" className="tray-doc" onClick={() => openMain(`/read/${snap.recentDoc!.id}`)}>
                  <div className="tray-doc-head">
                    <FileText size={14} />
                    <span className="tray-doc-title">{snap.recentDoc.title}</span>
                  </div>
                  <div className="tray-doc-meta">
                    <span className="tray-doc-bar"><i style={{ width: fmtPct(snap.recentDoc.progress) }} /></span>
                    <span>{fmtPct(snap.recentDoc.progress)}</span>
                  </div>
                </button>
              </>
            )}

            {recent.length > 0 ? (
              <>
                <div className="tray-sec">
                  <span>{tl('最近查过')}</span>
                  <button type="button" className="linkbtn" onClick={() => { clearRecentLookups(); setRecent([]); }}>{tl('清除')}</button>
                </div>
                <div className="tray-chips">
                  {recent.slice(0, 12).map(w => (
                    <button type="button" key={w} onClick={() => lookWord(w, true)}>{w}</button>
                  ))}
                </div>
              </>
            ) : !snap.recentDoc && (
              <div className="tray-empty-hint">
                {tl('输入单词离线查词，或粘贴网址导入书架。')}
              </div>
            )}
          </>
        )}

        {intent.kind === 'dict' && (
          <>
            {sug && !sug.available ? (
              <div className="tray-empty-hint">{tl('当前设备尚未安装离线词典。')}</div>
            ) : (
              <>
                {items.length > 1 && locked && (
                  <button type="button" className="tray-sug-toggle" onClick={() => setLocked(false)}>
                    <ChevronDown size={13} />
                    {tl('显示其他 {n} 个联想词', { n: items.length - 1 })}
                  </button>
                )}
                {!locked && items.length > 0 && (
                  <div className="tray-sugs" role="listbox" aria-label={tl('联想')}>
                    {sug?.mode === 'similar' && <div className="dx-hint" style={{ padding: '4px 8px' }}>{tl('未找到该词，相近词条：')}</div>}
                    {items.slice(0, 5).map((it, i) => (
                      <button
                        type="button"
                        key={it.word}
                        role="option"
                        aria-selected={i === sel}
                        className={`tray-sug${i === sel && sug?.mode !== 'similar' ? ' on' : ''}`}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { setSel(i); lookWord(it.word, true); }}
                      >
                        <b>{it.word}</b>
                        <span>{it.gloss}</span>
                      </button>
                    ))}
                  </div>
                )}

                {word && data && (
                  <CompactEntry
                    data={data}
                    word={word}
                    busy={busyWord}
                    onLook={w => lookWord(w, true)}
                    onAdd={lemma => void addToWordbook(lemma)}
                    onMark={(text, st) => void markStatus(text, st)}
                    onOpenDoc={id => openMain(`/read/${id}`)}
                    onOpenTerm={id => openMain(`/words?term=${id}`)}
                    onOpenDict={w => openMain(`/dict?w=${encodeURIComponent(w)}`)}
                    onAsk={prompt => openMain(undefined, prompt)}
                  />
                )}
              </>
            )}
          </>
        )}

        {intent.kind === 'url' && (
          <div className="tray-intent">
            <div className="tray-intent-head">
              <Globe size={16} />
              <span>{tl('导入网址')}</span>
            </div>
            <div className="tray-intent-sub">{intent.url}</div>
            {importing && (
              <div className="lbl" style={importing.err ? { color: 'var(--hard)' } : undefined}>
                {importing.err || importing.label}
              </div>
            )}
            <div className="tray-intent-acts">
              {importing?.docId ? (
                <button type="button" className="btn pri sm" onClick={() => openMain(`/read/${importing.docId}`)}>
                  {tl('开始阅读')}
                </button>
              ) : (
                <button type="button" className="btn pri sm" disabled={!!importing && !importing.err} onClick={() => void startImport({ type: 'url', url: intent.url })}>
                  {tl('导入文章')}
                </button>
              )}
              <button type="button" className="btn sm" onClick={() => openMain(`/?import=${encodeURIComponent(intent.url)}`)}>
                {tl('在主窗口确认')}
              </button>
            </div>
          </div>
        )}

        {intent.kind === 'passage' && (
          <div className="tray-intent">
            <div className="tray-intent-head">
              <FileText size={16} />
              <span>{tl('英文段落')}</span>
            </div>
            <div className="tray-intent-sub">{intent.text}</div>
            {importing && (
              <div className="lbl" style={importing.err ? { color: 'var(--hard)' } : undefined}>
                {importing.err || importing.label}
              </div>
            )}
            <div className="tray-intent-acts">
              {importing?.docId ? (
                <button type="button" className="btn pri sm" onClick={() => openMain(`/read/${importing.docId}`)}>
                  {tl('开始阅读')}
                </button>
              ) : (
                <button type="button" className="btn pri sm" disabled={!!importing && !importing.err} onClick={() => void startImport({ type: 'text', text: intent.text })}>
                  {tl('导入到书架')}
                </button>
              )}
              <button type="button" className="btn sm" onClick={() => openMain(undefined, tl('请帮我翻译并讲解这段英文：\n\n{t}', { t: intent.text }))}>
                <Sparkles size={13} />
                {tl('让 Tibi 讲解')}
              </button>
            </div>
          </div>
        )}

        {intent.kind === 'ask' && (
          <div className="tray-intent">
            <div className="tray-intent-head">
              <Sparkles size={16} />
              <span>{tl('问 Tibi')}</span>
            </div>
            <div className="tray-intent-sub">{intent.text}</div>
            <div className="tray-intent-acts">
              <button type="button" className="btn pri sm" onClick={() => openMain(undefined, intent.text)}>
                <Sparkles size={13} />
                {tl('发送给 Tibi')}
              </button>
              <button type="button" className="btn sm" onClick={() => openMain(`/dict?w=${encodeURIComponent(intent.text)}`)}>
                <BookA size={13} />
                {tl('在词典页打开')}
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="tray-foot">
        <button type="button" className="tray-nav-btn" onClick={() => openMain(snap.due > 0 ? '/review?run=1' : '/review')}>
          <RotateCcw size={13} />
          <span>{tl('复习')}</span>
          {snap.due > 0 && <span className="n">{snap.due}</span>}
        </button>
        <button type="button" className="tray-nav-btn" onClick={() => openMain(word ? `/dict?w=${encodeURIComponent(word)}` : '/dict')}>
          <BookA size={13} />
          <span>{tl('词典')}</span>
        </button>
        <button type="button" className="tray-nav-btn" onClick={() => openMain('/words')}>
          <Bookmark size={13} />
          <span>{tl('生词本')}</span>
        </button>
        <button type="button" className="tray-nav-btn" onClick={() => openMain('/library')}>
          <BookOpen size={13} />
          <span>{tl('书架')}</span>
        </button>
        <div className="tray-foot-r">
          {hkLabel && <span className="kbd" title={tl('快速查词快捷键')}>{hkLabel}</span>}
          <button type="button" className="tray-tbtn" style={{ width: 24, height: 24 }} onClick={() => openMain('/settings?sec=general')} title={tl('设置')} aria-label={tl('设置')}>
            <SettingsIcon size={13} />
          </button>
        </div>
      </footer>

      <Toasts />
    </div>
  );
}

function CompactEntry({
  data, word, busy, onLook, onAdd, onMark, onOpenDoc, onOpenTerm, onOpenDict, onAsk,
}: {
  data: DictEntryResult;
  word: string;
  busy: boolean;
  onLook: (w: string) => void;
  onAdd: (lemma: string) => void;
  onMark: (text: string, status: Status) => void;
  onOpenDoc: (id: string) => void;
  onOpenTerm: (id: string) => void;
  onOpenDict: (w: string) => void;
  onAsk: (prompt: string) => void;
}) {
  const [more, setMore] = useState(false);
  useEffect(() => { setMore(false); }, [word]);

  const { entry, term, lemma } = data;
  const head = entry?.word ?? term?.display ?? word;
  const inBook = !!term && term.status <= 5 && (data.in_wordbook || term.status === 5);

  if (!entry && !term) {
    return (
      <div className="tray-entry">
        <div className="tray-word-head"><h1>{word}</h1></div>
        <div className="lbl">{tl('词典未收录该词条。')}</div>
        {data.similar.length > 0 && (
          <div className="tray-chips">
            {data.similar.map(s => (
              <button type="button" key={s.word} onClick={() => onLook(s.word)} title={s.gloss}>{s.word}</button>
            ))}
          </div>
        )}
        <div className="tray-acts">
          <button type="button" className="btn pri sm" onClick={() => onAsk(tl('“{w}”是什么意思？', { w: word }))}>
            <Sparkles size={13} />
            {tl('问 Tibi')}
          </button>
        </div>
      </div>
    );
  }

  const lines = parseGloss(entry?.translation || term?.meaning || '');
  const atlas = data.extras?.atlas;
  const hasMore = !!(atlas?.collocations.length || entry?.inflections?.length || atlas?.synonyms.length);

  return (
    <div className="tray-entry">
      <div className="tray-word-head">
        <h1>{head}</h1>
        {(entry?.phonetic ?? term?.ipa) && <span className="ipa">/{entry?.phonetic ?? term?.ipa}/</span>}
        <SpeakButtons text={head} size={14} />
      </div>

      {data.via && <div className="lbl">{tl('“{v}”的原形词条', { v: data.via })}</div>}
      {entry?.base && (
        <div className="lbl">
          {tl('原形：')}
          <button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={() => onLook(entry.base!)}>{entry.base}</button>
        </div>
      )}

      {entry && (atlas?.cefr || entry.collins || entry.oxford || entry.exam.length > 0) ? (
        <div className="tray-tags">
          {atlas?.cefr && <span className="tagc">{atlas.cefr}</span>}
          {entry.collins ? <span className="tagc">{'★'.repeat(entry.collins)}</span> : null}
          {entry.oxford && <span className="tagc">{tl('牛津 3000')}</span>}
          {entry.exam.slice(0, 4).map(x => <span key={x} className="tagc">{EXAM_NAMES[x] ?? x}</span>)}
        </div>
      ) : null}

      <div className="tray-gloss">
        {lines.map((l, i) => <div key={i}>{l.tag && <em>{l.tag}</em>}<span>{l.text}</span></div>)}
      </div>

      {inBook ? (
        <div>
          <div className="tray-sec" style={{ marginTop: 4 }}>
            <span>{tl('熟练度：{s}', { s: STATUS_NAMES[term!.status] })}</span>
            <button type="button" className="linkbtn" onClick={() => onOpenTerm(term!.id)}>{tl('在生词本里看')}</button>
          </div>
          <div className="tray-stages">
            {([0, 1, 2, 3, 4, 5] as Status[]).map(s => (
              <button
                type="button"
                key={s}
                data-s={s}
                className={`${term!.status === s ? 'on' : ''}${s <= term!.status ? ' fill' : ''}`}
                onClick={() => onMark(term!.text, s)}
              >
                <i />
                <span>{STATUS_NAMES[s]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="tray-acts">
          <button type="button" className="btn pri sm" disabled={busy} onClick={() => onAdd(lemma)}>
            {lemma === head.toLowerCase() ? tl('加入生词本') : tl('把 {w} 加入生词本', { w: lemma })}
          </button>
          <button type="button" className="btn sm" onClick={() => onAsk(tl('讲讲 {w} 这个词：常见用法、搭配和容易混淆的词', { w: head }))}>
            <Sparkles size={13} />
            {tl('问 Tibi')}
          </button>
          <button type="button" className="btn sm" onClick={() => onOpenDict(head)}>
            {tl('详情')}
          </button>
        </div>
      )}

      {inBook && (
        <div className="tray-acts">
          <button type="button" className="btn sm" onClick={() => onAsk(tl('讲讲 {w} 这个词：常见用法、搭配和容易混淆的词', { w: head }))}>
            <Sparkles size={13} />
            {tl('问 Tibi')}
          </button>
          <button type="button" className="btn sm" onClick={() => onOpenDict(head)}>
            {tl('在词典页打开')}
          </button>
        </div>
      )}

      {atlas?.tip && <div className="tray-tip"><b>{tl('辨析')}</b>{atlas.tip}</div>}

      {data.readings.length > 0 && (
        <div>
          <div className="tray-sec"><span>{tl('在你读过的文章里')}</span></div>
          {data.readings.slice(0, 2).map(r => (
            <button type="button" key={r.document_id} className="tray-read" onClick={() => onOpenDoc(r.document_id)}>
              <span className="s"><Snippet s={r.snippet} /></span>
              <span className="lbl">{r.title}</span>
            </button>
          ))}
        </div>
      )}

      {atlas && atlas.examples.length > 0 && (
        <div>
          <div className="tray-sec"><span>{tl('例句')}</span></div>
          {atlas.examples.slice(0, 2).map(ex => (
            <div key={ex.en} className="tray-ex">
              <span className="s">{ex.en}</span>
              {ex.zh && <span className="zh">{ex.zh}</span>}
            </div>
          ))}
        </div>
      )}

      {hasMore && (
        <div>
          <button type="button" className="tray-sug-toggle" onClick={() => setMore(m => !m)}>
            {more ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {more ? tl('收起更多') : tl('展开词形与搭配')}
          </button>
          {more && (
            <>
              {entry?.inflections && entry.inflections.length > 0 && (
                <>
                  <div className="tray-sec"><span>{tl('词形')}</span></div>
                  <div className="dx-forms">
                    {entry.inflections.map(f => (
                      <button type="button" key={f.type + f.form} onClick={() => onLook(f.form)}>
                        <i>{INFLECTION_NAMES[f.type] ?? f.type}</i>
                        {f.form}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {atlas && atlas.collocations.length > 0 && (
                <>
                  <div className="tray-sec"><span>{tl('搭配')}</span></div>
                  <div className="dx-cols">
                    {atlas.collocations.slice(0, 5).map(c => (
                      <div key={c.en}><b>{c.en}</b>{c.zh && <span>{c.zh}</span>}</div>
                    ))}
                  </div>
                </>
              )}
              {atlas && atlas.synonyms.length > 0 && (
                <>
                  <div className="tray-sec"><span>{tl('近义词')}</span></div>
                  <div className="tray-chips">
                    {atlas.synonyms.slice(0, 8).map(w => (
                      <button type="button" key={w} onClick={() => onLook(w.replace(/\s*\([^)]*\)\s*$/, ''))}>{w}</button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
