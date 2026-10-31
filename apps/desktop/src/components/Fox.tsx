import { useEffect, useRef } from 'react';
import '../lib/fox.js';

/** 原型的 SVG 小狐狸（v2-fox.js）。state：idle / listening / thinking / reading / happy / sleeping / surprised */
export function Fox({ size = 64, state = 'idle', className }: { size?: number; state?: string; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const handle = useRef<FoxHandle>(undefined);
  useEffect(() => {
    if (!el.current || !window.Fox) return;
    el.current.innerHTML = '';
    handle.current = window.Fox.mount(el.current, { state, size, interactive: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);
  useEffect(() => { handle.current?.set(state); }, [state]);
  return <div ref={el} className={className} style={{ width: size, height: size }} />;
}
