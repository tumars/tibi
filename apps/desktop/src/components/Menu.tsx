import * as DM from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';

/**
 * 小下拉菜单（Radix）：trigger 是按钮，items 是一组 [文字, 动作]。
 * 左栏的行菜单还要：右键打开（open 受控）、不挡住页面其他操作（modal=false）、关闭后把焦点留给行内输入框（keepFocus）。
 */
export function Menu({ trigger, items, open, onOpenChange, modal, compact, keepFocus }: {
  trigger: ReactNode; items: { label: string; hint?: string; danger?: boolean; run: () => void }[];
  open?: boolean; onOpenChange?: (o: boolean) => void; modal?: boolean; compact?: boolean; keepFocus?: boolean;
}) {
  return (
    <DM.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content className={`dmenu${compact ? ' compact' : ''}`} align="end" sideOffset={6} onCloseAutoFocus={keepFocus ? e => e.preventDefault() : undefined}>
          {items.map(i => <DM.Item key={i.label} className={`dmi${i.danger ? ' danger' : ''}`} onSelect={i.run}><span>{i.label}</span>{i.hint && <small>{i.hint}</small>}</DM.Item>)}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
