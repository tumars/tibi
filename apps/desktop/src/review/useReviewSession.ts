import type { AnswerResult, QueueItem, Rating, ReviewSession } from '@tibi/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tl } from '../lib/i18n';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';

/**
 * 一轮复习的状态与动作（00 §3.3，G1–G8），桌面复习页和手机复习页共用；界面各自画。
 * 作答不推进游标，看完评分行后调 next()（T15）。
 */
export type Phase = { kind: 'ask' } | { kind: 'reveal' } | { kind: 'answered'; result: AnswerResult; chosen?: string; typed?: string };
export interface StepResult { rating?: Rating; correct: boolean; retry: boolean; intro: boolean }

export function useReviewSession() {
  const [session, setSession] = useState<ReviewSession>();
  const [err, setErr] = useState<string>();
  const [phase, setPhase] = useState<Phase>({ kind: 'ask' });
  const [typed, setTyped] = useState('');
  const [hints, setHints] = useState(0);
  const [results, setResults] = useState<Record<number, StepResult>>({});
  const [done, setDone] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const t0 = useRef(Date.now()); const start = useRef(Date.now()); const told = useRef('');

  const load = useCallback(async (opts: Parameters<typeof rpc.call<'review.start'>>[1] = { resume: true }) => {
    setErr(undefined);
    try {
      let s = await rpc.call('review.start', opts);
      // 续上时游标停在已经答过的步（旧版界面没调 review.next）：先推进过去
      for (let i = 0; i < 50 && s.cursor < s.steps.length && s.steps[s.cursor]?.result && !s.steps[s.cursor]!.intro; i++) {
        await rpc.call('review.next', { session_id: s.session_id, step: s.steps[s.cursor]!.step });
        s = { ...s, cursor: s.cursor + 1 };
      }
      setSession(s); setDone(s.steps.length === 0 || s.cursor >= s.steps.length); setPhase({ kind: 'ask' }); setTyped(''); setHints(0); t0.current = Date.now(); start.current = Date.now();
      const r: Record<number, StepResult> = {}; s.steps.forEach(st => { if (st.result) r[st.step] = { rating: st.result.rating, correct: st.result.correct, retry: st.retry > 0, intro: st.intro }; }); setResults(r);
      // StrictMode 下会加载两次：同一轮只提示一次
      if (s.resumed && told.current !== s.session_id) { told.current = s.session_id; toast(tl('上次复习到一半，还剩 {v0} 张', { v0: s.steps.length - s.cursor })); }
    } catch (e) { setErr(errorInfo(e).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const item: QueueItem | undefined = session?.steps[session.cursor];

  const advance = useCallback((s: ReviewSession) => {
    const n = s.cursor + 1;
    if (n >= s.steps.length) { setDone(true); setElapsed(Date.now() - start.current); }
    setSession({ ...s, cursor: n }); setPhase({ kind: 'ask' }); setTyped(''); setHints(0); t0.current = Date.now();
  }, []);

  const answer = useCallback(async (a: { choice?: string; typed?: string; self_rating?: Rating }) => {
    if (!session || !item) return;
    try {
      const r = await rpc.call('review.answer', { session_id: session.session_id, step: item.step, answer: a, hints, duration_ms: Date.now() - t0.current });
      setResults(p => ({ ...p, [item.step]: { rating: r.rating, correct: r.correct, retry: item.retry > 0, intro: false } }));
      if (r.retry_step !== undefined && !session.steps.some(s => s.step === r.retry_step)) {
        // 答错插入的重练步：重新拉会话拿到完整步骤
        const s2 = await rpc.call('review.start', { resume: true }); setSession({ ...s2, cursor: session.cursor });
      }
      setPhase({ kind: 'answered', result: r, chosen: a.choice, typed: a.typed });
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, [session, item, hints]);

  const next = useCallback(async () => {
    if (!session || !item) return;
    try { await rpc.call('review.next', { session_id: session.session_id, step: item.step }); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); return; }
    advance(session);
  }, [session, item, advance]);

  const override = useCallback(async (rating: Rating) => {
    if (!session || !item || phase.kind !== 'answered') return;
    try { const r = await rpc.call('review.override', { session_id: session.session_id, step: item.step, rating }); setResults(p => ({ ...p, [item.step]: { ...p[item.step]!, rating } })); setPhase({ ...phase, result: r }); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, [session, item, phase]);

  const undo = useCallback(async () => {
    if (!session || session.cursor === 0) return;
    try { await rpc.call('review.undo', { session_id: session.session_id }); await load(); toast(tl('已撤销上一张')); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, [session, load]);

  const pause = useCallback(async () => { if (session) { try { await rpc.call('review.pause', { session_id: session.session_id }); } catch { /* 已结束 */ } } }, [session]);

  /** 做完后：答错的词再练一遍（不计分） */
  const drill = useCallback(async (term_ids: string[]) => {
    await load({});
    try { const s = await rpc.call('review.quiz', { term_ids }); setSession(s); setDone(false); setResults({}); setPhase({ kind: 'ask' }); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  }, [load]);

  /** 做完后：Tibi 写一篇用到这些词的短文 */
  const story = useCallback(async () => {
    if (!session) return;
    const ids = [...new Set(session.steps.filter(s => !s.intro).map(s => s.term.id))].slice(0, 12);
    try { await rpc.call('review.story', { term_ids: ids }); toast(tl('Tibi 正在写一篇用到这些词的短文，写好会放进书架')); } catch (e) { const i = errorInfo(e); toast(i.code === 'model_unavailable' ? tl('要连接模型才能写短文') : i.message, { kind: 'err' }); }
  }, [session]);

  const summary = () => {
    const graded = Object.entries(results).filter(([, r]) => !r.retry && !r.intro);
    const correct = graded.filter(([, r]) => r.correct).length;
    const wrong = session ? session.steps.filter(s => results[s.step] && !results[s.step]!.correct && !s.retry && !s.intro).map(s => s.term.id) : [];
    return { graded: graded.length, correctPct: graded.length ? Math.round(correct / graded.length * 100) : 0, minutes: Math.max(1, Math.round(elapsed / 60000)), wrong };
  };
  /** 进度条每一格的样式（cur / r1–r4 / ri / ro / rx / rt） */
  const segClass = (s: QueueItem) => { const res = results[s.step]; const cls = item && s.step === item.step ? 'cur' : res ? (s.intro ? 'ri' : res.retry ? (res.correct ? 'ro' : 'rx') : `r${res.rating ?? (res.correct ? 3 : 1)}`) : ''; return `${cls}${s.retry ? ' rt' : ''}`; };

  return { session, err, phase, setPhase, typed, setTyped, hints, setHints, results, done, elapsed, item, load, answer, next, override, undo, pause, drill, story, summary, segClass };
}
