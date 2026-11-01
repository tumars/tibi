import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractFile } from '../src/extract.js';
import { createCore } from '../src/create.js';

const dir = mkdtempSync(join(tmpdir(), 'tibi-files-'));
const para = (s: string) => `<p>${s} ${'The quick brown fox jumps over the lazy dog near the quiet river bank. '.repeat(4)}</p>`;

function makeEpub(): string {
  const chap = (t: string, body: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${t}</title></head><body><h1>${t}</h1>${body}</body></html>`;
  const files = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?><package><metadata><dc:title>A Tiny Book</dc:title><dc:creator>Ann Author</dc:creator></metadata>
      <manifest><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/c2.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>
      <spine><itemref idref="cover"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>`),
    'OEBPS/cover.xhtml': strToU8(chap('Cover', '<p>Cover</p>')),
    'OEBPS/nav.xhtml': strToU8('<html><body><nav><ol><li><a href="text/c1.xhtml">One: The River</a></li><li><a href="text/c2.xhtml#x">Two: The Hill</a></li></ol></nav></body></html>'),
    'OEBPS/text/c1.xhtml': strToU8(chap('Chapter One', para('It was a cold morning.') + para('The river was high.'))),
    'OEBPS/text/c2.xhtml': strToU8(chap('Chapter Two', '<h2>Part A</h2>' + para('They climbed the hill.'))),
  };
  const p = join(dir, 'book.epub'); writeFileSync(p, zipSync(files)); return p;
}

function makeDocx(): string {
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Meeting Notes</w:t></w:r></w:p>
      <w:p><w:r><w:t>We agreed to postpone the launch until the latency regression is fixed and verified by the reliability team.</w:t></w:r></w:p>
      </w:body></w:document>`),
  };
  const p = join(dir, 'notes.docx'); writeFileSync(p, zipSync(files)); return p;
}

/** 手写一个两页的 PDF（Helvetica 文字） */
function makePdf(pages: string[][]): string {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((lines, i) => {
    const content = 'BT /F1 12 Tf 72 720 Td 16 TL ' + lines.map(l => (l === '' ? 'T*' : `(${l}) Tj T*`)).join(' ') + ' ET';
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let out = '%PDF-1.4\n'; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const p = join(dir, 'paper.pdf'); writeFileSync(p, out, 'latin1'); return p;
}

describe('文件导入：EPUB / DOCX / PDF（M4）', () => {
  it('EPUB：按目录分章、跳过封面、章内标题降级', async () => {
    const f = await extractFile(makeEpub());
    expect(f).toMatchObject({ title: 'A Tiny Book', author: 'Ann Author', kind: 'book' });
    expect(f.markdown.match(/^# .+$/gm)).toEqual(['# One: The River', '# Two: The Hill']);
    expect(f.markdown).toContain('## Part A');
    expect(f.markdown).not.toContain('Cover');
  });

  it('DOCX：标题与段落', async () => {
    const f = await extractFile(makeDocx());
    expect(f.title).toBe('Meeting Notes');
    expect(f.markdown).toContain('postpone the launch');
  });

  it('PDF：拼回段落、行尾连字符、去页码；文字少的标 needs_ocr', async () => {
    const f = await extractFile(makePdf([['Distributed systems fail in partial ways that are', 'hard to observe and harder to re-', 'produce in tests.', '', 'A second paragraph starts here and keeps going for a while.', '', '1']]));
    expect(f.needs_ocr).toBe(false);
    expect(f.markdown).toContain('hard to observe and harder to reproduce in tests.');
    expect(f.markdown.split('\n\n')).toHaveLength(2);
    const scan = await extractFile(makePdf([[''], ['']]));
    expect(scan.needs_ocr).toBe(true);
  });

  it('经 Core 导入 EPUB：形态是书、两章', async () => {
    const core = await createCore({ dbPath: ':memory:', version: 't' });
    const path = makeEpub();
    await core.call('system.registerPaths', { paths: [path] });
    const { task_id } = await core.call<{ task_id: string }>('documents.import', { source: { type: 'file', path } });
    const r = await core.jobs.wait(task_id);
    expect(r.status, r.error).toBe('done');
    const doc = await core.call<{ kind: string; title: string; sections: { title: string }[] }>('documents.get', { id: (r.output as { document_id: string }).document_id });
    expect(doc.kind).toBe('book'); expect(doc.title).toBe('A Tiny Book');
    expect(doc.sections.map(s => s.title)).toEqual(['One: The River', 'Two: The Hill']);
  });
});

describe('书按章懒处理（M4）', () => {
  it('导入只标前两章，第三章打开时再标', async () => {
    const core = await createCore({ dbPath: ':memory:', version: 't' });
    const ch = (n: number) => `# Chapter ${n}\n\n${'The keeper walked along the narrow quay and watched the harbour lights fade one by one. '.repeat(5)}`;
    const { task_id } = await core.call<{ task_id: string }>('documents.import', { source: { type: 'text', text: [1, 2, 3].map(ch).join('\n\n'), title: 'Quay' }, hints: { kind: 'book' } });
    const r = await core.jobs.wait(task_id);
    const doc = await core.call<{ sections: { id: string; status: string }[] }>('documents.get', { id: (r.output as { document_id: string }).document_id });
    expect(doc.sections.map(s => s.status)).toEqual(['ready', 'ready', 'pending']);
    const sec = await core.call<{ sentences: { tokens: unknown[] }[] }>('sections.get', { id: doc.sections[2]!.id });
    expect(sec.sentences[0]!.tokens.length).toBeGreaterThan(0);
    const again = await core.call<{ sections: { status: string }[] }>('documents.get', { id: (r.output as { document_id: string }).document_id });
    expect(again.sections[2]!.status).toBe('ready');
  });
});
