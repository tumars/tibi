import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { zlibSync } from 'fflate';
import type { Worker } from 'tesseract.js';

/**
 * OCR（M4，D4：本地 Tesseract）。tesseract.js 在 Core 进程里跑；英文语言包（约 10 MB）第一次用时从 jsdelivr 下载，
 * 缓存在 app.db 旁边的 tessdata/。图片直接识别；扫描版 PDF 取每页嵌着的扫描图（pdfjs），编成 PNG 再识别。
 * 打包成单文件 sidecar 时 worker 脚本单独打成 tesseract-worker.cjs，放在可执行文件旁边（或 TIBI_TESSERACT_WORKER 指定）。
 */
let worker: Promise<Worker> | undefined;
let dataDir = '';
export function setOcrDataDir(dir: string) { dataDir = dir; }

function workerPath(): string | undefined {
  const env = process.env.TIBI_TESSERACT_WORKER; if (env && existsSync(env)) return env;
  for (const base of [dirname(process.execPath), process.argv[1] ? dirname(process.argv[1]) : '', process.env.TIBI_RESOURCE_DIR ?? '']) {
    if (!base) continue;
    const p = join(base, 'tesseract-worker.cjs'); if (existsSync(p)) return p;
  }
  return undefined;   // 开发时（tsx / node_modules 在）用 tesseract.js 自带的
}

async function getWorker(): Promise<Worker> {
  if (!worker) {
    worker = (async () => {
      const { createWorker } = await import('tesseract.js');
      const cachePath = dataDir ? join(dataDir, 'tessdata') : undefined;
      if (cachePath) mkdirSync(cachePath, { recursive: true });
      const wp = workerPath();
      return createWorker('eng', 1, { ...(cachePath ? { cachePath } : {}), ...(wp ? { workerPath: wp } : {}) });
    })();
    worker.catch(() => { worker = undefined; });
  }
  return worker;
}

/** 一张图 → 按段落拼好的文字 */
async function recognize(img: Buffer | string): Promise<{ text: string; confidence: number }> {
  const w = await getWorker();
  const r = await w.recognize(img);
  // 按行距分段：比这一页最小的行间空白明显大（1.7 倍以上）就另起一段；行尾连字符断词拼回去
  const lines = (r.data.lines ?? []).map(l => ({ text: l.text.trim(), y0: l.bbox.y0, y1: l.bbox.y1 })).filter(l => l.text);
  if (!lines.length) return { text: r.data.text.trim(), confidence: r.data.confidence };
  const gaps = lines.slice(1).map((l, i) => l.y0 - lines[i]!.y1);
  const base = Math.max(1, Math.min(...gaps.filter(g => g >= 0), Infinity));   // 段内行距：这一页最小的行间空白
  const paras: string[] = []; let cur = '';
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    if (prev && l.y0 - prev.y1 > base * 1.7 + 2) { paras.push(cur); cur = ''; }
    cur = cur.endsWith('-') && /^[a-z]/.test(l.text) ? cur.slice(0, -1) + l.text : cur ? `${cur} ${l.text}` : l.text;
  });
  if (cur) paras.push(cur);
  return { text: paras.join('\n\n').trim(), confidence: r.data.confidence };
}

export async function ocr(input: { images?: string[]; pdf?: string }, opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<{ text: string; pages: number; confidence: number }> {
  const sources: (Buffer | string)[] = input.images ? [...input.images] : input.pdf ? await pdfPageImages(input.pdf) : [];
  if (!sources.length) throw new Error('没有可以识别的图片');
  const out: string[] = []; let conf = 0;
  for (let i = 0; i < sources.length; i++) {
    if (opts.signal?.aborted) throw new Error('已取消');
    opts.onProgress?.(i + 1, sources.length);
    const r = await recognize(sources[i]!);
    if (r.text) out.push(r.text); conf += r.confidence;
  }
  return { text: out.join('\n\n'), pages: sources.length, confidence: Math.round(conf / sources.length) };
}

/* ---------- 扫描版 PDF：取每页最大的那张图 ---------- */
async function pdfPageImages(path: string): Promise<Buffer[]> {
  const g = globalThis as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await readFile(path)), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const out: Buffer[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const ops = await page.getOperatorList();
    let best: { width: number; height: number; data: Uint8ClampedArray | Uint8Array; kind: number } | undefined;
    for (let k = 0; k < ops.fnArray.length; k++) {
      if (ops.fnArray[k] !== pdfjs.OPS.paintImageXObject) continue;
      const name = ops.argsArray[k][0] as string;
      const img = await new Promise<typeof best>(res => { try { (name.startsWith('g_') ? page.commonObjs : page.objs).get(name, (o: unknown) => res(o as typeof best)); } catch { res(undefined); } });
      if (img?.data && (!best || img.width * img.height > best.width * best.height)) best = img;
    }
    if (best) out.push(encodePng(best));
    page.cleanup();
  }
  await doc.destroy();
  return out;
}

/** 极简 PNG 编码（灰度 / RGB / RGBA → RGBA 8 位） */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf: Uint8Array) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out;
}
export function encodePng(img: { width: number; height: number; data: Uint8ClampedArray | Uint8Array; kind: number }): Buffer {
  const { width: w, height: h, data } = img;
  const bpp = data.length === w * h * 4 ? 4 : data.length === w * h * 3 ? 3 : data.length === w * h ? 1 : 0;
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      if (bpp === 4) { const s = (y * w + x) * 4; raw[o] = data[s]!; raw[o + 1] = data[s + 1]!; raw[o + 2] = data[s + 2]!; raw[o + 3] = data[s + 3]!; }
      else if (bpp === 3) { const s = (y * w + x) * 3; raw[o] = data[s]!; raw[o + 1] = data[s + 1]!; raw[o + 2] = data[s + 2]!; raw[o + 3] = 255; }
      else if (bpp === 1) { const v = data[y * w + x]!; raw[o] = raw[o + 1] = raw[o + 2] = v; raw[o + 3] = 255; }
      else { const bit = (data[y * Math.ceil(w / 8) + (x >> 3)]! >> (7 - (x & 7))) & 1; const v = bit ? 255 : 0; raw[o] = raw[o + 1] = raw[o + 2] = v; raw[o + 3] = 255; }   // 1 位黑白
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())]);
}
