import type { Conversation } from '@tibi/core';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ChatThread, type Pending } from '../components/ChatThread';
import { Top } from '../components/Shell';

/** 对话页（00 §3.10）：首页提问后主区切到这里（?q= 带着第一句，只发一次）；左栏"最近"能回来 */
export function Chat() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [conv, setConv] = useState<Conversation>();
  const [pending, setPending] = useState<Pending>();
  const q = params.get('q'); const skill = params.get('skill') ?? undefined; const tier = params.get('tier') === 'deep' ? 'deep' as const : undefined;
  // 取走 ?q= 后从网址里去掉，刷新页面不会再发一次
  useEffect(() => { if (q) { setPending({ key: `${id}:${q}`, text: q, context: { page: 'chat' }, skill, tier }); setParams({}, { replace: true }); } }, [id, q, skill, tier, setParams]);
  if (!id) return null;
  return (
    <>
      <Top crumbs={[{ label: '首页', to: '/' }, { label: conv?.title || '对话' }]} />
      <ChatThread conversationId={id} context={{ page: 'chat' }} pending={pending} back={`/chat/${id}`} onConv={setConv} />
    </>
  );
}
