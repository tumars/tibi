import type { ReactNode } from 'react';
import { Mascot, type MascotId } from './Mascot';

/**
 * 空状态（文字规范 #5：只写一句话，再给一个操作按钮）。
 * - title / quip：单句主文案（简洁书面表达，不重复配副标题）
 * - detail：仅用于异常/诊断态展示系统错误原因，不用于常规说明
 * - action：单个主操作按钮或快捷入口
 */
export function Empty({ title, quip, detail, action, image }: { title: string; quip?: string; detail?: string; action?: ReactNode; image?: MascotId }) {
  return (
    <div className="empty">
      {image && <Mascot id={image} />}
      <p className="empty-msg">{quip ?? title}</p>
      {detail && <p className="empty-detail">{detail}</p>}
      {action && <div className="empty-act">{action}</div>}
    </div>
  );
}
