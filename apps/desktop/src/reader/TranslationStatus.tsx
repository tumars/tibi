import type { TranslationState } from '@tibi/core';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { tl } from '../lib/i18n';
import './translation.css';

/** 独立于工具栏文字；窄屏、打开右栏或手机收起工具栏时仍能看到。 */
export function TranslationStatus({ state, onRetry }: { state?: TranslationState; onRetry: () => void }) {
  if (!state) return null;
  const running = state.status === 'running';
  return <div className="translation-status" role="status" aria-live="polite" aria-atomic="true">
    {running ? <LoaderCircle className="translation-spin" aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
    <div className="translation-copy">
      <strong>{running ? tl('正在生成译文…') : tl('译文生成未完成')}</strong>
      <span>{running
        ? state.total > 0 ? tl('已完成 {completed} / {total} 句，可继续阅读', { completed: state.completed, total: state.total }) : tl('可继续阅读，译文会自动出现')
        : state.error}</span>
    </div>
    {!running && <button className="btn sm" onClick={onRetry}>{tl('重试')}</button>}
  </div>;
}
