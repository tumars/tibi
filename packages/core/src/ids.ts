/**
 * UUIDv7（R11）：按时间有序，手机和电脑各自生成也不会冲突。
 * 只用 globalThis.crypto，Node 22、浏览器、iOS/Android 的 JS 运行时都有。
 */

let lastMs = 0;
let seq = 0;

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

const HEX: string[] = [];
for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'));

export function uuidv7(now: number = Date.now()): string {
  // 同一毫秒内用 12 位随机序号递增，保证本机单调
  if (now === lastMs) {
    seq = (seq + 1) & 0x0fff;
    if (seq === 0) {
      lastMs = ++now;
    }
  } else if (now > lastMs) {
    lastMs = now;
    seq = randomBytes(2)[0]! & 0x07ff;
  } else {
    // 时钟倒退：沿用上次的毫秒，继续递增
    now = lastMs;
    seq = (seq + 1) & 0x0fff;
  }
  const r = randomBytes(8);
  const b = new Uint8Array(16);
  b[0] = (now / 2 ** 40) & 0xff;
  b[1] = (now / 2 ** 32) & 0xff;
  b[2] = (now >>> 24) & 0xff;
  b[3] = (now >>> 16) & 0xff;
  b[4] = (now >>> 8) & 0xff;
  b[5] = now & 0xff;
  b[6] = 0x70 | (seq >>> 8);
  b[7] = seq & 0xff;
  b[8] = 0x80 | (r[0]! & 0x3f);
  for (let i = 1; i < 8; i++) b[8 + i] = r[i]!;
  let s = '';
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) s += '-';
    s += HEX[b[i]!];
  }
  return s;
}

/** 取 UUIDv7 里的毫秒时间戳 */
export function uuidv7Time(id: string): number {
  const hex = id.replace(/-/g, '').slice(0, 12);
  return parseInt(hex, 16);
}
