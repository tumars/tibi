import * as RSwitch from '@radix-ui/react-switch';

export function Switch({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <RSwitch.Root className="switch" checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label}>
      <RSwitch.Thumb asChild><span /></RSwitch.Thumb>
    </RSwitch.Root>
  );
}
