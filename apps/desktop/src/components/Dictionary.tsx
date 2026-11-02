import type { DictEntryResult, DictSuggestResult } from '@tibi/core';
import { BookA, Search, Sparkles, Volume2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clearRecentLookups, EXAM_NAMES, INFLECTION_NAMES, loadRecentLookups, parseGloss, posShares, rememberLookup } from '../lib/dict';
import { tl } from '../lib/i18n';
import { speak, STATUS_NAMES, isImeKey } from '../lib/util';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';
import './dict.css';

export interface DictionaryProps {
  /** 从别处带进来要查的词 */
  initial?: string;
  /** 手机：一列，先联想，选中后看词条 */
  compact?: boolean;
  onOpenDoc: (id: string) => void;
  onOpenTerm?: (id: string) => void;
  onAsk?: (text: string) => void;
}

/**
 * 词典（00 §3.14）：桌面词典页和手机"我 › 词典"共用。
 * 边输入边出联想，方向键移动时右边跟着换词条；只读，只有点"加入生词本"才写入。
 */
export function Dictionary({ initial, compact, onOpenDoc, onOpenTerm, onAsk }: DictionaryProps) {
  const [q, setQ] = useState(initial ?? '');
  const [sug, setSug] = useState<DictSuggestResult>();
  const [sel, setSel] = useState(0);
  /** 正在看的词；compact 下为空时显示联想 */
  const [word, setWord] = useState<string | undefined>(initial);
  const [data, setData] = useState<DictEntryResult>();
  const [recent, setRecent] = useState(loadRecentLookups);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const look = useCallback((w: string, text = true) => { setWord(w); if (text) setQ(w); setRecent(rememberLookup(w)); }, []);
  useEffect(() => { if (initial) look(initial); }, [initial, look]);
  // 不用 autoFocus：手机上抽屉还在屏幕外，浏览器会为了露出输入框把外层滚走
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);

  // 联想
  const skip = useRef(!!initial);
  useEffect(() => {
    const t = q.trim();
    if (!t) { setSug(undefined); setWord(undefined); return; }
    let live = true;
    const h = setTimeout(() => {
      rpc.call('dict.suggest', { q: t }).then(r => {
        if (!live) return;
        setSug(r); setSel(0);
        // 宽屏边输入边看第一条；从别处带词进来时已经定了词，不要换掉
        if (skip.current) { skip.current = false; return; }
        if (!compact) setWord(r.mode === 'similar' ? t : r.items[0]?.word ?? t);
      }, () => { if (live) setSug({ available: true, mode: 'prefix', items: [] }); });
    }, 100);
    return () => { live = false; clearTimeout(h); };
  }, [q, compact]);

  // 词条
  const load = useCallback((w: string, isLive: () => boolean = () => true) => rpc.call('dict.entry', { word: w }).then(r => { if (isLive()) setData(r); }, e => { if (isLive()) { setData(undefined); toast(errorInfo(e).message, { kind: 'err' }); } }), []);
  useEffect(() => {
    if (!word) { setData(undefined); return; }
    let live = true;
    void load(word, () => live);
    const off = rpc.on('data.changed', d => { if (d.table === 'terms') void load(word, () => live); });
    return () => { live = false; off(); };
  }, [word, load]);

  useEffect(() => { list.current?.querySelector('.dx-row.on')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const items = sug?.items ?? [];
  const onChange = (v: string) => { setQ(v); if (compact) setWord(undefined); };
  const onKey = (e: React.KeyboardEvent) => {
    if (isImeKey(e.nativeEvent)) return;
    const move = (d: number) => { e.preventDefault(); const i = Math.max(0, Math.min(items.length - 1, sel + d)); setSel(i); if (!compact && items[i]) setWord(items[i]!.word); };
    if (e.key === 'ArrowDown') move(1);
    else if (e.key === 'ArrowUp') move(-1);
    else if (e.key === 'Enter') { e.preventDefault(); const w = sug?.mode === 'similar' ? q.trim() : items[sel]?.word ?? q.trim(); if (w) look(w, !compact); }
    else if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation(); onChange(''); }
  };
  const clear = () => { onChange(''); input.current?.focus(); };

  const showList = !!q.trim() && (!compact || !word);
  const showEntry = !!word && (!compact || !!data);

  return (
    <div className={`dx${compact ? ' compact' : ''}`}>
      <label className="dx-in">
        <Search size={17} />
        <input ref={input} value={q} onChange={e => onChange(e.target.value)} onKeyDown={onKey} placeholder={tl('输入英文单词、短语或中文')} aria-label={tl('查词')} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        {q && <button className="ibtn" onClick={clear} aria-label={tl('清空')}><X /></button>}
      </label>
      {sug && !sug.available ? <div className="dx-none"><BookA size={22} /><b>{tl('这台设备上没有词典')}</b><span>{tl('词典文件没有装好，重新安装 Tibi 可以修复。')}</span></div> : !q.trim() ? (
        <Start recent={recent} onPick={look} onClear={() => { clearRecentLookups(); setRecent([]); }} />
      ) : (
        <div className="dx-body">
          {showList && <div className="dx-list" ref={list} role="listbox" aria-label={tl('联想')}>
            {sug?.mode === 'similar' && items.length > 0 && <div className="dx-hint">{tl('没有这个词，是不是要找：')}</div>}
            {items.map((it, i) => (
              <button key={it.word} role="option" aria-selected={i === sel} className={`dx-row${i === sel && sug?.mode !== 'similar' ? ' on' : ''}`} onMouseDown={e => e.preventDefault()} onClick={() => { setSel(i); look(it.word, compact || sug?.mode === 'similar'); }}>
                <b>{it.word}</b><span>{it.gloss}</span>
              </button>
            ))}
            {sug && !items.length && <div className="dx-hint">{tl('词典里没有找到')}</div>}
          </div>}
          {showEntry && data && <Entry data={data} word={word!} similarInList={showList && sug?.mode === 'similar'} onLook={w => look(w)} onOpenDoc={onOpenDoc} onOpenTerm={onOpenTerm} onAsk={onAsk} />}
        </div>
      )}
    </div>
  );
}

