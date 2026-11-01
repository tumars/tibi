import { useNavigate, useSearchParams } from 'react-router';
import { Dictionary } from '../components/Dictionary';
import { Top } from '../components/Shell';
import { tl } from '../lib/i18n';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';

/** 词典页（00 §3.14）；/dict?w=<词> 直接查这个词 */
export function Dict() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const ask = async (text: string) => {
    try { const c = await rpc.call('chat.open', {}); nav(`/chat/${c.id}?q=${encodeURIComponent(text)}`); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  return (
    <>
      <Top crumbs={[{ label: tl('词典') }]} />
      <div className="scroll"><div className="page" style={{ maxWidth: 920 }}>
        <Dictionary initial={params.get('w') ?? undefined} onOpenDoc={id => nav(`/read/${id}`)} onOpenTerm={id => nav(`/words?term=${id}`)} onAsk={t => void ask(t)} />
      </div></div>
    </>
  );
}
