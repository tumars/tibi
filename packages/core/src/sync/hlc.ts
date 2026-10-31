/**
 * 混合逻辑时钟（08 §3）：`<毫秒 13 位>-<计数 4 位>-<设备短号>`，按字典序可比较。
 * 本机每次分配取 max(本机时钟, 见过的最大 HLC) + 1；读到别的设备的改动时也推进自己的时钟。
 */
export interface Hlc { ms: number; n: number; node: string }

export const fmtHlc = (h: Hlc) => `${String(h.ms).padStart(13, '0')}-${String(h.n).padStart(4, '0')}-${h.node}`;
export function parseHlc(s: string): Hlc | undefined {
  const m = /^(\d{13})-(\d{4})-(\w+)$/.exec(s); if (!m) return undefined;
  return { ms: Number(m[1]), n: Number(m[2]), node: m[3]! };
}

export class Clock {
  private last: Hlc;
  constructor(public readonly node: string, last?: string, private wall: () => number = Date.now) {
    this.last = (last && parseHlc(last)) || { ms: 0, n: 0, node };
  }
  /** 分配一个新时钟；at 是改动发生时的本机时间（推送时按 outbox 的 ms 分配，保持改动的先后） */
  tick(at: number = this.wall()): string {
    const ms = Math.max(at, this.last.ms);
    this.last = ms === this.last.ms ? { ms, n: this.last.n + 1, node: this.node } : { ms, n: 0, node: this.node };
    if (this.last.n > 9999) this.last = { ms: ms + 1, n: 0, node: this.node };
    return fmtHlc(this.last);
  }
  /** 见到别的设备的时钟：之后分配的一定比它大 */
  observe(remote: string) {
    const r = parseHlc(remote); if (!r) return;
    if (r.ms > this.last.ms || (r.ms === this.last.ms && r.n > this.last.n)) this.last = { ms: r.ms, n: r.n, node: this.node };
  }
  get value() { return fmtHlc(this.last); }
}

/** updated_at 之类的毫秒时间 → 初始推送用的时钟（计数 0） */
export const hlcFromMs = (ms: number, node: string) => fmtHlc({ ms: Math.max(0, Math.floor(ms)), n: 0, node });
