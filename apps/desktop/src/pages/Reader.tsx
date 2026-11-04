import type { Document, SectionContent, Sentence, Status } from '@tibi/core';
import { ArrowUp, BookA, BookOpenCheck, CircleCheck, Eye, FileText, Info, Languages, Sparkles, Type, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { DocSource } from '../components/DocSource';
import { Empty } from '../components/Empty';
import { Modal } from '../components/Modal';
import { ResizeHandle } from '../components/ResizeHandle';
import { Top } from '../components/Shell';
import { fmtMinutes, GENRE_NAMES, throttle } from '../lib/util';
import { SectionView } from '../reader/Section';
import { DictPanel } from '../reader/DictPanel';
import { SummaryPanel } from '../reader/SummaryPanel';
import { TibiPanel } from '../reader/TibiPanel';
import { ReadAloud } from '../reader/ReadAloud';
import type { Pending } from '../components/ChatThread';
import { WordCard } from '../reader/WordCard';
import { errorInfo, rpc } from '../rpc';
import { useCore } from '../store/core';
import { PANEL_W, toast, useSepiaPaper, useUi } from '../store/ui';
import { tl } from '../lib/i18n';

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
  const [card, setCard] = useState<{ word: string; lemma: string; sentence: Sentence; s: number; anchor: DOMRect }>();
  const [overrides, setOverrides] = useState<Map<string, Status>>(new Map());
  const [showTop, setShowTop] = useState(false);
  const [panel, setPanel] = useState<'summary' | 'tibi' | 'dict'>();
  const [dictWord, setDictWord] = useState<string>();
  const [pending, setPending] = useState<Pending>();
  const [selAsk, setSelAsk] = useState<{ text: string; sentence_id?: string; x: number; y: number }>();
  const [translating, setTranslating] = useState(false);
  const [aloud, setAloud] = useState(false);
  const modelOk = useCore(st => !!st.status?.models.ok);
  const sepia = useSepiaPaper(); const setSepia = useUi(s => s.setSepia);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  const sectionId = section ?? doc?.sections[0]?.id;

  useEffect(() => {
    let alive = true; setErr(undefined); restored.current = false;
    const get = () => rpc.call('documents.get', { id: id! }).then(d => { if (alive) setDoc(d); }, e => { if (alive) setErr(errorInfo(e).message); });
    void get();
    // 后台生成的总结（导入时、补做、重新生成）好了就刷新
    const off = rpc.on('data.changed', d => { if (d.table === 'documents' && (!d.ids || d.ids.includes(id!))) void get(); });
    return () => { alive = false; off(); };
  }, [id]);
  useEffect(() => {
    if (!sectionId) return;
    let alive = true;
    rpc.call('sections.get', { id: sectionId, with: ['translations'] }).then(c => { if (alive) { setContent(c); setOverrides(new Map()); } }, e => { if (alive) setErr(errorInfo(e).message); });
    // 译文写好后重新取（只换句子，不重置覆盖状态）
    const off = rpc.on('data.changed', d => {
      if (d.table === 'sentences' && d.ids?.includes(sectionId)) { setTranslating(false); void rpc.call('sections.get', { id: sectionId, with: ['translations'] }).then(c => { if (alive) setContent(c); }); }
      // 刚导入、还在分词标注时就打开：句子还没有 tokens；标注做完文章会变，再取一次
      else if (d.table === 'documents' && d.ids?.includes(id!)) void rpc.call('sections.get', { id: sectionId, with: ['translations'] }).then(c => { if (alive) setContent(c); });
      // 词卡上标了词：覆盖状态只管着色，行间释义要重新取（刚标的词加载时还没有记录，不带释义）
      else if (d.table === 'terms') void rpc.call('sections.get', { id: sectionId, with: ['translations'] }).then(c => { if (alive) setContent(c); });
    });
    return () => { alive = false; off(); };
  }, [sectionId]);

  // R16：打开直接回到上次位置；"回到开头"常驻
  useEffect(() => {
    if (!content || !doc || restored.current) return;
    restored.current = true;
    const sec = doc.sections.find(s => s.id === content.id);
    const el = scrollRef.current;
    if (el && sec && sec.progress > 0.02 && sec.progress < 1) {
      requestAnimationFrame(() => { el.scrollTop = (el.scrollHeight - el.clientHeight) * sec.progress; setShowTop(true); });
    }
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
    setCard({ word, lemma, sentence, s, anchor: (ev.currentTarget as HTMLElement).getBoundingClientRect() });
  }, []);

  // 问 Tibi：打开右侧面板，把问题和当前位置一起发给讲解技能
  const ask = useCallback((text: string, extra: { sentence_id?: string; selection?: string } = {}) => {
    if (!content || !id) return;
    setPending({ key: `${Date.now()}`, text, context: { page: 'reader', document_id: id, section_id: content.id, ...extra } });
    setPanel('tibi'); setSelAsk(undefined); setCard(undefined); window.getSelection()?.removeAllRanges();
  }, [content, id]);
  // ⌘K 搜索里的"问 Tibi"：在阅读器里时发到 Tibi 面板，带上这篇文章（00 §3.8）
  useEffect(() => { const on = (e: Event) => ask((e as CustomEvent<string>).detail); window.addEventListener('tibi:ask', on); return () => window.removeEventListener('tibi:ask', on); }, [ask]);
  // 选中一段文字：在选区上方浮出"问 Tibi"
  const onSelect = useCallback(() => {
    const sel = window.getSelection(); const t = sel?.toString().trim() ?? '';
    if (!sel || sel.isCollapsed || t.length < 2 || t.length > 600) { setSelAsk(undefined); return; }
    const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
    const sid = node?.closest<HTMLElement>('[data-sid]')?.dataset.sid;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    setSelAsk({ text: t, sentence_id: sid, x: r.left + r.width / 2, y: r.top });
  }, []);

  const counts = content?.counts;
  const onFinish = async () => {
    if (!content) return;
    try {
      await rpc.call('sections.finish', { id: content.id });
      // 留在这一页，底部换成“已读完”；文章会因 data.changed 重取，这里先改上，免得闪一下
      setDoc(d => d && { ...d, sections: d.sections.map(s => s.id === content.id ? { ...s, progress: 1, finished_at: s.finished_at ?? Date.now() } : s) });
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  if (err) return <><Top crumbs={[{ label: tl('书架'), to: '/library' }, { label: tl('文章') }]} /><Empty image="error-generic" title={tl('打不开这篇文章')} text={err} action={<button className="btn" onClick={() => nav('/library')}>{tl('回到书架')}</button>} /></>;
  if (!doc || !content) return <><Top crumbs={[{ label: tl('书架'), to: '/library' }, { label: doc?.title ?? '…' }]} /><div className="scroll" /></>;

  const sec = doc.sections.find(s => s.id === content.id);
  const next = sec && doc.sections.find(s => s.idx === sec.idx + 1);
  const done = !!sec?.finished_at;

  return (
    <>
      <Top crumbs={[{ label: tl('书架'), to: '/library' }, { label: doc.title }]} right={<>
        {doc.sections.length > 1 && <select className="input" value={content.id} onChange={e => nav(`/read/${id}/${e.target.value}`)} aria-label={tl('章节')}>{doc.sections.map(s => <option key={s.id} value={s.id}>{s.idx + 1}. {s.title || tl('第 {v0} 章', { v0: s.idx + 1 })}</option>)}</select>}
        <button className={`pill${panel === 'summary' ? ' on' : ''}`} title={tl('总结')} onClick={() => setPanel(panel === 'summary' ? undefined : 'summary')}><FileText size={15} />{tl('总结')}</button>
        <button className={`pill${panel === 'dict' ? ' on' : ''}`} title={tl('词典')} onClick={() => setPanel(panel === 'dict' ? undefined : 'dict')}><BookA size={15} />{tl('词典')}</button>
        <button className={`pill${panel === 'tibi' ? ' on' : ''}`} title={tl('问 Tibi')} onClick={() => setPanel(panel === 'tibi' ? undefined : 'tibi')}><Sparkles size={15} />Tibi</button>
        <button className="ibtn" title={tl('标注说明')} onClick={() => setLegend(true)}><Info /></button>
      </>} />
      <div className={`rdwrap${panel ? ' with-panel' : ''}${resizing ? ' resizing' : ''}`} style={panel ? { '--rpanel': `${panelWidth}px` } as React.CSSProperties : undefined}>
      <div className="scroll" ref={scrollRef} onScroll={() => { onScroll(); setSelAsk(undefined); }} onMouseUp={onSelect}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '18px 32px 0' }}>
          <div className="rd" style={{ padding: 0 }}>
            <div className="meta">
              <span>{GENRE_NAMES[doc.genre] ?? doc.genre} · {fmtMinutes(sec?.word_count ? sec.word_count / 180 : doc.minutes)}{doc.level ? ` · ${tl('难度约 {level}', { level: doc.level })}` : ''}</span>
              <DocSource d={doc} />
              {counts && counts.new + counts.learning > 0 && <span className="tagc">{tl('生词 {new} · 学习中 {learning}', { new: counts.new, learning: counts.learning })}</span>}
            </div>
            <h1>{doc.sections.length > 1 && sec?.title ? sec.title : doc.title}</h1>
          </div>
        </div>
        <SectionView content={content} mode={mode} gloss={gloss} translations={translations} overrides={overrides} selected={card ? { sentence: card.sentence.id, s: card.s } : undefined} onWord={onWord} />
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 32px 40px' }}>
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
        </div>
        <div className="rdbar">
          <button className={translations ? 'on' : ''} onClick={async () => {
            const on = !translations; setTranslations(on);
            if (!on || translating || content.sentences.every(s => s.translation)) return;
            if (!modelOk) { toast(tl('要连接模型才能生成译文'), { action: { label: tl('去连接'), run: () => nav(`/welcome?step=3&back=${encodeURIComponent(location.hash.slice(1))}`) } }); return; }
            try { setTranslating(true); await rpc.call('sections.translate', { id: content.id }); toast(tl('正在翻译这一章，好了会自动显示')); } catch (e) { setTranslating(false); toast(errorInfo(e).message, { kind: 'err' }); }
          }}><Languages />{translating ? tl('翻译中…') : tl('译文')}</button>
          <button className={gloss ? 'on' : ''} onClick={() => setGloss(!gloss)}><Type />{tl('释义')}</button>
          <button className={aloud ? 'on' : ''} onClick={() => setAloud(!aloud)}><Volume2 />{tl('朗读')}</button>
          <button className={sepia ? 'on' : ''} onClick={() => setSepia(!sepia)}><Eye />{tl('护眼')}</button>
          <span className="vsep" />
          <button onClick={() => setMode(mode === 'all' ? 'new' : mode === 'new' ? 'clean' : 'all')}>{{ all: tl('全部标注'), new: tl('仅生词'), clean: tl('纯净阅读') }[mode]}</button>
          <span className="vsep" />
          <button className={done ? 'on' : ''} disabled={done} onClick={() => void onFinish()}><BookOpenCheck />{done ? tl('已读完') : tl('读完了')}</button>
        </div>
      </div>
      {panel && <ResizeHandle className="rpanel-resize" side="left" width={panelWidth} onChange={setPanelWidth} onReset={() => setPanelWidth(PANEL_W)} onDragging={setResizing} />}
      {panel === 'tibi' && <TibiPanel doc={doc} sectionId={content.id} pending={pending} onClose={() => setPanel(undefined)} />}
      {panel === 'dict' && <DictPanel word={dictWord} onClose={() => setPanel(undefined)} onAsk={t => ask(t)} />}
      {panel === 'summary' && <SummaryPanel doc={doc} onClose={() => setPanel(undefined)} onPhrase={text => { const el = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[data-sid]') ?? [])].find(x => x.textContent?.toLowerCase().includes(text.toLowerCase())); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } else toast(tl('这一章里没有找到这个短语')); }} />}
      </div>
      {aloud && <ReadAloud key={content.id} content={content} scroller={scrollRef.current} onClose={() => setAloud(false)} />}
      {showTop && <button className="totop" onClick={() => { scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); setShowTop(false); }}><ArrowUp size={14} />{tl('回到开头')}</button>}
      {selAsk && <button className="selask" style={{ left: selAsk.x, top: selAsk.y }} onMouseDown={e => e.preventDefault()} onClick={() => ask(selAsk.text.length > 80 ? tl('讲讲这句：{text}', { text: selAsk.text }) : tl('「{text}」在这里是什么意思？', { text: selAsk.text }), { sentence_id: selAsk.sentence_id, selection: selAsk.text })}><Sparkles size={13} />{tl('问 Tibi')}</button>}
      {card && <WordCard onAsk={(w, sid) => ask(tl('「{w}」在这句话里是什么意思？用法上要注意什么？', { w }), { sentence_id: sid, selection: w })} word={card.word} sentenceId={card.sentence.id} anchor={card.anchor} onClose={() => setCard(undefined)} onDict={w => { setDictWord(w); setPanel('dict'); setCard(undefined); }} onStatus={(text, st) => setOverrides(m => new Map(m).set(text, st))} />}
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
