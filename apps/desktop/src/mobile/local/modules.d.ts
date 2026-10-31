// pdfjs 的浏览器入口和 mammoth 的浏览器版没有自带类型（core 的 web/extract.ts 只把它们当 any 用）
declare module 'pdfjs-dist/build/pdf.mjs' {
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(o: object): { promise: Promise<unknown> };
  export const OPS: Record<string, number>;
}
declare module 'mammoth/mammoth.browser.js';
