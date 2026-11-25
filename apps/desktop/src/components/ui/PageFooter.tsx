import type { ReactNode } from 'react';

/** 页面统一页脚：免责声明、数据来源与更新时间只在此处出现一次 */
export function PageFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <footer className={`page-foot${className ? ` ${className}` : ''}`}>{children}</footer>;
}
