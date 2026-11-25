import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'outline';

export interface BadgeProps {
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  title?: string;
  className?: string;
  children: ReactNode;
}

/** 只读状态与元信息徽标；交互式筛选请使用 .chip 或 .seg */
export function Badge({ tone = 'neutral', size = 'sm', icon, title, className, children }: BadgeProps) {
  return (
    <span className={`ui-badge tone-${tone}${size === 'md' ? ' md' : ''}${className ? ` ${className}` : ''}`} title={title}>
      {icon}
      {children}
    </span>
  );
}
