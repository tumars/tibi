import { SpeakButtons } from '../components/Speak';
import { Mascot } from '../components/Mascot';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { speak, isImeKey } from '../lib/util';
import { errorInfo, rpc, type Result } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';

/**
 * 练习（G8 / R6，不计分，成绩记 practice_logs；00 §3.3）：听写原句、拼写、易混词辨析、造句（Tibi 批改）。
 * 句子来自最近复习 / 错词 / 难词；每轮 5 题，结束显示准确率和"再来一轮"。
 */
export type Mode = 'dictation' | 'spell' | 'confusable' | 'produce';
export type Source = 'recent' | 'mistakes' | 'leech';
export type Item = Result<'practice.start'>['items'][number];
export const MODES: { key: Mode; label: string; desc: string }[] = [
  { key: 'dictation', label: tl('听写原句'), desc: tl('听你读过的句子，写下整句') },
  { key: 'spell', label: tl('拼写'), desc: tl('看中文释义和字母数，拼出单词') },
  { key: 'confusable', label: tl('易混词'), desc: tl('在句子里二选一') },
  { key: 'produce', label: tl('造句'), desc: tl('用目标词写一句，Tibi 批改') },
];
export const SOURCES: { key: Source; label: string }[] = [{ key: 'recent', label: tl('最近的词') }, { key: 'mistakes', label: tl('这周答错的') }, { key: 'leech', label: tl('难词') }];

