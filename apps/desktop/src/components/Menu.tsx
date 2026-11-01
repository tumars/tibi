import * as DM from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';

/** 小下拉菜单（Radix）：trigger 是按钮，items 是一组 [文字, 动作] */
export function Menu({ trigger, items }: { trigger: ReactNode; items: { label: string; hint?: string; run: () => void }[] }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content className="dmenu" align="end" sideOffset={6}>
          {items.map(i => <DM.Item key={i.label} className="dmi" onSelect={i.run}><span>{i.label}</span>{i.hint && <small>{i.hint}</small>}</DM.Item>)}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
