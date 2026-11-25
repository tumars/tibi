import { useEffect, useState } from 'react';
import { Modal } from '../components/Modal';
import { SettingItem } from '../components/ui';
import { diagText, feedbackLink, FEEDBACK_EMAIL, type Diag, type FeedbackKind, type FeedbackVia } from '../lib/feedback';
import { lang, tl } from '../lib/i18n';
import { currentPlatform } from '../lib/notice';
import { isTauri } from '../rpc';
import { useCore } from '../store/core';
import { recentErrors, toast } from '../store/ui';

const KINDS = [['bug', tl('问题')], ['idea', tl('建议')], ['other', tl('其他')]] as const;
const HINT: Record<FeedbackKind, string> = {
  bug: tl('描述操作步骤、预期结果与实际表现'),
  idea: tl('描述使用场景与期望改进'),
  other: tl('输入反馈内容'),
};

/** Apple 芯片还是 Intel：借检查更新时用的那个命令，它按芯片给安装包名 */
async function isArm(): Promise<boolean | undefined> {
  if (!isTauri()) return undefined;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('update_installer_asset').then(a => a.includes('aarch64'), () => undefined);
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
    <SettingItem
      title={tl('反馈与建议')}
      tip={tl('通过 GitHub Issues 或邮件向作者提交问题与建议。')}
      control={<button className="btn sm" onClick={() => setShow(true)}>{tl('提交反馈')}</button>}
    />
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
      <button className="btn" disabled={empty} onClick={() => void send('mail')}>{tl('发送邮件')}</button>
      <button className="btn pri" disabled={empty} onClick={() => void send('github')}>{tl('通过 GitHub 提交')}</button>
    </>}>
      <div className="fbk">
        <div className="seg">{KINDS.map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div>
        <textarea className="input" rows={6} autoFocus value={text} placeholder={HINT[kind]} aria-label={tl('反馈内容')} onChange={e => setText(e.target.value)} />
        {kind !== 'idea' && <>
          <label className="fbk-diag"><input type="checkbox" checked={withDiag} onChange={e => setWithDiag(e.target.checked)} />{tl('附带诊断信息（不含文章、生词、对话和 API Key）')}</label>
          {/* 预览的就是发出去的那段 */}
          {withDiag && <pre className="mono">{diagText(diag)}</pre>}
        </>}
        <p className="fbk-note">{tl('提交后将跳转至浏览器或邮件客户端由你确认发送，Tibi 不会自动上传数据。')}</p>
      </div>
    </Modal>
  );
}