function Start({ recent, onPick, onClear }: { recent: string[]; onPick: (w: string) => void; onClear: () => void }) {
  if (!recent.length) return <div className="dx-none"><BookA size={22} /><b>{tl('查一个词')}</b><span>{tl('不用联网。可以输入变形（went）、中文（苹果），拼错了也会提示。')}</span></div>;
  return <div className="dx-recent">
    <div className="dx-sec"><span>{tl('最近查过')}</span><button className="linkbtn" onClick={onClear}>{tl('清除')}</button></div>
    <div className="dx-chips">{recent.map(w => <button key={w} onClick={() => onPick(w)}>{w}</button>)}</div>
  </div>;
}

function Entry({ data, word, similarInList, onLook, onOpenDoc, onOpenTerm, onAsk }: { data: DictEntryResult; word: string; similarInList: boolean; onLook: (w: string) => void } & Pick<DictionaryProps, 'onOpenDoc' | 'onOpenTerm' | 'onAsk'>) {
  const { entry, term, lemma } = data;
  const [busy, setBusy] = useState(false);
  const head = entry?.word ?? term?.display ?? word;
  const known = term && term.status <= 5 && (data.in_wordbook || term.status === 5);

  const add = async () => {
    setBusy(true);
    try {
      const r = await rpc.call('terms.add', { entries: [{ text: lemma }] });
      const undo = r.undo;
      toast(tl('已加入生词本：{w}', { w: lemma }), undo && r.created.length ? { action: { label: tl('撤销'), run: () => void rpc.call('system.undo', { undo_id: undo.undo_id }).catch(e => toast(errorInfo(e).message, { kind: 'err' })) } } : undefined);
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } finally { setBusy(false); }
  };

  if (!entry && !term) return <div className="dx-entry">
    <h1 className="dx-word">{word}</h1>
    <p className="lbl">{tl('词典里没有这个词。')}</p>
    {data.similar.length > 0 && !similarInList && <><div className="dx-sec"><span>{tl('是不是要找')}</span></div><div className="dx-chips">{data.similar.map(s => <button key={s.word} onClick={() => onLook(s.word)} title={s.gloss}>{s.word}</button>)}</div></>}
    {onAsk && <div className="dx-acts"><button className="btn" onClick={() => onAsk(tl('“{w}”是什么意思？', { w: word }))}><Sparkles size={14} />{tl('问 Tibi')}</button></div>}
    <Readings data={data} onOpenDoc={onOpenDoc} />
  </div>;

  const shares = posShares(entry?.pos);
  const lines = parseGloss(entry?.translation || term?.meaning || '');
  const defs = parseGloss(entry?.definition ?? '');
  return <div className="dx-entry">
    <div className="dx-head">
      <h1 className="dx-word">{head}</h1>
      {(entry?.phonetic ?? term?.ipa) && <span className="dx-ipa">/{entry?.phonetic ?? term?.ipa}/</span>}
      <button className="ibtn" onClick={() => speak(head)} title={tl('发音')} aria-label={tl('发音')}><Volume2 /></button>
    </div>
    {data.via && <div className="dx-via">{tl('“{v}”是变形，下面是原形', { v: data.via })}</div>}
    {entry?.base && <div className="dx-via">{tl('也是这个词的变形：')}<button className="linkbtn" onClick={() => onLook(entry.base!)}>{entry.base}</button></div>}
    {entry && (data.extras?.atlas?.cefr || entry.collins || entry.oxford || entry.exam.length > 0 || entry.frequency) ? <div className="dx-tags">
      {data.extras?.atlas?.cefr && <span className="tagc" title={tl('CEFR 等级，来自词光')}>{data.extras.atlas.cefr}</span>}
      {entry.collins ? <span className="tagc" title={tl('柯林斯星级')}>{'★'.repeat(entry.collins)}</span> : null}
      {entry.oxford && <span className="tagc">{tl('牛津 3000')}</span>}
      {entry.exam.map(x => <span key={x} className="tagc">{EXAM_NAMES[x] ?? x}</span>)}
      {entry.frequency ? <span className="tagc sys">{tl('词频第 {n}', { n: entry.frequency.toLocaleString() })}</span> : null}
    </div> : null}

    <div className="dx-acts">
      {known
        ? <><span className={`stage s${term!.status}`}>{STATUS_NAMES[term!.status]}</span>{onOpenTerm && <button className="btn sm" onClick={() => onOpenTerm(term!.id)}>{tl('在生词本里看')}</button>}</>
        : <><button className="btn pri" disabled={busy} onClick={() => void add()}>{lemma === head.toLowerCase() ? tl('加入生词本') : tl('把 {w} 加入生词本', { w: lemma })}</button>{term && term.status > 5 && <span className={`stage s${term.status}`}>{STATUS_NAMES[term.status]}</span>}</>}
      {onAsk && <button className="btn" onClick={() => onAsk(tl('讲讲 {w} 这个词：常见用法、搭配和容易混淆的词', { w: head }))}><Sparkles size={14} />{tl('问 Tibi')}</button>}
    </div>

    <div className="dx-gloss">{lines.map((l, i) => <div key={i}>{l.tag && <em>{l.tag}</em>}<span>{l.text}</span></div>)}</div>
    {shares && <div className="lbl dx-shares">{tl('常见词性：{v}', { v: shares })}</div>}
    {data.extras?.atlas?.tip && <div className="dx-tip"><b>{tl('辨析')}</b>{data.extras.atlas.tip}</div>}

    {entry?.inflections && entry.inflections.length > 0 && <>
      <div className="dx-sec"><span>{tl('词形')}</span></div>
      <div className="dx-forms">{entry.inflections.map(f => <button key={f.type + f.form} onClick={() => onLook(f.form)}><i>{INFLECTION_NAMES[f.type] ?? f.type}</i>{f.form}</button>)}</div>
    </>}
    <Readings data={data} onOpenDoc={onOpenDoc} />
    {data.extras && <Extras x={data.extras} head={head} onLook={onLook} />}
    {defs.length > 0 && <details className="dx-en"><summary>{tl('英文释义')}</summary><div className="dx-gloss">{defs.map((l, i) => <div key={i}>{l.tag && <em>{l.tag}</em>}<span>{l.text}</span></div>)}</div></details>}
  </div>;
}

