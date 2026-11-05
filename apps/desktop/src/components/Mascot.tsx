export type MascotId = 'empty-library' | 'empty-review' |'empty-words' | 'celebrate-review' | 'celebrate-streak' | 'sticker-1' | 'error-generic' | 'error-offline' | 'about';

/** 连续学习到这些天数时，复习完成页换成奖牌（07 §3） */
export const isStreakMilestone = (streak: number) => streak === 7 || streak === 30 || streak === 100;

/** 吉祥物插画（07 §5）：静态画面用；要跟状态变化的位置用 Fox，两者不同框 */
export function Mascot({ id }: { id: MascotId }) {
  return <img src={`/mascot/${id}.webp`} srcSet={`/mascot/${id}.webp 1x, /mascot/${id}@2x.webp 2x`} alt="" />;
}
