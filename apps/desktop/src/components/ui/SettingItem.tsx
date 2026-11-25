import type { ReactNode } from 'react';
import { InfoTip } from './InfoTip';

export interface SettingItemProps {
  title: string;
  badge?: ReactNode;
  /** 低频说明折叠至 ① 提示气泡；同时写入 data-tip-text 供设置页搜索匹配 */
  tip?: string;
  /** 仅用于动态状态或关键键值对（路径、占用、上次同步时间等） */
  status?: ReactNode;
  control?: ReactNode;
  stacked?: boolean;
  children?: ReactNode;
  className?: string;
}

/**
 * 规范设置行：保持 .t 内仅含纯标题文本（兼容设置搜索与深链高亮），
 * 规则说明折叠进 ① 提示气泡，动态键值置于状态位。
 */
export function SettingItem({ title, badge, tip, status, control, stacked = false, children, className }: SettingItemProps) {
  if (stacked) {
    return (
      <div className={`item col${className ? ` ${className}` : ''}`} data-tip-text={tip}>
        <div className="item-head">
          <div className="t">{title}</div>
          {badge}
          {tip && <InfoTip content={tip} />}
        </div>
        {status && <div className="d">{status}</div>}
        {children}
      </div>
    );
  }
  return (
    <div className={`item${className ? ` ${className}` : ''}`} data-tip-text={tip}>
      <div>
        <div className="item-head">
          <div className="t">{title}</div>
          {badge}
          {tip && <InfoTip content={tip} />}
        </div>
        {status && <div className="d">{status}</div>}
        {children}
      </div>
      <div className="ctl">{control}</div>
    </div>
  );
}