/** 听写：按词对齐（LCS），返回每个原词是否写对，和准确率 */
function alignWords(target: string, typed: string): { words: { w: string; ok: boolean }[]; accuracy: number } {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).filter(Boolean);
  const a = target.split(/\s+/).filter(Boolean); const an = norm(target); const b = norm(typed);
  const dp = Array.from({ length: an.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = an.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = an[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const hit = new Set<number>(); let i = 0, j = 0;
  while (i < an.length && j < b.length) { if (an[i] === b[j]) { hit.add(i); i++; j++; } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++; else j++; }
  const words = a.map((w, k) => ({ w, ok: an[k] === undefined || hit.has(k) }));
  return { words, accuracy: an.length ? Math.round((hit.size / an.length) * 100) : 0 };
}

export function Practice({ initialMode = 'dictation', initialSource = 'recent' }: { initialMode?: Mode; initialSource?: Source } = {}) {
  const nav = useNavigate();
  const modelOk = useCore(s => !!s.status?.models.ok);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [source, setSource] = useState<Source>(initialSource);
  const [run, setRun] = useState<{ id: string; items: Item[]; idx: number; results: { item_id: string; accuracy: number; duration_ms: number }[] }>();
  const [answer, setAnswer] = useState('');
  const [checked, setChecked] = useState<{ accuracy: number; detail?: React.ReactNode }>();
  const [done, setDone] = useState<Result<'practice.finish'>>();
  const [busy, setBusy] = useState(false);
  const [gradeIssue, setGradeIssue] = useState<'nomodel' | 'failed'>();
  const [skipped, setSkipped] = useState(0);
  const t0 = useRef(Date.now());
  const item = run?.items[run.idx];

  const start = async () => {
    setDone(undefined); setChecked(undefined); setAnswer(''); setGradeIssue(undefined);
    try {
      const r = await rpc.call('practice.start', { mode, source, count: 5 });
      if (!r.items.length) { toast(source === 'recent' ? tl('生词本里还没有能练的词（听写和易混词需要读过的句子）') : tl('这里还没有能练的词')); return; }
      setRun({ id: r.practice_id, items: r.items, idx: 0, results: [] }); t0.current = Date.now();
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  useEffect(() => { if (item && mode === 'dictation' && !checked) speak(item.sentence); if (item && mode === 'spell' && !checked && item.answer) speak(item.answer); }, [item, mode, checked]);

  const check = async (choice?: string) => {
    if (!item || checked) return;
    if (mode === 'dictation') { const r = alignWords(item.sentence, answer); setChecked({ accuracy: r.accuracy, detail: <p className="dict-diff">{r.words.map((w, i) => <span key={i} className={w.ok ? '' : 'miss'}>{w.w} </span>)}</p> }); return; }
    if (mode === 'spell') { const ok = answer.trim().toLowerCase() === (item.answer ?? '').toLowerCase(); setChecked({ accuracy: ok ? 100 : 0, detail: <p>{ok ? tl('拼对了') : <>{tl('正确拼写：')}<b>{item.answer}</b></>}</p> }); return; }
    if (mode === 'confusable') { const ok = choice === item.answer; setChecked({ accuracy: ok ? 100 : 0, detail: <p>{ok ? tl('选对了。') : <>{tl('应该是')} <b>{item.answer}</b>{tl('。')}</>}{item.explain ? ` ${item.explain}` : ''}</p> }); return; }
    // 造句：交给 Tibi 批改
    if (!answer.trim()) return;
    if (!modelOk) { setGradeIssue('nomodel'); return; }
    setBusy(true); setGradeIssue(undefined);
    try {
      const g = await rpc.call('practice.grade', { word: item.answer ?? '', text: answer, sentence: item.sentence || undefined });
      setChecked({ accuracy: g.score, detail: <><p><b>{tl('{score} 分', { score: g.score })}</b>{tl('{v0}。{feedback}', { v0: g.ok ? '' : tl(' · 目标词用得不太对'), feedback: g.feedback })}</p>{g.better && g.better !== answer.trim() && <p className="better">{g.better}</p>}</> });
    } catch (e) { const i = errorInfo(e); setGradeIssue(i.code === 'model_unavailable' ? 'nomodel' : 'failed'); toast(i.message, { kind: 'err' }); }
    setBusy(false);
  };
  // 批改过的题才进 results；跳过的题不算成绩
  const advance = async (cur: NonNullable<typeof run>, results: typeof cur.results) => {
    setGradeIssue(undefined);
    if (cur.idx + 1 >= cur.items.length) {
      try {
        const r = await rpc.call('practice.finish', { practice_id: cur.id, results });
        if (results.length) { setSkipped(cur.items.length - results.length); setDone(r); } else toast(tl('这一轮没有批改的题，不记成绩'));
      } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
      setRun(undefined); return;
    }
    setRun({ ...cur, idx: cur.idx + 1, results }); setAnswer(''); setChecked(undefined); t0.current = Date.now();
  };
  const next = async () => {
    if (!run || !item || !checked) return;
    await advance(run, [...run.results, { item_id: item.id, accuracy: checked.accuracy, duration_ms: Date.now() - t0.current }]);
  };
  const connectModel = () => nav('/welcome?step=3&back=%2Freview%3Ftab%3Dpractice');

  if (done) return <div className="rvcard pdone">
    {done.accuracy >= 80 && <div className="pstk"><Mascot id="sticker-1" /></div>}
    <h3>{tl('这一轮练完了')}</h3>
    <p className="big">{Math.round(done.accuracy)}%</p>
    <p className="lbl">{tl('准确率 · 用时 {v0} 秒', { v0: Math.round(done.duration_ms / 1000) })}{mode === 'dictation' && done.best.rounds > 1 ? tl(' · 听写最好 {v0}%', { v0: Math.round(done.best.dictation_accuracy) }) : ''}{skipped ? tl(' · 跳过 {v0} 题', { v0: skipped }) : ''}{tl('。练习不影响复习排期。')}</p>
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}><button className="btn pri" onClick={start}>{tl('再来一轮')}</button><button className="btn" onClick={() => setDone(undefined)}>{tl('换个练法')}</button></div>
  </div>;

  if (!run || !item) return <div className="pstart">
    <div className="pmodes">{MODES.map(m => <button key={m.key} className={mode === m.key ? 'on' : ''} onClick={() => setMode(m.key)}><b>{m.label}</b><span>{m.desc}</span></button>)}</div>
    <div className="psrc"><span className="lbl">{tl('词从哪来')}</span><div className="seg">{SOURCES.map(s => <button key={s.key} className={source === s.key ? 'on' : ''} onClick={() => setSource(s.key)}>{s.label}</button>)}</div></div>
    <button className="btn pri" style={{ height: 44 }} disabled={mode === 'produce' && !modelOk} onClick={start}>{tl('开始 · 5 题')}</button>
    <p className="lbl">{tl('练习不计分，不影响复习排期；成绩单独记录。')}{mode === 'produce' && !modelOk && <>{tl('造句要连接模型才能批改。')}<button className="linkbtn" onClick={connectModel}>{tl('去连接')}</button></>}</p>
  </div>;

  return <div className="rvcard practice">
    <div className="k"><span>{tl('{mode} · 第 {i} / {n} 题', { mode: MODES.find(m => m.key === mode)!.label, i: run.idx + 1, n: run.items.length })}</span><span className="sp" />
      {(mode === 'dictation' || mode === 'spell') && <><span className="lbl">{tl('再听一遍')}</span><SpeakButtons text={mode === 'dictation' ? item.sentence : item.answer ?? ''} /></>}</div>
    {mode === 'dictation' && <p className="q">{tl('听句子，把整句写下来')}</p>}
    {mode === 'spell' && <><p className="q">{item.sentence || tl('（没有释义）')}</p><p className="lbl">{item.explain}</p></>}
    {mode === 'confusable' && <><p className="q">{tl('选一个填进去')}</p><p className="sent">{item.sentence}</p></>}
    {mode === 'produce' && <><p className="q">{tl('用')} <b>{item.answer}</b> {tl('写一句英文')}</p>{item.sentence && <p className="lbl">{tl('原文：{sentence}', { sentence: item.sentence })}</p>}</>}
    {mode === 'confusable'
      ? <div className="opts">{item.options?.map(o => <button key={o} className={`ropt${checked ? (o === item.answer ? ' ok' : ' dim') : ''}`} disabled={!!checked} onClick={() => void check(o)}>{o}</button>)}</div>
      : <textarea className="input pin" value={answer} autoFocus rows={mode === 'spell' ? 1 : 3} disabled={!!checked} onChange={e => setAnswer(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !isImeKey(e.nativeEvent)) { e.preventDefault(); if (checked) void next(); else void check(); } }} placeholder={mode === 'spell' ? tl('拼写') : mode === 'dictation' ? tl('听到什么写什么') : tl('写一句话')} />}
    {checked && <div className="pres">{checked.detail}</div>}
    {!checked && gradeIssue && <div className="pres"><p className="lbl">{gradeIssue === 'nomodel' ? <>{tl('没连模型，这题批改不了，也不会记成绩。')}<button className="linkbtn" onClick={connectModel}>{tl('去连接')}</button></> : tl('这次没批改成。可以再试一次，或者跳过这题。')}</p></div>}
    <div className="pfoot">{!checked ? (mode !== 'confusable' && <>{gradeIssue && <button className="btn" disabled={busy} onClick={() => void advance(run, run.results)}>{tl('跳过这题')}</button>}<button className="btn pri" disabled={busy || !answer.trim()} onClick={() => void check()}>{busy ? tl('正在批改…') : mode === 'produce' ? tl('请 Tibi 批改') : tl('检查')}</button></>) : <button className="btn pri" onClick={() => void next()}>{run.idx + 1 >= run.items.length ? tl('看结果') : tl('下一题')}</button>}</div>
  </div>;
}
