import { readFile } from 'node:fs/promises';
import { web, type ExtractedFile } from '@tibi/core';
import { linkedomParse } from './html2md.js';

/**
 * 文件抽取（M4）：逻辑在 @tibi/core 的 web/extract.ts（手机 WebView 里也用），这里只接 Node 版的依赖。
 * 打包成单文件 sidecar 后找不到 pdf.worker.mjs：先把 worker 模块挂到 globalThis.pdfjsWorker，pdfjs 的"假 worker"会直接用它。
 */
const deps: web.ExtractDeps = {
  parse: linkedomParse,
  async pdfjs() {
    const g = globalThis as { pdfjsWorker?: unknown };
    if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  },
  async docxToHtml(buf) { const mammoth = await import('mammoth'); return (await mammoth.convertToHtml({ buffer: Buffer.from(buf) })).value; },
};

/** saveAsset：EPUB 插图存到哪（Platform.saveAsset）；不给时不带图片 */
export async function extractFile(path: string, saveAsset?: web.ExtractDeps['saveAsset']): Promise<ExtractedFile> { return web.extractBuffer(path, new Uint8Array(await readFile(path)), { ...deps, saveAsset }); }
export const extractEpub = (buf: Uint8Array) => web.extractEpub(buf, deps);
export const extractPdf = (buf: Uint8Array) => web.extractPdf(buf, deps);
export const extractDocx = (buf: Uint8Array) => web.extractDocx(buf, deps);
