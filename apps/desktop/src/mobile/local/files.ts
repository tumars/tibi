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

/** 图片 OCR：按顺序识别，段落之间空一行 */
export async function ocrImages(images: Uint8Array[], onProgress?: (done: number, total: number) => void): Promise<{ text: string; pages: number; confidence: number }> {
  const { createWorker } = await import('tesseract.js');
  const w = await createWorker('eng');
  try {
    const out: string[] = []; let conf = 0;
    for (let i = 0; i < images.length; i++) {
      onProgress?.(i + 1, images.length);
      const r = await w.recognize(new Blob([images[i]! as BlobPart]));
      const text = r.data.text.replace(/-\n(?=[a-z])/g, '').replace(/([^\n])\n(?!\n)/g, '$1 ').trim();
      if (text) out.push(text); conf += r.data.confidence;
    }
    return { text: out.join('\n\n'), pages: images.length, confidence: Math.round(conf / Math.max(1, images.length)) };
  } finally { await w.terminate(); }
}
