import { web } from '@tibi/core';

/**
 * 手机上的文件导入（M7）：EPUB / PDF / Word 的抽取逻辑和桌面同一份（core 的 web/extract.ts），这里接浏览器版的 pdfjs、mammoth；
 * 图片走 tesseract.js 的浏览器版（第一次用时从 jsdelivr 下载英文语言包）。
 */
export const browserExtractDeps: web.ExtractDeps = {
  parse: web.domParser,
  async pdfjs() {
    const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
    const worker = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    return pdfjs;
  },
  async docxToHtml(buf) {
    const m = await import('mammoth/mammoth.browser.js') as unknown as { default?: Mammoth } & Mammoth;
    const mammoth = m.default ?? m;
    return (await mammoth.convertToHtml({ arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer })).value;
  },
};
type Mammoth = { convertToHtml(o: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }> };

type Recognizable = Blob | HTMLCanvasElement;
/** 按顺序识别一组图（图片 / 渲染好的 PDF 页），段落之间空一行；一张一张取，不把所有页的图都放在内存里 */
async function recognizeAll(n: number, get: (i: number) => Promise<Recognizable>, opts?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<{ text: string; pages: number; confidence: number }> {
  const { createWorker } = await import('tesseract.js');
  const w = await createWorker('eng');
  try {
    const out: string[] = []; let conf = 0;
    for (let i = 0; i < n; i++) {
      if (opts?.signal?.aborted) throw new Error('已取消');
      opts?.onProgress?.(i + 1, n);
      const r = await w.recognize(await get(i));
      const text = r.data.text.replace(/-\n(?=[a-z])/g, '').replace(/([^\n])\n(?!\n)/g, '$1 ').trim();
      if (text) out.push(text); conf += r.data.confidence;
    }
    return { text: out.join('\n\n'), pages: n, confidence: Math.round(conf / Math.max(1, n)) };
  } finally { await w.terminate(); }
}

/** 图片 OCR（拍书页、从相册选） */
export function ocrImages(images: Uint8Array[], onProgress?: (done: number, total: number) => void, signal?: AbortSignal) {
  return recognizeAll(images.length, async i => new Blob([images[i]! as BlobPart]), { onProgress, signal });
}

/** 扫描版 PDF 的 OCR：pdfjs 把每页按约 2 倍分辨率（长边不超过 2400 像素）画到画布上再识别；最多 300 页 */
export const OCR_MAX_PAGES = 300;
export async function ocrPdf(buf: Uint8Array, onProgress?: (done: number, total: number) => void, signal?: AbortSignal) {
  const pdfjs = await browserExtractDeps.pdfjs!() as unknown as PdfJs;
  const doc = await pdfjs.getDocument({ data: buf, isEvalSupported: false }).promise;
  try {
    const n = Math.min(doc.numPages, OCR_MAX_PAGES);
    return await recognizeAll(n, async i => {
      const page = await doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 2400 / Math.max(base.width, base.height));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      return canvas;
    }, { onProgress, signal });
  } finally { await doc.destroy(); }
}
type PdfJs = { getDocument(o: { data: Uint8Array; isEvalSupported?: boolean }): { promise: Promise<{ numPages: number; getPage(i: number): Promise<{ getViewport(o: { scale: number }): { width: number; height: number }; render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> }; cleanup(): void }>; destroy(): Promise<void> }> } };

/**
 * 内存里的文件（拍书页：<input type="file"> 拿到的是 File，不是路径）：登记成 mem:… 路径交给导入流水线，
 * readBytes 读到 mem: 时从这里取，取一次就删（OCR 只读一遍）。只在手机（Core 在 WebView 里）用。
 */
const memFiles = new Map<string, Uint8Array>();
export async function registerMemFile(f: Blob): Promise<string> {
  const id = `mem:${crypto.randomUUID()}`;
  memFiles.set(id, new Uint8Array(await f.arrayBuffer()));
  return id;
}
export function takeMemFile(path: string): Uint8Array | undefined {
  const b = memFiles.get(path); memFiles.delete(path); return b;
}
