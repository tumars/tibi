import type { Document } from '@tibi/core';
import { ArrowUpRight, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Mascot } from '../components/Mascot';
import { SummaryAdviceIcon, SummaryHardIcon, SummaryLevelIcon, SummaryOverviewIcon, SummaryPhrasesIcon, TibiAvatar } from '../components/TibiIcons';
import { errorInfo, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';

const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

function cefrInfo(level?: string) {
  const m = level?.toUpperCase().match(/\b(A1|A2|B1|B2|C1|C2)\b/);
  const idx = m ? CEFR.indexOf(m[1] as (typeof CEFR)[number]) : -1;
  const tone = idx < 0 ? 'mid' : idx <= 1 ? 'easy' : idx <= 3 ? 'mid' : 'adv';
  return { idx, tone };
}

/**
 * 阅读器右侧"总结"面板（00 §3.2、原型 reader.html 的 pane-sum）：总结 → 级别 → 值得学的短语 → 长难句 → 学习建议。
 * 内置示例带预生成结果；用户的文章和书导入时不自动生成，在这里手动生成。
 */
export function SummaryPanel({ doc, onClose, onPhrase }: { doc: Document; onClose: () => void; onPhrase?: (text: string) => void }) {
  const ai = doc.ai ?? {};
  const summary = ai.summary?.output as string | undefined;
  const advice = ai.advice?.output as string | undefined;
  const phrases = (ai.phrases?.output as { text: string; zh: string }[] | undefined) ?? [];
  const hard = (ai.hard_sentences?.output as { s: string; zh: string }[] | undefined) ?? [];
  const pregenerated = ai.summary?.model === 'bundled';
  const modelOk = useCore(st => !!st.status?.models.ok);
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const running = busy || doc.ai_status === 'running';
  const level = cefrInfo(doc.level);

  const generate = async () => {
    if (!modelOk) { nav(`/welcome?step=3&back=${encodeURIComponent(location.hash.slice(1) || '/')}`); return; }
    setBusy(true);
    try { await rpc.call('documents.analyze', { id: doc.id }); toast(tl('正在生成总结，好了会自动出现')); } catch (e) { setBusy(false); toast(errorInfo(e).message, { kind: 'err' }); }
  };

  return (
    <aside className="rpanel" aria-label={tl('总结')}>
      <div className="rph">
        <span className="rph-title">
          <SummaryOverviewIcon size={15} />
          {tl('总结')}
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
              <span>{tl('大意')}</span>
            </h5>
            <p className="sum-body">{summary}</p>
          </section>
        ) : (
          <section className="sum-card sum-empty">
            <Mascot id="onboarding-read" size={108} />
            <b>{tl('大意')}</b>
            <p className="muted">{running ? tl('正在生成…') : !modelOk ? tl('要连接模型才能生成总结。') : doc.ai_status === 'failed' ? tl('上次没有生成成功。') : tl('这篇还没有总结。')}</p>
            {!running && <button className="btn pri sm" style={{ marginTop: 4 }} onClick={generate}>{modelOk ? tl('现在生成') : tl('去连接模型')}</button>}
          </section>
        )}

        {doc.level && (
          <section className="sum-level-block">
            <h5 className="sum-hd">
              <SummaryLevelIcon size={14} />
              <span>{tl('级别')}</span>
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
            <p className="sum-sub">{tl('{level}（按词频估的文本级别）', { level: doc.level })}</p>
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
              <span>{tl('学习建议')}</span>
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
