import type { Document, SectionContent, Sentence, Status } from '@tibi/core';
import { ChevronLeft, Eye, Info, Languages, Sparkles, Type, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { tl } from '../lib/i18n';
import { fmtMinutes, fmtPct, GENRE_NAMES, speak, STATUS_NAMES, throttle } from '../lib/util';
import { SectionView } from '../reader/Section';
import { errorInfo, rpc, type Result } from '../rpc';
import { useCore } from '../store/core';
import { toast, useSepiaPaper, useUi } from '../store/ui';
import { Empty, Sheet, Thread } from './ui';

/**
 * 阅读器（00 §3.13 J4）：全屏；向下滚动收起顶栏和工具栏，向上滚动再出现。工具栏：译文、释义、朗读、护眼、Tibi。
 * 词卡是底部面板（J5）：点开生词即进"见过"并建卡（R5）。
 */
export function MReader({ onImmersive }: { onImmersive: (on: boolean) => void }) {
  const { id } = useParams(); const nav = useNavigate();
  const [doc, setDoc] = useState<Document & { sections: { id: string; idx: number; title?: string; progress: number }[] }>();
  const [secId, setSecId] = useState<string>();
  const [content, setContent] = useState<SectionContent>();
  const [err, setErr] = useState<string>();
  const [tr, setTr] = useState(false); const [gloss, setGloss] = useState(false);
  const [card, setCard] = useState<{ word: string; sentence: Sentence; s: number }>();
  const [tibi, setTibi] = useState<{ key: string; text: string } | 'open'>();
  const [legend, setLegend] = useState(false);
  const [overrides, setOverrides] = useState(new Map<string, Status>());
  const [reading, setReading] = useState(false);
  const [conv, setConv] = useState<string>();
  const sepia = useSepiaPaper(); const setSepia = useUi(s => s.setSepia);
  const scroll = useRef<HTMLDivElement>(null); const lastY = useRef(0); const restored = useRef(false);

  useEffect(() => {
    rpc.call('documents.get', { id: id! }).then(d => { setDoc(d as never); setSecId((d as { last_section_id?: string }).last_section_id ?? d.sections.find(s => s.progress < 1)?.id ?? d.sections[0]?.id); }, e => setErr(errorInfo(e).message));
    rpc.call('chat.open', { document_id: id! }).then(c => setConv(c.id), () => undefined);
  }, [id]);
  useEffect(() => {
    if (!secId) return; restored.current = false; let alive = true;
    const get = () => rpc.call('sections.get', { id: secId, with: ['translations'] }).then(c => { if (alive) setContent(c); }, e => { if (alive) setErr(errorInfo(e).message); });
    void get();
    // 刚导入、还在分词标注时就打开：句子还没有 tokens（词点不了）；标注做完文章会变（data.changed documents），再取一次
    const off = rpc.on('data.changed', d => { if (d.table === 'documents' && d.ids?.includes(id!)) void get(); });
    return () => { alive = false; off(); };
  }, [secId, id]);
  // 回到上次位置（R16）
  useEffect(() => {
    if (!content || !doc || restored.current) return; restored.current = true;
    const sec = doc.sections.find(s => s.id === content.id); const el = scroll.current;
    if (el && sec && sec.progress > 0.02 && sec.progress < 1) requestAnimationFrame(() => { el.scrollTop = (el.scrollHeight - el.clientHeight) * sec.progress; });
  }, [content, doc]);

  const save = useMemo(() => throttle((sid: string, p: number, sentence_id: string) => { void rpc.call('sections.progress', { id: sid, sentence_id, progress: p }).catch(() => undefined); }, 1500), []);
  const onScroll = useCallback(() => {
    const el = scroll.current; if (!el || !content) return;
    const y = el.scrollTop; onImmersive(y > lastY.current + 4 && y > 80 ? true : y < lastY.current - 4 ? false : (document.querySelector('.phone.imm') !== null)); lastY.current = y;
    const p = el.scrollHeight <= el.clientHeight ? 1 : y / (el.scrollHeight - el.clientHeight);
    const bar = document.querySelector<HTMLElement>('.rdprog i'); if (bar) bar.style.width = `${Math.round(p * 100)}%`;
    const top = el.getBoundingClientRect().top + 60; let sid = content.sentences[0]?.id;
    for (const s of el.querySelectorAll<HTMLElement>('[data-sid]')) { if (s.getBoundingClientRect().bottom >= top) { sid = s.dataset.sid; break; } }
    if (sid) save(content.id, Math.min(1, Math.max(0, p)), sid);
  }, [content, save, onImmersive]);

  const onWord = useCallback((_ev: React.MouseEvent<HTMLSpanElement>, word: string, _lemma: string, sentence: Sentence, s: number) => setCard({ word, sentence, s }), []);
  const toggleTr = async () => {
    if (!content) return;
    if (!tr && !content.sentences.some(s => s.translation)) {
      try { await rpc.call('sections.translate', { id: content.id }); toast(tl('正在翻译，好了会显示')); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); return; }
    }
    setTr(t => !t);
  };
  useEffect(() => rpc.on('task.done', () => { if (tr && secId) void rpc.call('sections.get', { id: secId, with: ['translations'] }).then(setContent); }), [tr, secId]);
  const readAloud = async () => {
    if (reading) { void import('../lib/tts').then(t => t.stop()); setReading(false); return; }
    if (!content) return; setReading(true);
    const t = await import('../lib/tts'); const tok = t.token() + 1;
    for (const s of content.sentences) { await t.say(s.text); if (t.isStale(tok)) break; }
    setReading(false);
  };
  const finish = async (markRest: boolean) => {
    if (!content) return;
    try {
      const r = await rpc.call('sections.finish', { id: content.id, mark_rest_known: markRest });
      if (r.marked > 0 && r.undo) toast(tl('已把 {marked} 个生词标为已知', { marked: r.marked }), { action: { label: tl('撤销'), run: () => void rpc.call('system.undo', { undo_id: r.undo!.undo_id }) } }); else toast(tl('读完了'));
      const idx = doc?.sections.findIndex(s => s.id === content.id) ?? -1; const next = doc?.sections[idx + 1];
      if (next) { setSecId(next.id); scroll.current?.scrollTo({ top: 0 }); } else nav('/library');
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  if (err) return <div className="screen"><div className="topgap" /><Empty title={tl('打不开这篇文章')} text={err} action={<button className="btn sm" onClick={() => nav('/library')}>{tl('回到书架')}</button>} /></div>;
  const counts = content?.counts; const left = counts ? counts.new + counts.unsure : 0;
  const sec = doc?.sections.find(s => s.id === secId);
  return <>
    <div className="top rdtop"><button className="ib" aria-label={tl('返回')} onClick={() => nav(-1)}><ChevronLeft size={22} /></button><span className="sp" />
      <button className="ib" aria-label={tl('标注说明')} onClick={() => setLegend(true)}><Info size={19} /></button></div>
    <div className="rdprog"><i style={{ width: 0 }} /></div>
    <div className={`screen${gloss ? ' gl' : ''}`} id="s-read" ref={scroll} onScroll={onScroll}>
      {doc && content && <>
        <div className="rd" style={{ paddingBottom: 0 }}>
          <div className="meta"><span>{GENRE_NAMES[doc.genre] ?? doc.genre} · {fmtMinutes(doc.minutes)} · {tl('生词率 {p}', { p: fmtPct(doc.unknown_ratio) })}</span>
            {doc.sections.length > 1 && <span>{tl('第 {i} / {n} 章', { i: (sec?.idx ?? 0) + 1, n: doc.sections.length })}</span>}</div>
          {(sec?.idx ?? 0) === 0 && <h1>{doc.title}</h1>}
        </div>
        <SectionView content={content} mode="all" gloss={gloss} overrides={overrides} selected={card ? { sentence: card.sentence.id, s: card.s } : undefined} translations={tr} onWord={onWord} />
        <div className="rd" style={{ paddingTop: 0 }}><div className="endc">
          <h3>{tl('读完了？')}</h3>
          <p>{left > 0 ? tl('还有 {n} 个生词没处理。标为已知后不进复习，可随时改回。', { n: left }) : tl('这一篇的生词都处理过了。')}</p>
          <div className="col">{left > 0 && <button className="btn pri" onClick={() => void finish(true)}>{tl('标为已知并读完')}</button>}<button className="btn" onClick={() => void finish(false)}>{tl('读完了')}</button></div>
        </div></div>
        <div style={{ height: 'calc(90px + var(--sab))' }} />
      </>}
    </div>
    <div className="rdbar">
      <button aria-pressed={tr} onClick={() => void toggleTr()}><Languages />{tl('译文')}</button>
      <button aria-pressed={gloss} onClick={() => setGloss(g => !g)}><Type />{tl('释义')}</button>
      <button aria-pressed={reading} onClick={() => void readAloud()}><Volume2 />{tl('朗读')}</button>
      <button aria-pressed={sepia} onClick={() => setSepia(!sepia)}><Eye />{tl('护眼')}</button>
      <button className="tibi" onClick={() => setTibi('open')}><Sparkles />Tibi</button>
    </div>
    <WordSheet card={card} onClose={() => setCard(undefined)} onStatus={(t, s) => setOverrides(m => new Map(m).set(t, s))}
      onAsk={w => { setCard(undefined); setTibi({ key: `${Date.now()}`, text: tl('「{w}」在这句话里是什么意思？用法上要注意什么？', { w }) }); }} />
    <Sheet open={!!tibi} onClose={() => setTibi(undefined)} tall className="chat">
      <h2>{tl('问 Tibi')}</h2>
      <TibiChat conv={conv} pending={typeof tibi === 'object' ? tibi : undefined} context={content && id ? { page: 'reader', document_id: id, section_id: content.id } : undefined} />
    </Sheet>
    <Sheet open={legend} onClose={() => setLegend(false)}>
      <h2>{tl('标注说明')}</h2>
      <div className="lgs">
        <div className="row"><span className="ex"><span className="w s0">word</span></span><span>{tl('生词：点开会加入复习')}</span></div>
        <div className="row"><span className="ex"><span className="w s1">word</span></span><span>{tl('学习中：越熟颜色越浅')}</span></div>
        <div className="row"><span className="ex"><span className="w s99">word</span></span><span>{tl('待确认：按你的词汇量估计可能认识')}</span></div>
      </div>
    </Sheet>
  </>;
}

function TibiChat({ conv, pending, context }: { conv?: string; pending?: { key: string; text: string }; context?: Parameters<typeof Thread>[0]['context'] }) {
  const [text, setText] = useState(''); const send = useRef<((t: string) => void) | undefined>(undefined);
  const onAsk = useCallback((s: (t: string) => void) => { send.current = s; }, []);
  return <>
    <div className="msgs"><Thread conversationId={conv} context={context} pending={pending} onAsk={onAsk} /></div>
    <div className="in"><input value={text} onChange={e => setText(e.target.value)} placeholder={tl('继续问 Tibi…')} enterKeyHint="send" onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && text.trim()) { send.current?.(text); setText(''); } }} />
      <button className="btn sm pri" disabled={!text.trim()} onClick={() => { send.current?.(text); setText(''); }}>{tl('发送')}</button></div>
  </>;
}

