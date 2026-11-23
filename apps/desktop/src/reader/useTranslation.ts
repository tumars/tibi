import type { SectionContent } from '@tibi/core';
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { errorInfo, rpc } from '../rpc';

/** 点击后立即反馈；后台的进度和失败由 sections.get + data.changed 接续。 */
export function useTranslation(content: SectionContent | undefined, setContent: Dispatch<SetStateAction<SectionContent | undefined>>) {
  const translating = content?.translation?.status === 'running';
  const generate = useCallback(async () => {
    if (!content || content.translation?.status === 'running') return;
    const id = content.id;
    const state = { status: 'running' as const, completed: 0, total: content.sentences.filter(s => !s.translation).length };
    setContent(c => c?.id === id ? { ...c, translation: state } : c);
    try {
      await rpc.call('sections.translate', { id });
    } catch (e) {
      setContent(c => c?.id === id ? { ...c, translation: { ...state, status: 'failed', error: errorInfo(e).message } } : c);
    }
  }, [content, setContent]);
  return { translating, generate };
}
