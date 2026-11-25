import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { tl } from '../../lib/i18n';
import { InfoTip } from './InfoTip';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const ICONS: Record<AlertTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
};

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  tip?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  onDismiss?: () => void;
  className?: string;
}

/** 语义状态提示条：仅用于可操作的前置条件、告警与错误反馈，不用于常驻功能说明 */
export function Alert({ tone = 'info', title, tip, children, action, compact = false, onDismiss, className }: AlertProps) {
  const Icon = ICONS[tone];
  return (
    <div className={`ui-alert tone-${tone}${compact ? ' compact' : ''}${className ? ` ${className}` : ''}`} role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}>
      <span className="ui-alert-ic" aria-hidden="true"><Icon size={15} /></span>
      <div className="ui-alert-body">
        {title && (
          <div className="ui-alert-hd">
            <span>{title}</span>
            {tip && <InfoTip content={tip} />}
          </div>
        )}
        {children && <div>{children}</div>}
      </div>
      {(action || onDismiss) && (
        <div className="ui-alert-acts">
          {action}
          {onDismiss && (
            <button type="button" className="ibtn" aria-label={tl('关闭')} onClick={onDismiss}>
              <X size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
