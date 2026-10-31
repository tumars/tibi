import * as RSwitch from '@radix-ui/react-switch';

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <RSwitch.Root className="switch" checked={checked} onCheckedChange={onChange} aria-label={label}>
      <RSwitch.Thumb asChild><span /></RSwitch.Thumb>
    </RSwitch.Root>
  );
}
