import type { Document, EpisodeChapter, SectionContent } from '@tibi/core';
import { Eye, EyeOff, LoaderCircle, Pause, Play, Repeat, RotateCcw, RotateCw, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, type RefObject } from 'react';
import { Badge, InfoTip } from '../components/ui';
import { tl } from '../lib/i18n';
import { fmtClock, useMediaSrcReady } from '../lib/mediaSrc';
import { useAudio } from '../store/audio';

/**
 * 电台单集听读控制条（17 §2.3）：
 * - 进度条 + 章节刻度标记 + A-B 复读区间高亮
 * - 上/下一句、-5s/+5s、播放/暂停、倍速（0.6x–2.0x）、单句循环（L）、A-B 复读、句间停顿（0–3s）、盲听开关（B）
 * - 键盘快捷键：Space / ← / → / [ / ] / R / L / B / V（输入框内自动避让）
 */
const SPEEDS = [0.6, 0.75, 0.9, 1, 1.15, 1.25, 1.5, 1.75, 2];
const GAPS = [0, 1, 2, 3];

export function EpisodePlayer({ doc, content, scrollerRef }: { doc: Document; content?: SectionContent; scrollerRef: RefObject<HTMLElement | null> }) {
  const mediaReady = useMediaSrcReady();
  const docId = useAudio(s => s.docId);
  const playing = useAudio(s => s.playing);
  const loading = useAudio(s => s.loading);
  const error = useAudio(s => s.error);
  const currentMs = useAudio(s => s.currentMs);
  const durationMs = useAudio(s => s.durationMs);
  const rate = useAudio(s => s.rate);
  const activeSentenceId = useAudio(s => s.activeSentenceId);
  const loopSentenceId = useAudio(s => s.loopSentenceId);
  const abLoop = useAudio(s => s.abLoop);
  const gapSec = useAudio(s => s.gapSec);
  const blindMode = useAudio(s => s.blindMode);

  // 加载或同步当前单集到全局播放器
  useEffect(() => {
    if (doc.kind !== 'episode') return;
    useAudio.getState().loadEpisode(doc, content?.sentences);
  }, [doc, content?.sentences, mediaReady]);

  // 当前播放句自动高亮并平滑滚到视野中间
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || docId !== doc.id) return;
    scroller.querySelectorAll('.speaking').forEach(e => e.classList.remove('speaking'));
    if (!activeSentenceId) return;
    const el = scroller.querySelector<HTMLElement>(`[data-sid="${activeSentenceId}"]`);
    if (el) {
      el.classList.add('speaking');
      if (playing) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeSentenceId, playing, scrollerRef, docId, doc.id]);

  // 键盘快捷键（避开输入框与修饰键）
  useEffect(() => {
    if (doc.kind !== 'episode') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const st = useAudio.getState();
      if (st.docId !== doc.id) return;
      const k = e.key.toLowerCase();
      if (e.key === ' ' && !t?.closest('button, a')) { e.preventDefault(); st.toggle(); }
      else if (k === '[' || (e.key === 'ArrowLeft' && !t?.closest('[data-reader-body], [role="slider"]'))) { e.preventDefault(); st.skip(-5000); }
      else if (k === ']' || (e.key === 'ArrowRight' && !t?.closest('[data-reader-body], [role="slider"]'))) { e.preventDefault(); st.skip(5000); }
      else if (k === 'r') { e.preventDefault(); st.replaySentence(); }
      else if (k === 'l') { e.preventDefault(); st.toggleLoopSentence(); }
      else if (k === 'b') { e.preventDefault(); st.toggleBlind(); }
      else if (k === 'v' && st.blindMode && st.activeSentenceId) { e.preventDefault(); st.revealSentence(st.activeSentenceId); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [doc.id, doc.kind]);

  const chapters = (doc.ai?.chapters?.output as EpisodeChapter[] | undefined) ?? [];
  const pct = durationMs > 0 ? Math.min(100, Math.max(0, (currentMs / durationMs) * 100)) : 0;
  const abLabel = abLoop.aMs != null && abLoop.bMs != null ? 'A-B' : abLoop.aMs != null ? 'A→' : 'AB';

  return (
    <div className="epbar" role="region" aria-label={tl('电台播放器')}>
      <div className="epbar-inner">
        {error && <div className="epbar-err">{error}</div>}
      <div className="epbar-seek">
        <span className="epbar-t">{fmtClock(currentMs)}</span>
        <div
          className="epbar-track"
          role="slider"
          aria-label={tl('播放进度')}
          aria-valuemin={0}
          aria-valuemax={durationMs}
          aria-valuenow={currentMs}
          tabIndex={0}
          onClick={e => {
            if (!durationMs) return;
            const r = e.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
            useAudio.getState().seek(Math.round(ratio * durationMs));
          }}
          onKeyDown={e => {
            if (!durationMs) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); useAudio.getState().skip(-5000); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); useAudio.getState().skip(5000); }
            else if (e.key === 'Home') { e.preventDefault(); useAudio.getState().seek(0); }
            else if (e.key === 'End') { e.preventDefault(); useAudio.getState().seek(durationMs); }
          }}
        >
          <div className="epbar-fill" style={{ width: `${pct}%` }} />
          {durationMs > 0 && abLoop.aMs != null && abLoop.bMs != null && (
            <div className="epbar-ab" style={{ left: `${(abLoop.aMs / durationMs) * 100}%`, width: `${((abLoop.bMs - abLoop.aMs) / durationMs) * 100}%` }} />
          )}
          {durationMs > 0 && chapters.map((c, i) => (
            <i
              key={`${c.start_ms}-${i}`}
              className="epbar-mark"
              style={{ left: `${Math.min(99, (c.start_ms / durationMs) * 100)}%` }}
              title={`${fmtClock(c.start_ms)} · ${c.title_zh}`}
              onClick={ev => { ev.stopPropagation(); useAudio.getState().seek(c.start_ms); }}
            />
          ))}
          <span className="epbar-thumb" style={{ left: `${pct}%` }} />
        </div>
        <span className="epbar-t">{durationMs > 0 ? fmtClock(durationMs) : '--:--'}</span>
      </div>

      <div className="epbar-ctl">
        <div className="epbar-grp">
          <button className="ibtn" title={tl('上一句')} onClick={() => useAudio.getState().jumpSentence(-1)}><SkipBack size={15} /></button>
          <button className="ibtn" title={tl('后退 5 秒（[）')} onClick={() => useAudio.getState().skip(-5000)}><RotateCcw size={15} /></button>
          <button className="epbar-play" title={playing ? tl('暂停（Space）') : tl('播放（Space）')} onClick={() => useAudio.getState().toggle()}>
            {loading ? <LoaderCircle size={17} className="ttsspin" /> : playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <button className="ibtn" title={tl('快进 5 秒（]）')} onClick={() => useAudio.getState().skip(5000)}><RotateCw size={15} /></button>
          <button className="ibtn" title={tl('下一句')} onClick={() => useAudio.getState().jumpSentence(1)}><SkipForward size={15} /></button>
        </div>

        <span className="vsep" />

        <div className="epbar-grp">
          <select className="input" value={rate} onChange={e => useAudio.getState().setRate(Number(e.target.value))} aria-label={tl('倍速')}>
            {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
          </select>
          <button className={`ibtn${loopSentenceId ? ' on' : ''}`} title={tl('单句循环（L）')} aria-pressed={!!loopSentenceId} onClick={() => useAudio.getState().toggleLoopSentence()}>
            <Repeat size={15} />
          </button>
          <button className={`ep-chip${abLoop.aMs != null ? ' on' : ''}`} title={abLoop.aMs == null ? tl('设 A-B 复读起点 A') : abLoop.bMs == null ? tl('设 A-B 复读终点 B') : tl('关闭 A-B 复读')} onClick={() => useAudio.getState().cycleAbLoop()}>
            {abLabel}
          </button>
          <select className="input" value={gapSec} onChange={e => useAudio.getState().setGapSec(Number(e.target.value))} aria-label={tl('句间停顿')}>
            {GAPS.map(g => <option key={g} value={g}>{g ? tl('停 {g} 秒', { g }) : tl('不停顿')}</option>)}
          </select>
        </div>

        <span className="vsep" />

        <button className={`ep-chip${blindMode ? ' on' : ''}`} title={tl('盲听模式（B）：模糊文本，点单句或按 V 揭晓')} aria-pressed={blindMode} onClick={() => useAudio.getState().toggleBlind()}>
          {blindMode ? <EyeOff size={13} /> : <Eye size={13} />}
          <span>{tl('盲听')}</span>
        </button>

        {doc.episode?.media_path && (
          <Badge tone="ok" title={tl('音频已缓存在本地，支持离线播放')}>{tl('已缓存')}</Badge>
        )}
        <InfoTip content={tl('点击句首播放键或时间戳跳转原声；查词时自动暂停，关闭词卡后继续播放；快捷键 Space 播放 / [ ] ±5秒 / L 单句循环 / B 盲听。')} />
      </div>
      </div>
    </div>
  );
}
