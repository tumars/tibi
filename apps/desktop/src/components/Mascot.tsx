export type MascotId = 'empty-library' | 'empty-review' | 'empty-tasks' | 'empty-words' | 'celebrate-review' | 'error-generic' | 'error-offline' | 'about';

/** 吉祥物插画（07 §5）：静态画面用；要跟状态变化的位置用 Fox，两者不同框 */
export function Mascot({ id }: { id: MascotId }) {
  return <img src={`/mascot/${id}.webp`} srcSet={`/mascot/${id}.webp 1x, /mascot/${id}@2x.webp 2x`} alt="" />;
}
