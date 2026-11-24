import type { Document, SectionContent, Sentence, Status } from '@tibi/core';
import { ArrowUp, BookmarkPlus, BookOpenCheck, CircleCheck, Eye, Info, Languages, LoaderCircle, Type, Volume2 } from 'lucide-react';
import { NavDictIcon, NavWordsIcon, SummaryOverviewIcon, TibiAvatar } from '../components/TibiIcons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { DocSource } from '../components/DocSource';
import { Empty } from '../components/Empty';
import { Modal } from '../components/Modal';
import { ResizeHandle } from '../components/ResizeHandle';
import { Top } from '../components/Shell';
import { fmtMinutes, GENRE_NAMES, throttle } from '../lib/util';
import { ChapterNav } from '../reader/ChapterNav';
import { SectionView } from '../reader/Section';
import { TranslationStatus } from '../reader/TranslationStatus';
import { useTranslation } from '../reader/useTranslation';
import { DictPanel } from '../reader/DictPanel';
import { WordsPanel } from '../reader/WordsPanel';
import { SummaryPanel } from '../reader/SummaryPanel';
import { TibiPanel } from '../reader/TibiPanel';
import { ReadAloud } from '../reader/ReadAloud';
import { FindBar } from '../reader/FindBar';
import { saveReaderDraft, type Pending } from '../components/ChatThread';
import { WordCard } from '../reader/WordCard';
import { errorInfo, rpc } from '../rpc';
import { useCore } from '../store/core';
import { PANEL_W, toast, useSepiaPaper, useUi } from '../store/ui';
import { tl } from '../lib/i18n';
import { isMacDesktop } from '../lib/macNative';
import { ReaderMenu, type ReaderMenuHandle, type ReadRequest } from '../reader/ReaderMenu';

