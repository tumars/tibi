import type { ReactNode } from 'react';

/** 空状态（03 §9：一句话，不安抚） */
export function Empty({ title, text, action, image }: { title: string; text?: string; action?: ReactNode; image?: string }) {
  return (
    <div className="empty">
      {image && <img src={image} alt="" />}
      <b>{title}</b>
      {text && <span>{text}</span>}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}
