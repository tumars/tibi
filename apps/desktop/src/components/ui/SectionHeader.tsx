import type { ReactNode } from 'react';
import { InfoTip } from './InfoTip';

export interface SectionHeaderProps {
  title: ReactNode;
  /** 必要的解释放进 ① 提示气泡，默认不显示 */
  tip?: ReactNode;
  /** 简短键值元信息（如统计周期），不写长说明句 */
  meta?: ReactNode;
  /** 右侧操作区（链接或控件） */
  action?: ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
}

/** 统一模块标题栏：主标题 + 可选 ① 提示气泡 + 可选右侧键值或操作 */
export function SectionHeader({ title, tip, meta, action, as = 'h2', className }: SectionHeaderProps) {
  const Heading = as;
  return (
    <div className={`ui-sech${className ? ` ${className}` : ''}`}>
      <div className="ui-sech-left">
        <Heading>{title}</Heading>
        {tip && <InfoTip content={tip} />}
      </div>
      {(meta || action) && (
        <div className="ui-sech-right">
          {meta && <span className="ui-sech-meta">{meta}</span>}
          {action}
        </div>
      )}
    </div>
  );
}
