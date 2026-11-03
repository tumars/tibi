import type { ReactNode } from 'react';
import { Mascot, type MascotId } from './Mascot';

/** 空状态（03 §9：一句话，不安抚）。quip 是配合插画的冷幽默，有就替代 title */
export function Empty({ title, quip, text, action, image }: { title: string; quip?: string; text?: string; action?: ReactNode; image?: MascotId }) {
  return (
    <div className="empty">
      {image && <Mascot id={image} />}
      <b>{quip ?? title}</b>
      {text && <span>{text}</span>}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}
