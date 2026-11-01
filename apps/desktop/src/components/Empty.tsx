import type { ReactNode } from 'react';
import { Mascot, type MascotId } from './Mascot';

/** 空状态（03 §9：一句话，不安抚） */
export function Empty({ title, text, action, image }: { title: string; text?: string; action?: ReactNode; image?: MascotId }) {
  return (
    <div className="empty">
      {image && <Mascot id={image} />}
      <b>{title}</b>
      {text && <span>{text}</span>}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}
