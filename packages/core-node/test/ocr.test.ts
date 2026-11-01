import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePng, ocr, setOcrDataDir } from '../src/ocr.js';
import { extractFile } from '../src/extract.js';

const fx = (n: string) => join(__dirname, 'fixtures', n);
/** 一页只有一张 JPEG 扫描图的 PDF */
function scannedPdf(jpg: Buffer, w: number, h: number): string {
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im1 Do Q`;
  const parts: (string | Buffer)[] = []; const offs: number[] = []; let len = 0;
  const push = (x: string | Buffer) => { parts.push(x); len += Buffer.byteLength(x as string); };
  push('%PDF-1.4\n');
  const objs: (string | Buffer[])[] = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>`,
    [Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`), jpg, Buffer.from('\nendstream')],
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  objs.forEach((o, i) => { offs.push(len); push(`${i + 1} 0 obj\n`); if (typeof o === 'string') push(o); else o.forEach(push); push('\nendobj\n'); });
  const x = len;
  push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`);
  const p = join(mkdtempSync(join(tmpdir(), 'tibi-ocr-')), 'scan.pdf'); writeFileSync(p, Buffer.concat(parts.map(b => (typeof b === 'string' ? Buffer.from(b, 'latin1') : b)))); return p;
}

describe('OCR（M4）', () => {
  it('PNG 编码器输出合法的文件头', () => {
    const png = encodePng({ width: 2, height: 1, data: new Uint8Array([255, 0, 0, 0, 255, 0]), kind: 2 });
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('扫描版 PDF 被识别为 needs_ocr', async () => {
    const pdf = scannedPdf(readFileSync(fx('page.jpg')), 900, 400);
    expect((await extractFile(pdf)).needs_ocr).toBe(true);
  });

  // 要下载语言包（约 10 MB），默认跳过：TIBI_TEST_OCR=1 pnpm --filter @tibi/core-node test
  it.skipIf(!process.env.TIBI_TEST_OCR)('图片和扫描版 PDF 识别出英文', async () => {
    setOcrDataDir(process.env.TIBI_TESSDATA_DIR ?? mkdtempSync(join(tmpdir(), 'tibi-tess-')));
    const a = await ocr({ images: [fx('page.png')] });
    expect(a.text).toContain('amplify an outage');
    expect(a.text.split('\n\n').length).toBe(2);
    const b = await ocr({ pdf: scannedPdf(readFileSync(fx('page.jpg')), 900, 400) });
    expect(b.text).toMatch(/Distributed systems fail/);
  }, 120_000);
});
