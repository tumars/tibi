import { useEffect, useState } from 'react';
import { Modal } from '../components/Modal';
import { diagText, feedbackLink, FEEDBACK_EMAIL, type Diag, type FeedbackKind, type FeedbackVia } from '../lib/feedback';
import { lang, tl } from '../lib/i18n';
import { currentPlatform } from '../lib/notice';
import { isTauri } from '../rpc';
import { useCore } from '../store/core';
import { recentErrors, toast } from '../store/ui';

const KINDS = [['bug', tl('问题')], ['idea', tl('建议')], ['other', tl('其他')]] as const;
const HINT: Record<FeedbackKind, string> = {
  bug: tl('你做了什么、期望看到什么、实际看到什么'),
  idea: tl('你在读文章、学单词时遇到了什么情况，希望 Tibi 怎么帮你'),
  other: tl('想说的都可以写'),
};

/** Apple 芯片还是 Intel：借检查更新时用的那个命令，它按芯片给安装包名 */
async function isArm(): Promise<boolean | undefined> {
  if (!isTauri()) return undefined;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('update_mirror_asset').then(a => a.includes('aarch64'), () => undefined);
}

async function open(url: string) {
  if (!isTauri()) { window.open(url, '_blank', 'noopener'); return; }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

/** 设置 → 关于：反馈与建议 */
export function FeedbackItems() {
  const [show, setShow] = useState(false);
  return <>
    <div className="item"><div><div className="t">{tl('反馈与建议')}</div><div className="d">{tl('遇到问题、有想法都可以告诉作者。在这里写好，再从 GitHub 或邮件发出去')}</div></div><div className="ctl">
      <button className="btn sm" onClick={() => setShow(true)}>{tl('写反馈')}</button>
    </div></div>
    {show && <FeedbackDialog onClose={() => setShow(false)} />}
  </>;
}

function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const status = useCore(s => s.status);
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [text, setText] = useState('');
  const [withDiag, setWithDiag] = useState(true);
  const [arm, setArm] = useState<boolean | undefined>();
  const [errors] = useState(recentErrors);
  useEffect(() => { void isArm().then(setArm); }, []);
  const diag: Diag = { version: status?.version ?? '', platform: currentPlatform(), arm, lang, models: { fast: status?.models.fast, deep: status?.models.deep }, errors };
  // 建议模板没有诊断字段，选了建议就不显示这块
  const diagUsed = withDiag && kind !== 'idea';

  const send = async (via: FeedbackVia) => {
    const link = feedbackLink(via, kind, text, diagUsed ? diag : undefined);
    try {
      if (link.copied) {
        await navigator.clipboard.writeText(link.copied);
        toast(tl('内容较长，已复制到剪贴板，打开后粘贴进去'), { ms: 8000 });
      }
      await open(link.url);
      onClose();
    } catch (e) {
      toast(via === 'mail' ? tl('没能打开邮件客户端，可以直接发邮件到 {v0}', { v0: FEEDBACK_EMAIL }) : String(e), { kind: 'err', ms: 8000 });
    }
  };
  const empty = !text.trim();

  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={tl('反馈与建议')} actions={<>
      <button className="btn" onClick={onClose}>{tl('取消')}</button>
      <button className="btn" disabled={empty} onClick={() => void send('mail')}>{tl('发邮件')}</button>
      <button className="btn pri" disabled={empty} onClick={() => void send('github')}>{tl('在 GitHub 提')}</button>
    </>}>
      <div className="fbk">
        <div className="seg">{KINDS.map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div>
        <textarea className="input" rows={6} autoFocus value={text} placeholder={HINT[kind]} aria-label={tl('反馈内容')} onChange={e => setText(e.target.value)} />
        {kind !== 'idea' && <>
          <label className="fbk-diag"><input type="checkbox" checked={withDiag} onChange={e => setWithDiag(e.target.checked)} />{tl('附带诊断信息（不含文章、生词、对话和 API Key）')}</label>
          {/* 预览的就是发出去的那段 */}
          {withDiag && <pre className="mono">{diagText(diag)}</pre>}
        </>}
        <p className="fbk-note">{tl('Tibi 不会自己发送任何东西：点按钮后会打开浏览器或邮件客户端，你确认后再发。GitHub 需要登录，没有账号就发邮件')}</p>
      </div>
    </Modal>
  );
}