export function Reader() {
  const { id, section } = useParams();
  const nav = useNavigate();
  const [doc, setDoc] = useState<Document>();
  const [content, setContent] = useState<SectionContent>();
  const [err, setErr] = useState<string>();
  const mode = useUi(s => s.readerMode); const setMode = useUi(s => s.setReaderMode);
  const panelWidth = useUi(s => s.panelWidth); const setPanelWidth = useUi(s => s.setPanelWidth);
  const [resizing, setResizing] = useState(false);
  const [gloss, setGloss] = useState(false);
  const [translations, setTranslations] = useState(false);
  const [legend, setLegend] = useState(false);
  const [card, setCard] = useState<{ word: string; lemma: string; sentence: Sentence; s: number; anchor: DOMRect; right?: number }>();
  const [overrides, setOverrides] = useState<Map<string, Status>>(new Map());
  const [showTop, setShowTop] = useState(false);
  // 进来先看总结；窄窗口里右栏盖在正文上，先不开
  const [panel, setPanel] = useState<'summary' | 'words' | 'tibi' | 'dict' | undefined>(() => (matchMedia('(max-width: 1100px)').matches ? undefined : 'summary'));
  const [dictWord, setDictWord] = useState<string>();
  const [pending, setPending] = useState<Pending>();
  const readerMenu = useRef<ReaderMenuHandle>(null);
  const { translating, generate: generateTranslation } = useTranslation(content, setContent);
  const [aloud, setAloud] = useState(false);
  const [readRequest, setReadRequest] = useState<ReadRequest>();
  const [find, setFind] = useState(false);
  const modelOk = useCore(st => !!st.status?.models.ok);
  const wordCount = useCore(st => st.wordCount);
  const sepia = useSepiaPaper(); const setSepia = useUi(s => s.setSepia);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  const sectionId = section ?? doc?.sections[0]?.id;

  useEffect(() => {
    let alive = true; setErr(undefined); restored.current = false;
    const get = () => rpc.call('documents.get', { id: id! }).then(d => { if (alive) setDoc(d); }, e => { if (alive) setErr(errorInfo(e).message); });
    void get();
    // 后台生成的总结（现在生成、重新生成）好了就刷新
    const off = rpc.on('data.changed', d => { if (d.table === 'documents' && (!d.ids || d.ids.includes(id!))) void get(); });
    return () => { alive = false; off(); };
  }, [id]);
  useEffect(() => {
    if (!sectionId) return;
    let alive = true; restored.current = false;   // 切章后按这一章的进度重新定位：各章进度在文章里，连文章一起重取（切走的那章刚存了位置）
    let refresh = 0;
    Promise.all([rpc.call('sections.get', { id: sectionId, with: ['translations'] }), id ? rpc.call('documents.get', { id }) : undefined])
      .then(([c, d]) => { if (alive) { if (d) setDoc(d); if (refresh === 0) setContent(c); setOverrides(new Map()); } }, e => { if (alive && refresh === 0) setErr(errorInfo(e).message); });
    const reload = () => {
      const version = ++refresh;
      void rpc.call('sections.get', { id: sectionId, with: ['translations'] }).then(c => { if (alive && version === refresh) setContent(c); }, e => { if (alive && version === refresh) toast(errorInfo(e).message, { kind: 'err' }); });
    };
    // 译文开始、逐批写回、完成和失败时刷新（不重置覆盖状态）
    const off = rpc.on('data.changed', d => {
      if (d.table === 'sentences' && d.ids?.includes(sectionId)) reload();
      // 刚导入、还在分词标注时就打开：句子还没有 tokens；标注做完文章会变，再取一次
      else if (d.table === 'documents' && d.ids?.includes(id!)) reload();
      // 词卡上标了词：覆盖状态只管着色，行间释义要重新取（刚标的词加载时还没有记录，不带释义）
      else if (d.table === 'terms') reload();
    });
    return () => { alive = false; off(); };
  }, [sectionId]);

  // R16：打开直接回到上次位置；"回到开头"常驻
  useEffect(() => {
    if (!content || !doc || restored.current) return;
    const sec = doc.sections.find(s => s.id === content.id);
    const el = scrollRef.current;
    let alive = true;
    // 随包字体首次加载会改变换行；等版面稳定后再恢复比例位置。
    void document.fonts.ready.then(() => requestAnimationFrame(() => {
      if (!alive) return;
      restored.current = true;
      if (el && sec && sec.progress > 0.02 && sec.progress < 1) {
        el.scrollTop = (el.scrollHeight - el.clientHeight) * sec.progress; setShowTop(true);
      } else if (el) { el.scrollTop = 0; setShowTop(false); }   // 没读过或读完了的章从头开始
    }));
    return () => { alive = false; };
  }, [content, doc]);

  // 存不上只提示一次，存上了再清掉；继续滚动时自然会重试
  const saveFailed = useRef(false);
  const saveProgress = useMemo(() => throttle((sid: string, progress: number, sentence_id: string) => {
    rpc.call('sections.progress', { id: sid, sentence_id, progress }).then(() => { saveFailed.current = false; }, () => {
      if (!saveFailed.current) toast(tl('阅读位置暂时存不上，继续阅读时会再试'), { kind: 'err' });
      saveFailed.current = true;
    });
  }, 1500), []);
  // 切章、离开、关窗口前把还没发的那次发出去，不让下一章的位置把它盖掉
  useEffect(() => {
    const flush = () => saveProgress.flush();
    addEventListener('pagehide', flush);
    return () => { removeEventListener('pagehide', flush); flush(); };
  }, [sectionId, saveProgress]);
  const onScroll = useCallback(() => {
    const el = scrollRef.current; if (!el || !content) return;
    const p = el.scrollHeight <= el.clientHeight ? 1 : el.scrollTop / (el.scrollHeight - el.clientHeight);
    setShowTop(p > 0.03);
    // 可视区第一句
    const mid = el.getBoundingClientRect().top + 40;
    const spans = el.querySelectorAll<HTMLElement>('[data-sid]'); let sid = content.sentences[0]?.id;
    for (const s of spans) { if (s.getBoundingClientRect().bottom >= mid) { sid = s.dataset.sid; break; } }
    if (sid) saveProgress(content.id, Math.min(1, Math.max(0, p)), sid);
  }, [content, saveProgress]);

  const onWord = useCallback((ev: React.MouseEvent<HTMLSpanElement>, word: string, lemma: string, sentence: Sentence, s: number) => {
    setCard({ word, lemma, sentence, s, anchor: (ev.currentTarget as HTMLElement).getBoundingClientRect(), right: scrollRef.current?.getBoundingClientRect().right });
  }, []);

  // 问 Tibi：打开右侧面板，把问题和当前位置一起发给讲解技能
  const ask = useCallback((text: string, extra: { sentence_id?: string; selection?: string } = {}) => {
    if (!content || !id) return;
    const question = { key: `${Date.now()}`, text, draft: !useCore.getState().status?.models.ok, context: { page: 'reader', document_id: id, section_id: content.id, ...extra } };
    if (question.draft) saveReaderDraft(id, question);
    setPending(question);
    setPanel('tibi'); setCard(undefined); window.getSelection()?.removeAllRanges();
  }, [content, id]);
  // ⌘K 搜索里的"问 Tibi"：在阅读器里时发到 Tibi 面板，带上这篇文章（00 §3.8）
  useEffect(() => { const on = (e: Event) => ask((e as CustomEvent<string>).detail); window.addEventListener('tibi:ask', on); return () => window.removeEventListener('tibi:ask', on); }, [ask]);
  const toggleTranslations = () => {
    if (!content) return;
    const on = !translations;
    if (!on || translating || content.sentences.every(s => s.translation)) { setTranslations(on); return; }
    if (!modelOk) { toast(tl('要连接模型才能生成译文'), { action: { label: tl('去连接'), run: () => nav(`/welcome?step=3&back=${encodeURIComponent(location.hash.slice(1))}`) } }); return; }
    setTranslations(true); void generateTranslation();
  };

  const counts = content?.counts;
  const onFinish = async () => {
    if (!content) return;
    try {
      await rpc.call('sections.finish', { id: content.id });
      // 留在这一页，底部换成“已读完”；文章会因 data.changed 重取，这里先改上，免得闪一下
      setDoc(d => d && { ...d, sections: d.sections.map(s => s.id === content.id ? { ...s, progress: 1, finished_at: s.finished_at ?? Date.now() } : s) });
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const setReadingShelved = useUi(s => s.setReadingShelved);
  useEffect(() => { setReadingShelved(doc?.shelved !== false); }, [doc?.shelved, setReadingShelved]);
  useEffect(() => () => setReadingShelved(true), [setReadingShelved]);

  // ⌘F / Ctrl+F 在这一章里查找；mac 上 ⌘F 归菜单栏（lib/macNative），发 tibi:find
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isMacDesktop && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); window.dispatchEvent(new Event('tibi:find')); }
    };
    const onFind = () => setFind(true);
    addEventListener('keydown', onKey); addEventListener('tibi:find', onFind);
    return () => { removeEventListener('keydown', onKey); removeEventListener('tibi:find', onFind); };
  }, []);

  // 从订阅里直接读的文章（不在书架里）：放进书架，可撤销
  const shelve = async () => {
    if (!doc) return;
    try {
      const r = await rpc.call('documents.update', { id: doc.id, patch: { shelved: true } });
      setDoc(d => (d ? { ...d, shelved: true } : d));
      toast(tl('已放进书架'), r.undo ? { action: { label: tl('撤销'), run: () => void rpc.call('system.undo', { undo_id: r.undo!.undo_id }).then(() => setDoc(d => (d ? { ...d, shelved: false } : d)), e => toast(errorInfo(e).message, { kind: 'err' })) } } : undefined);
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  if (err) return <><Top crumbs={[{ label: tl('书架'), to: '/library' }, { label: tl('文章') }]} /><Empty image="error-generic" title={tl('打不开这篇文章')} text={err} action={<button className="btn" onClick={() => nav('/library')}>{tl('回到书架')}</button>} /></>;
  if (!doc || !content) return <><Top crumbs={[{ label: tl('书架'), to: '/library' }, { label: doc?.title ?? '…' }]} /><div className="scroll"><p className="rd rdloading">{tl('正在打开…')}</p></div></>;

  const sec = doc.sections.find(s => s.id === content.id);
  const next = sec && doc.sections.find(s => s.idx === sec.idx + 1);
  const done = !!sec?.finished_at;

  return (
    <>
      <Top crumbs={[doc.shelved === false ? { label: tl('订阅'), to: '/feeds' } : { label: tl('书架'), to: '/library' }, { label: doc.title }]} right={<>
        {doc.shelved === false && <button className="pill" title={tl('从订阅里读的文章不在书架里，想留着就加进去')} onClick={() => void shelve()}><BookmarkPlus size={15} />{tl('加入书架')}</button>}
        {doc.sections.length > 1 && <select className="input chapsel" title={content.title} value={content.id} onChange={e => nav(`/read/${id}/${e.target.value}`)} aria-label={tl('章节')}>{doc.sections.map(s => <option key={s.id} value={s.id}>{s.idx + 1}. {s.title || tl('第 {v0} 章', { v0: s.idx + 1 })}</option>)}</select>}
        <button className={`pill${panel === 'summary' ? ' on' : ''}`} title={tl('总结')} onClick={() => setPanel(panel === 'summary' ? undefined : 'summary')}><SummaryOverviewIcon size={15} />{tl('总结')}</button>
        <button className={`pill${panel === 'words' ? ' on' : ''}`} title={tl('生词')} aria-pressed={panel === 'words'} onClick={() => setPanel(panel === 'words' ? undefined : 'words')}><NavWordsIcon size={15} />{tl('生词')}</button>
        <button className={`pill${panel === 'dict' ? ' on' : ''}`} title={tl('词典')} onClick={() => setPanel(panel === 'dict' ? undefined : 'dict')}><NavDictIcon size={15} />{tl('词典')}</button>
        <button className={`pill${panel === 'tibi' ? ' on' : ''}`} title={tl('问 Tibi')} onClick={() => setPanel(panel === 'tibi' ? undefined : 'tibi')}><TibiAvatar size={17} />Tibi</button>
        <button className="ibtn" title={tl('标注说明')} onClick={() => setLegend(true)}><Info /></button>
      </>} />
      <div className={`rdwrap${panel ? ' with-panel' : ''}${resizing ? ' resizing' : ''}`} style={panel ? { '--rpanel': `${panelWidth}px` } as React.CSSProperties : undefined}>
      {find && <FindBar root={scrollRef.current} deps={[content, translations]} onClose={() => setFind(false)} />}
      <div className="scroll reader-scroll" ref={scrollRef} tabIndex={0} aria-label={tl('阅读区域')} onScroll={onScroll}>
        {translations && <TranslationStatus state={content.translation} onRetry={() => void generateTranslation()} />}
        <header className="rd rdhead">
          <div className="meta">
            <span>{GENRE_NAMES[doc.genre] ?? doc.genre} · {fmtMinutes(sec?.word_count ? sec.word_count / 200 : doc.minutes)}{doc.level ? ` · ${tl('难度约 {level}', { level: doc.level })}` : ''}</span>
            <DocSource d={doc} />
          </div>
          <h1>{doc.sections.length > 1 && sec?.title ? sec.title : doc.title}</h1>
          {wordCount === 0 && <div className="rdhint">{tl('点任何不认识的词，看它在这句里的意思')}</div>}
        </header>
        <SectionView content={content} mode={mode} gloss={gloss} translations={translations} overrides={overrides} selected={card ? { sentence: card.sentence.id, s: card.s } : undefined} onWord={onWord} onSentenceMenu={(sentence, element) => readerMenu.current?.sentence(sentence, element)} />
        <div className="rd rdtail">
          {counts && counts.new + counts.learning > 0 && <div className="rdhint">{tl('生词 {new} · 学习中 {learning}', { new: counts.new, learning: counts.learning })}</div>}
          {done ? <div className="endc done">
            <h3><CircleCheck size={18} />{next ? tl('这一章读完了') : tl('这篇读完了')}</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {next ? <button className="btn pri" onClick={() => nav(`/read/${id}/${next.id}`)}>{tl('下一章')}</button> : <button className="btn pri" onClick={() => nav('/library')}>{tl('回到书架')}</button>}
            </div>
          </div> : <div className="endc">
            <h3>{tl('读完了？')}</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn pri" onClick={() => void onFinish()}>{tl('读完了')}</button>
            </div>
          </div>}
          <ChapterNav sections={doc.sections} current={sec} onGo={s => nav(`/read/${id}/${s}`)} />
        </div>
        <div className="rdbar">
          <button className={translations ? 'on' : ''} title={translating ? tl('翻译中…') : tl('译文')} aria-label={translating ? tl('翻译中…') : tl('译文')} aria-pressed={translations} aria-busy={translating} onClick={toggleTranslations}>{translating ? <LoaderCircle className="translation-spin" /> : <Languages />}{translating ? tl('翻译中…') : tl('译文')}</button>
          <button className={gloss ? 'on' : ''} title={tl('释义')} onClick={() => {
            setGloss(!gloss);
            // 释义只写在生词和学习中的词上方；一个都没有时说清楚，不然看着像没反应
            const has = content.sentences.some(s => s.tokens.some(t => { const st = overrides.get(t.l) ?? t.status; return !!t.gloss && st !== undefined && st <= 4; }));
            if (!gloss && !has) toast(tl('这一章还没有要标释义的词。点一个词标成生词，释义会写在它上方'));
          }}><Type />{tl('释义')}</button>
          <button className={aloud ? 'on' : ''} title={tl('朗读')} onClick={() => { setReadRequest(undefined); setAloud(!aloud); }}><Volume2 />{tl('朗读')}</button>
          <button className={sepia ? 'on' : ''} title={tl('护眼')} onClick={() => setSepia(!sepia)}><Eye />{tl('护眼')}</button>
          <span className="vsep" />
          <button onClick={() => setMode(mode === 'all' ? 'new' : mode === 'new' ? 'clean' : 'all')}>{{ all: tl('全部标注'), new: tl('仅生词'), clean: tl('纯净阅读') }[mode]}</button>
          <span className="vsep" />
          <button className={done ? 'on' : ''} disabled={done} title={done ? tl('已读完') : tl('读完了')} onClick={() => void onFinish()}><BookOpenCheck />{done ? tl('已读完') : tl('读完了')}</button>
          {/* 放在工具栏里：浮在右下角会压住右栏的输入框 */}
          {showTop && <><span className="vsep" /><button title={tl('回到开头')} onClick={() => { scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); setShowTop(false); }}><ArrowUp />{tl('回到开头')}</button></>}
        </div>
      </div>
      {panel && <ResizeHandle className="rpanel-resize" side="left" width={panelWidth} onChange={setPanelWidth} onReset={() => setPanelWidth(PANEL_W)} onDragging={setResizing} />}
      {panel === 'tibi' && <TibiPanel key={doc.id} doc={doc} sectionId={content.id} pending={pending?.context?.document_id === doc.id ? pending : undefined} onClose={() => setPanel(undefined)} />}
      {panel === 'dict' && <DictPanel word={dictWord} onClose={() => setPanel(undefined)} onAsk={t => ask(t)} />}
      {panel === 'words' && <WordsPanel key={doc.id} documentId={doc.id} onClose={() => setPanel(undefined)} onWord={word => { setDictWord(word); setPanel('dict'); }} />}
      {panel === 'summary' && <SummaryPanel doc={doc} onClose={() => setPanel(undefined)} onPhrase={text => { const el = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[data-sid]') ?? [])].find(x => x.textContent?.toLowerCase().includes(text.toLowerCase())); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } else toast(tl('这一章里没有找到这个短语')); }} />}
      </div>
      {aloud && <ReadAloud key={content.id} content={content} scroller={scrollRef.current} request={readRequest} onClose={() => { setAloud(false); setReadRequest(undefined); }} />}
      <ReaderMenu key={`${id}/${sectionId}`} ref={readerMenu} root={scrollRef} doc={doc} content={content} active={doc.id === id && content.id === sectionId} overrides={overrides} mode={mode} translations={translations}
        onOpen={() => setCard(undefined)} onWord={target => setCard({ word: target.text, lemma: target.token.l, sentence: target.sentence, s: target.token.s, anchor: target.element.getBoundingClientRect(), right: scrollRef.current?.getBoundingClientRect().right })}
        onPhrase={(word, sentence) => setCard({ word, lemma: word.toLowerCase(), sentence, s: -1, anchor: window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).getBoundingClientRect() : scrollRef.current!.getBoundingClientRect(), right: scrollRef.current?.getBoundingClientRect().right })}
        onMark={(text, status) => setOverrides(m => { const next = new Map(m); if (status === undefined) next.delete(text); else next.set(text, status); return next; })}
        onAsk={ask} onRead={request => { setReadRequest(request); setAloud(true); }} onFind={() => setFind(true)} onTranslations={toggleTranslations} onMode={setMode} />
      {card && <WordCard onAsk={(w, sid) => ask(tl('「{w}」在这句话里是什么意思？用法上要注意什么？', { w }), { sentence_id: sid, selection: w })} word={card.word} sentenceId={card.sentence.id} anchor={card.anchor} right={card.right} onClose={() => setCard(undefined)} onDict={w => { setDictWord(w); setPanel('dict'); setCard(undefined); }} onStatus={(text, st) => setOverrides(m => new Map(m).set(text, st))} />}
      <Modal open={legend} onOpenChange={setLegend} title={tl('标注说明')} actions={<button className="btn pri" onClick={() => setLegend(false)}>{tl('知道了')}</button>}>
        <div className="legend">
          <div className="row"><span className="ex"><span className="w s0">upshot</span></span><span>{tl('生词：你标过的，点开看释义')}</span></div>
          <div className="row"><span className="ex"><span className="w s1">overhead</span></span><span>{tl('学习中：越浅越熟（见过 → 熟悉）')}</span></div>
          <div className="row"><span className="ex"><span className="w">feature</span></span><span>{tl('没标过的词不着色，点开可查词、标熟练度')}</span></div>
        </div>
      </Modal>
    </>
  );
}