/** 词卡面板（J5）：AI 语境释义、词典、六档熟练度、忽略、问 Tibi */
function WordSheet({ card, onClose, onStatus, onAsk }: { card?: { word: string; sentence: Sentence }; onClose: () => void; onStatus: (text: string, s: Status) => void; onAsk: (w: string) => void }) {
  const [data, setData] = useState<Result<'terms.lookup'>>();
  const [status, setStatus] = useState<Status>();
  const [ctxm, setCtxm] = useState<string>();
  const modelOk = useCore(s => !!s.status?.models.ok);
  const [detail, setDetail] = useState<Result<'terms.get'>>();
  useEffect(() => { setDetail(undefined); const tid = data?.term?.id; if (tid) rpc.call('terms.get', { id: tid }).then(setDetail, () => undefined); }, [data?.term?.id]);
  useEffect(() => {
    if (!card) return; let alive = true; setData(undefined); setCtxm(undefined);
    rpc.call('terms.lookup', { text: card.word, sentence_id: card.sentence.id }).then(r => {
      if (!alive) return; setData(r); setStatus(r.term?.status);
      if (r.term && r.status_change) onStatus(r.term.text, r.status_change.to);
      if (r.context_meaning) setCtxm(r.context_meaning);
      else if (modelOk && (r.dict || r.term)) rpc.call('terms.context_meaning', { text: card.word, sentence_id: card.sentence.id }).then(m => { if (alive) setCtxm(m.meaning); }, () => undefined);
    }, e => toast(errorInfo(e).message, { kind: 'err' }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, modelOk]);
  const setS = async (s: Status) => {
    const tid = data?.term?.id; if (!tid) return;
    try { await rpc.call('terms.setStatus', { ids: [tid], status: s, source: 'user' }); setStatus(s); onStatus(data!.term!.text, s); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const head = data?.term?.display ?? data?.dict?.word ?? card?.word ?? '';
  return (
    <Sheet open={!!card} onClose={onClose} className="wc">
      <div className="h"><b>{head}</b>{data?.dict?.phonetic && <span className="ipa">/{data.dict.phonetic}/</span>}<button className="say" aria-label={tl('发音')} onClick={() => speak(head)}><Volume2 /></button></div>
      {data?.card_created && <div className="added">{tl('已加入复习')}<button onClick={() => void setS(97 as Status)}>{tl('其实认识')}</button></div>}
      {(ctxm || modelOk) && <div className="ai"><span className="tag">✦ {tl('在这句里')}</span>{ctxm ?? '…'}</div>}
      <div className="dict">{data?.term?.meaning || data?.dict?.translation || (data && !data.dict ? tl('词典里没有这个词') : '')}</div>
      <div className="stages">{([0, 1, 2, 3, 4, 5] as Status[]).map(s => <button key={s} data-s={s} className={`${status === s ? 'on' : ''}${status !== undefined && status <= 5 && s <= status ? ' fill' : ''}`} onClick={() => void setS(s)}><i />{STATUS_NAMES[s]}</button>)}</div>
      <div className="row"><button className="btn" onClick={() => void setS(98 as Status)}>{tl('忽略')}</button><button className="btn tint" onClick={() => onAsk(head)}>{tl('问 Tibi')}</button></div>
      <div className="hint">{tl('上拉看遇到过的句子')}</div>
      {/* 上拉全屏后（J5）：遇到过的句子和复习数据 */}
      <div className="more">
        <h4>{tl('遇到过的句子')}</h4>
        {detail?.contexts.length ? detail.contexts.slice(0, 8).map(c => <div key={c.id} className="ctx">{c.sentence}<small>{c.document_title ?? ''}</small></div>) : <div className="lbl">{tl('还没有')}</div>}
        {detail?.card && <><h4 style={{ marginTop: 14 }}>{tl('复习')}</h4><div className="lbl">{tl('复习 {reps} 次 · 忘了 {lapses} 次', { reps: detail.card.reps, lapses: detail.card.lapses })}</div></>}
      </div>
    </Sheet>
  );
}
