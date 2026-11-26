import { Pause, Play, RotateCcw, RotateCw, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { fmtClock } from '../lib/mediaSrc';
import { tl } from '../lib/i18n';
import { useAudio } from '../store/audio';
import { CoverArt } from './CoverArt';

/**
 * 全局迷你播放器（17 §2.1）：离开当前正在播放的单集页面时自动浮现在主内容区底部，
 * 切换去生词本、词典或复习页不中断播放，点标题一键回到听读页。
 */
export function MiniPlayer() {
  const loc = useLocation();
  const nav = useNavigate();
  const docId = useAudio(s => s.docId);
  const title = useAudio(s => s.title);
  const author = useAudio(s => s.author);
  const cover = useAudio(s => s.cover);
  const playing = useAudio(s => s.playing);
  const currentMs = useAudio(s => s.currentMs);
  const durationMs = useAudio(s => s.durationMs);
  const caption = useAudio(s => (s.activeSentenceId ? s.lines.find(l => l.id === s.activeSentenceId)?.text : undefined));
  const toggle = useAudio(s => s.toggle);
  const skip = useAudio(s => s.skip);
  const close = useAudio(s => s.close);

  if (!docId || loc.pathname === `/read/${docId}` || loc.pathname.startsWith(`/read/${docId}/`)) return null;
  const pct = durationMs > 0 ? Math.min(100, (currentMs / durationMs) * 100) : 0;

  return (
    <div className="miniplayer" role="region" aria-label={tl('电台迷你播放器')}>
      <div className="mp-prog" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
      <button className="mp-info" onClick={() => nav(`/read/${docId}`)} title={tl('回到听读页')}>
        <span className="mp-art"><CoverArt src={cover} size={16} /></span>
        <span className="mp-text">
          <b className="mp-title">{title}</b>
          <span className="mp-sub">{caption || author || tl('电台听读')}</span>
        </span>
      </button>
      <span className="mp-time">{fmtClock(currentMs)}{durationMs > 0 ? ` / ${fmtClock(durationMs)}` : ''}</span>
      <div className="mp-ctl">
        <button className="ibtn" title={tl('后退 5 秒')} onClick={() => skip(-5000)}><RotateCcw size={15} /></button>
        <button className="mp-play" title={playing ? tl('暂停') : tl('播放')} onClick={toggle}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button className="ibtn" title={tl('快进 5 秒')} onClick={() => skip(5000)}><RotateCw size={15} /></button>
        <button className="ibtn" title={tl('关闭播放器')} onClick={close}><X size={15} /></button>
      </div>
    </div>
  );
}
