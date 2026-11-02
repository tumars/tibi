import type { Conversation } from '@tibi/core';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ChatThread, type Pending } from '../components/ChatThread';
import { Top } from '../components/Shell';
import { tl } from '../lib/i18n';
import { useCore } from '../store/core';

/** 对话页（00 §3.10）：首页提问后主区切到这里（?q= 带着第一句，只发一次）；左栏"最近"能回来 */
export function Chat() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [conv, setConv] = useState<Conversation>();
  // 左栏改名后标题跟着变
  const title = useCore(s => s.recentChats.find(c => c.id === id)?.title) || conv?.title;
  const [pending, setPending] = useState<Pending>();
  const q = params.get('q'); const skill = params.get('skill') ?? undefined; const model = params.get('model') ?? undefined;
  // 取走 ?q= 后从网址里去掉，刷新页面不会再发一次
  useEffect(() => { if (q) { setPending({ key: `${id}:${q}`, text: q, context: { page: 'chat' }, skill, model }); setParams({}, { replace: true }); } }, [id, q, skill, model, setParams]);
  if (!id) return null;
  return (
    <>
      <Top crumbs={[{ label: tl('首页'), to: '/' }, { label: title || tl('对话') }]} />
      <ChatThread conversationId={id} context={{ page: 'chat' }} pending={pending} back={`/chat/${id}`} onConv={setConv} />
    </>
  );
}
