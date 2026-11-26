import type { Document, EpisodeChapter, PreVocabItem, SpokenExpression } from '@tibi/core';
import { ArrowUpRight, ListMusic, Play, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Mascot } from '../components/Mascot';
import { SummaryAdviceIcon, SummaryHardIcon, SummaryLevelIcon, SummaryOverviewIcon, SummaryPhrasesIcon, TibiAvatar } from '../components/TibiIcons';
import { InfoTip } from '../components/ui';
import { tl } from '../lib/i18n';
import { fmtClock } from '../lib/mediaSrc';
import { errorInfo, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';

const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

function cefrInfo(level?: string) {
  const m = level?.toUpperCase().match(/\b(A1|A2|B1|B2|C1|C2)\b/);
  const idx = m ? CEFR.indexOf(m[1] as (typeof CEFR)[number]) : -1;
  const tone = idx < 0 ? 'mid' : idx <= 1 ? 'easy' : idx <= 3 ? 'mid' : 'adv';
  return { idx, tone };
}

/**
 * 阅读器右侧"总结 / 导听"面板（00 §3.2、17 §3.2）：
 * - 文章/书：大意 → 级别 → 值得学的短语 → 长难句 → 学习建议
 * - 电台单集：导听大意 → 章节时间轴（点击直达）→ 听前关键词 → 地道口语表达（带时间戳）→ 级别 → 听读建议
 */
export function SummaryPanel({ doc, onClose, onPhrase, onSeek }: { doc: Document; onClose: () => void; onPhrase?: (text: string) => void; onSeek?: (ms: number) => void }) {
  const ai = doc.ai ?? {};
  const isEp = doc.kind === 'episode';
  const summary = ai.summary?.output as string | undefined;
  const advice = ai.advice?.output as string | undefined;
  const phrases = (ai.phrases?.output as { text: string; zh: string }[] | undefined) ?? [];
  const hard = (ai.hard_sentences?.output as { s: string; zh: string }[] | undefined) ?? [];
  const chapters = (ai.chapters?.output as EpisodeChapter[] | undefined) ?? [];
  const preVocab = (ai.pre_vocab?.output as PreVocabItem[] | undefined) ?? [];
  const spoken = (ai.spoken_expressions?.output as SpokenExpression[] | undefined) ?? [];
  const pregenerated = ai.summary?.model === 'bundled';
  const modelOk = useCore(st => !!st.status?.models.ok);
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (doc.ai_status !== 'running') setBusy(false); }, [doc.id, doc.ai_status]);
  const running = busy || doc.ai_status === 'running';
  const level = cefrInfo(doc.level);
  const panelTitle = isEp ? tl('导听') : tl('总结');

  const generate = async () => {
    if (!modelOk) { nav(`/welcome?step=3&back=${encodeURIComponent(location.hash.slice(1) || '/')}`); return; }
    setBusy(true);
    try {
      await rpc.call('documents.analyze', { id: doc.id });
      toast(isEp ? tl('正在生成导听与章节，好了会自动出现') : tl('正在生成总结，好了会自动出现'));
    } catch (e) {
      toast(errorInfo(e).message, { kind: 'err' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="rpanel" aria-label={panelTitle}>
      <div className="rph">
        <span className="rph-title">
          <SummaryOverviewIcon size={15} />
          {panelTitle}
        </span>
        {doc.level && <span className={`cefr-pill ${level.tone}`}>{doc.level}</span>}
        <span className="sp" />
        <button className="ibtn" title={tl('关闭')} onClick={onClose}><X size={16} /></button>
      </div>
      <div className="rpb">
        {summary ? (
          <section className="sum-card sum-overview">
            <h5 className="sum-hd">
              <TibiAvatar size={18} />
              <span>{isEp ? tl('本期导听') : tl('大意')}</span>
            </h5>
            <p className="sum-body">{summary}</p>
          </section>
        ) : (
          <section className="sum-card sum-empty">
            <Mascot id="onboarding-read" size={108} />
            <p className="muted">
              {running ? tl('正在生成…') : !modelOk ? tl('连接模型后可生成总结。') : doc.ai_status === 'failed' ? tl('上次生成未成功，请重试。') : isEp ? tl('暂无单集导听与章节。') : tl('暂无文章总结。')}
            </p>
            {!running && <button className="btn pri sm" onClick={generate}>{!modelOk ? tl('连接模型') : isEp ? tl('生成导听') : tl('生成总结')}</button>}
          </section>
        )}

        {chapters.length > 0 && (
          <section className="sum-section">
            <h5 className="sum-hd">
              <ListMusic size={14} />
              <span>{tl('章节时间轴')}</span>
              <span className="sp" />
              <span className="sum-count">{chapters.length}</span>
            </h5>
            <div className="chaplist">
              {chapters.map((c, i) => (
                <button key={`${c.start_ms}-${i}`} className="chapitem" onClick={() => onSeek?.(c.start_ms)}>
                  <span className="chap-ts"><Play size={9} />{fmtClock(c.start_ms)}</span>
                  <span className="chap-body">
                    <b>{c.title_zh}</b>
                    {c.summary && <span className="chap-sub">{c.summary}</span>}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {preVocab.length > 0 && (
          <section className="sum-section">
            <h5 className="sum-hd">
              <Sparkles size={14} />
              <span>{tl('听前关键词')}</span>
              <span className="sp" />
              <span className="sum-count">{preVocab.length}</span>
            </h5>
            <div className="plist">
              {preVocab.map(v => (
                <button key={v.text} className="pitem" onClick={() => { if (v.start_ms != null && onSeek) onSeek(v.start_ms); else onPhrase?.(v.text); }}>
                  <b>{v.text}</b>
                  <span>{v.zh}</span>
                  {v.start_ms != null ? <span className="pgo-ts">{fmtClock(v.start_ms)}</span> : <ArrowUpRight size={14} className="pgo" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </section>
        )}

        {spoken.length > 0 && (
          <section className="sum-section">
            <h5 className="sum-hd">
              <SummaryPhrasesIcon size={14} />
              <span>{tl('地道口语表达')}</span>
              <span className="sp" />
              <span className="sum-count">{spoken.length}</span>
            </h5>
            <div className="plist">
              {spoken.map(p => (
                <button key={p.text} className="pitem" onClick={() => { if (p.start_ms != null && onSeek) onSeek(p.start_ms); else onPhrase?.(p.text); }}>
                  <b>{p.text}</b>
                  <span>{p.zh}</span>
                  {p.start_ms != null ? <span className="pgo-ts">{fmtClock(p.start_ms)}</span> : <ArrowUpRight size={14} className="pgo" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </section>
        )}

        {doc.level && (
          <section className="sum-level-block">
            <h5 className="sum-hd">
              <SummaryLevelIcon size={14} />
              <span>{tl('级别')}</span>
              <InfoTip content={tl('按词频估算的 CEFR 文本难度级别。')} />
              <span className="sp" />
              <span className={`cefr-pill ${level.tone}`}>{doc.level}</span>
            </h5>
            {level.idx >= 0 && (
              <div className="cefr-scale" aria-hidden="true">
                {CEFR.map((code, i) => (
                  <div key={code} className={`cefr-step ${level.tone}${i < level.idx ? ' past' : i === level.idx ? ' cur' : ''}`}>
                    <i />
                    <span>{code}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {phrases.length > 0 && (
          <section className="sum-section">
            <h5 className="sum-hd">
              <SummaryPhrasesIcon size={14} />
              <span>{tl('值得学的短语')}</span>
              <span className="sp" />
              <span className="sum-count">{phrases.length}</span>
            </h5>
            <div className="plist">
              {phrases.map(p => (
                <button key={p.text} className="pitem" onClick={() => onPhrase?.(p.text)}>
                  <b>{p.text}</b>
                  <span>{p.zh}</span>
                  <ArrowUpRight size={14} className="pgo" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        )}

        {hard.length > 0 && (
          <section className="sum-section">
            <h5 className="sum-hd">
              <SummaryHardIcon size={14} />
              <span>{tl('长难句')}</span>
              <span className="sp" />
              <span className="sum-count">{hard.length}</span>
            </h5>
            <div className="hard-list">
              {hard.map(h => (
                <div key={h.s} className="hard-card">
                  <p className="quote">{h.s}</p>
                  <p className="tr">{h.zh}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {advice && (
          <section className="sum-card sum-advice">
            <h5 className="sum-hd">
              <SummaryAdviceIcon size={14} />
              <span>{isEp ? tl('听读建议') : tl('学习建议')}</span>
            </h5>
            <p className="sum-body">{advice}</p>
          </section>
        )}
      </div>
      {summary && (
        <div className="rpf">
          <TibiAvatar size={16} />
          <span>{pregenerated ? tl('示例文章自带') : <>{tl('Tibi 生成 ·')} <button className="linkbtn" disabled={running} onClick={generate}>{running ? tl('正在重新生成…') : tl('重新生成')}</button></>}</span>
        </div>
      )}
    </aside>
  );
}
