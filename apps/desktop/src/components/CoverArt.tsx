import { Headphones } from 'lucide-react';
import { useEffect, useState } from 'react';
import { resolveImageSrc } from '../lib/imageSrc';

/** 播客 / 电台封面图：加载中或加载失败 / 无地址时退回耳机图标 */
export function CoverArt({ src, size, lazy }: { src?: string; size: number; lazy?: boolean }) {
  const resolved = src ? (resolveImageSrc(src) ?? src) : undefined;
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setLoaded(false); setFailed(false); }, [resolved]);
  if (!resolved || failed) return <Headphones size={size} />;
  return <>
    {!loaded && <Headphones size={size} />}
    <img
      src={resolved}
      alt=""
      loading={lazy ? 'lazy' : undefined}
      referrerPolicy="no-referrer"
      style={loaded ? undefined : { position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  </>;
}