const WordChips = ({ words, onLook }: { words: string[]; onLook: (w: string) => void }) => (
  // 词族写成 `adaptation (n.)`，查的时候去掉括号
  <div className="dx-chips">{words.map(w => <button key={w} onClick={() => onLook(w.replace(/\s*\([^)]*\)\s*$/, ''))}>{w}</button>)}</div>
);

/** 词光和 WordNet 的内容（T32）。来源写在最后：词光是 AI 生成、没有逐条审校的，要让人知道 */
function Extras({ x, head, onLook }: { x: NonNullable<DictEntryResult['extras']>; head: string; onLook: (w: string) => void }) {
  const a = x.atlas;
  const antonyms = [...new Set([...(a?.antonyms ?? []), ...x.antonyms])];
  return <>
    {x.word.toLowerCase() !== head.toLowerCase() && <div className="dx-via dx-extra-via">{tl('下面的内容属于原形 {w}', { w: x.word })}</div>}
    {a && a.examples.length > 0 && <>
      <div className="dx-sec"><span>{tl('例句')}</span></div>
      {a.examples.map(e => <div key={e.en} className="dx-ex"><span className="s">{e.en}</span>{e.zh && <span className="lbl">{e.zh}</span>}</div>)}
    </>}
    {a && a.collocations.length > 0 && <>
      <div className="dx-sec"><span>{tl('搭配')}</span></div>
      <div className="dx-cols">{a.collocations.map(c => <div key={c.en}><b>{c.en}</b>{c.zh && <span>{c.zh}</span>}</div>)}</div>
    </>}
    {a && a.synonyms.length > 0 && <><div className="dx-sec"><span>{tl('近义词')}</span></div><WordChips words={a.synonyms} onLook={onLook} /></>}
    {antonyms.length > 0 && <><div className="dx-sec"><span>{tl('反义词')}</span></div><WordChips words={antonyms} onLook={onLook} /></>}
    {a && a.family.length > 0 && <><div className="dx-sec"><span>{tl('词族')}</span></div><WordChips words={a.family} onLook={onLook} /></>}
    {x.senses.length > 0 && <>
      <div className="dx-sec"><span>{tl('英文义项与同义词')}</span></div>
      {x.senses.map(s => <div key={s.pos + s.definition} className="dx-sense">
        <div className="dx-gloss"><div><em>{s.pos}.</em><span>{s.definition}</span></div></div>
        {s.examples[0] && <div className="s">{s.examples[0]}</div>}
        {s.synonyms.length > 0 && <WordChips words={s.synonyms} onLook={onLook} />}
      </div>)}
    </>}
    <div className="lbl dx-credit">
      {a && <div>{tl('例句、搭配、词族和辨析来自词光 Word Atlas（CC BY 4.0），由 AI 生成，未逐条审校。')}</div>}
      {x.senses.length + x.antonyms.length > 0 && <div>{tl('英文义项和同义词来自 Open English WordNet（CC BY 4.0）。')}</div>}
    </div>
  </>;
}

/** 命中处 ⟦ ⟧ → 荧光笔；顺手去掉 Markdown 记号 */
const Snippet = ({ s }: { s: string }) => <>{s.replace(/[*`#>]+/g, '').split(/(⟦[^⟧]*⟧)/).map((p, i) => (p.startsWith('⟦') ? <mark key={i}>{p.slice(1, -1)}</mark> : p))}</>;

function Readings({ data, onOpenDoc }: { data: DictEntryResult; onOpenDoc: (id: string) => void }) {
  return <>
    <div className="dx-sec"><span>{tl('在你读过的文章里')}</span></div>
    {data.readings.length === 0 ? <div className="lbl">{tl('还没在你的文章里见过。')}</div> : data.readings.map(r => (
      <button key={r.document_id} className="dx-read" onClick={() => onOpenDoc(r.document_id)}>
        <span className="s"><Snippet s={r.snippet} /></span><span className="lbl">{r.title}</span>
      </button>
    ))}
  </>;
}
