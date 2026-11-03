import type { Approval } from '@tibi/core';
import { useCallback, useEffect, useState } from 'react';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';
import { ApprovalCard } from './Process';

/**
 * 不在对话里的审批（外部 AI 工具经 MCP 要写入）：没有对话可以显示审批卡，放在窗口右下角。
 * 对方在等这次调用的结果，最多等 5 分钟，超时算没确认。
 */
export function OutsideApprovals() {
  const [list, setList] = useState<Approval[]>([]);
  const load = useCallback(() => { rpc.call('approvals.list', {}).then(setList, () => undefined); }, []);
  useEffect(() => {
    load();
    const offs = [
      rpc.on('approval.requested', d => { if (!d.approval.conversation_id) setList(l => [...l.filter(x => x.id !== d.approval.id), d.approval]); }),
      rpc.on('approval.resolved', d => setList(l => l.filter(x => x.id !== d.id))),
    ];
    return () => offs.forEach(off => off());
  }, [load]);
  const decide = async (a: Approval, decision: 'allow' | 'deny' | 'edit', always = false, edited?: Record<string, unknown>) => {
    try { await rpc.call('approvals.decide', { id: a.id, decision, always, edited }); setList(l => l.filter(x => x.id !== a.id)); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); load(); }
  };
  if (!list.length) return null;
  return <div className="outside-approvals" role="region" aria-label={tl('外部工具等你确认')}>
    {list.map(a => <ApprovalCard key={a.id} a={a} decide={(x, d, al, ed) => void decide(x, d, al, ed)} />)}
  </div>;
}
