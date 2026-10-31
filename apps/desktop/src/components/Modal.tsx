import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

/** 确认框：只借 Radix 的交互（焦点、Esc、遮罩），样式自己的 */
export function Modal({ open, onOpenChange, title, children, actions }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children?: ReactNode; actions: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-ov" />
        <Dialog.Content className="modal" aria-describedby={undefined}>
          <Dialog.Title asChild><h3>{title}</h3></Dialog.Title>
          {children}
          <div className="acts">{actions}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
