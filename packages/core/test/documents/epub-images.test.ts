import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { fileAssetDirs, linkedomParse, nodePlatform } from '@tibi/core-node';
import { extractEpub, imageSize } from '../../src/web/extract.js';
import { htmlToMarkdown } from '../../src/web/html.js';
import { segmentMarkdown } from '../../src/domain/text/segment.js';

/** 只有文件头的 PNG（够读出尺寸），后面补字节凑大小 */
function png(w: number, h: number, pad = 2048): Uint8Array {
  const b = new Uint8Array(33 + pad);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
  return b;
}
const para = (s: string) => `<p>${s} ${'The quick brown fox jumps over the lazy dog near the quiet river bank. '.repeat(4)}</p>`;
const chap = (t: string, body: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${t}</title></head><body><h1>${t}</h1>${body}</body></html>`;

function makeEpub(): Uint8Array {
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?><package><metadata><dc:title>Pictures</dc:title></metadata>
      <manifest><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/><item id="plate" href="text/plate.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/c2.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="cover"/><itemref idref="c1"/><itemref idref="plate"/><itemref idref="c2"/></spine></package>`),
    'OEBPS/cover.xhtml': strToU8('<html><body><div><img src="images/cover.png" alt="Cover"/></div></body></html>'),
    'OEBPS/text/c1.xhtml': strToU8(chap('Chapter One',
      para('It was a cold morning.')
      + '<div class="figcenter"><img src="../images/river%20view.png" alt="The [river] at dawn"/><p class="caption">The river at dawn.</p></div>'
      + `<p>An inline <img src="../images/river%20view.png" alt="x"/> picture stays out. ${'Words keep going here. '.repeat(3)}</p>`
      + '<p class="center"><img src="../images/dingbat.png" alt=""/></p>'
      + '<p><img src="../images/missing.png" alt="gone"/></p>'
      + '<p><img src="https://example.com/remote.png" alt="remote"/></p>'
      + para('The river was high.'))),
    'OEBPS/text/plate.xhtml': strToU8('<html><body><p><img src="../images/plate.png" alt="A full-page plate"/></p></body></html>'),
    'OEBPS/text/c2.xhtml': strToU8(chap('Chapter Two', '<figure><img src="../images/river%20view.png" alt="Again"/><figcaption>Same picture again.</figcaption></figure>' + para('They climbed the hill.'))),
    'OEBPS/images/cover.png': png(600, 800),
    'OEBPS/images/river view.png': png(800, 600),
    'OEBPS/images/plate.png': png(600, 900),
    'OEBPS/images/dingbat.png': png(16, 16, 100),
  });
}

describe('EPUB 插图', () => {
  it('单独成块的插图存到正文外面，正文里留 ![alt](asset:…)；装饰小图、行内图、缺的图、外链和封面不要', async () => {
    const saved: { key: string; name: string; size: number }[] = [];
    const f = await extractEpub(makeEpub(), { parse: linkedomParse, saveAsset: async (key, name, data) => { saved.push({ key, name, size: data.length }); return `asset:${key}/${name}`; } });
    const key = saved[0]!.key;
    expect(key).toMatch(/^[0-9a-f]{24}$/);
    expect(saved.map(s => s.name).sort()).toEqual(['OEBPS_images_plate.png', 'OEBPS_images_river_view.png']);   // 同一张图只存一次
    const imgs = f.markdown.match(/^!\[.*$/gm);
    expect(imgs).toEqual([
      `![The river at dawn](asset:${key}/OEBPS_images_river_view.png)`,
      `![A full-page plate](asset:${key}/OEBPS_images_plate.png)`,   // 整页插画接在上一章后面
      `![Again](asset:${key}/OEBPS_images_river_view.png)`,
    ]);
    expect(f.markdown).toContain('The river at dawn.');   // 图注照旧是一段
    expect(f.markdown).toMatch(/An inline +picture stays out\./);
    // 切分后是图片块，不拆句
    const seg = segmentMarkdown(f.markdown, { kind: 'book' });
    const blocks = seg.sections.flatMap(s => s.paragraphs).filter(p => p.block_type === 'image');
    expect(blocks.map(b => b.src)).toEqual([`asset:${key}/OEBPS_images_river_view.png`, `asset:${key}/OEBPS_images_plate.png`, `asset:${key}/OEBPS_images_river_view.png`]);
    expect(seg.sections[0]!.paragraphs.at(-1)).toMatchObject({ block_type: 'image', text: 'A full-page plate' });
  });

  it('Gutenberg 式：一个文件几章按目录锚点分章；版权头尾、目录页、“看大图”页和链接都去掉，卷首插图放到第一章开头', async () => {
    const opening = (s: string) => `<h3 id="s${s}">‘${s},’ said somebody at once, rising from the chair by the fire with a menacing look at everyone.</h3>`;
    const epub = zipSync({
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
      'OEBPS/content.opf': strToU8(`<?xml version="1.0"?><package><metadata><dc:title>Two Chapters</dc:title></metadata>
        <manifest><item id="nav" href="toc.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="h0" href="h-0.xhtml" media-type="application/xhtml+xml"/><item id="h1" href="h-1.xhtml" media-type="application/xhtml+xml"/><item id="ft" href="h-9.xhtml" media-type="application/xhtml+xml"/><item id="w" href="plate.wrap.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="h0"/><itemref idref="h1"/><itemref idref="ft"/><itemref idref="w"/></spine></package>`),
      'OEBPS/toc.xhtml': strToU8('<html><body><nav><ol><li><a href="h-0.xhtml#t">TWO CHAPTERS</a></li><li><a href="h-0.xhtml#c1">CHAPTER I — THE START</a></li><li><a href="h-0.xhtml#s1">An opening line</a></li><li><a href="h-0.xhtml#c2">CHAPTER II — THE MIDDLE</a></li><li><a href="h-1.xhtml#c3">CHAPTER III — THE END</a></li><li><a href="h-9.xhtml#lic">THE FULL LICENSE</a></li></ol></nav></body></html>'),
      'OEBPS/h-0.xhtml': strToU8(`<html><body><div id="pg-header">${para('This eBook is for the use of anyone anywhere.')}</div><div id="pg-start-separator">*** START OF THE EBOOK ***</div>
        <h1 id="t">TWO CHAPTERS</h1><div class="fig"><img src="front.png" alt="0001m "/></div><p>CONTENTS</p><p>CHAPTER I — THE START</p><p>CHAPTER II — THE MIDDLE</p>
        <h2 id="c1">CHAPTER I — THE START</h2>${opening('One')}${para('First chapter.')}<div class="fig"><img src="plate.png" alt="0002m "/></div><h5><a href="plate.wrap.xhtml" title="linked image"><i>Original</i></a></h5>
        <h2 id="c2">CHAPTER II — THE MIDDLE</h2>${para('Second chapter.')}</body></html>`),
      'OEBPS/h-1.xhtml': strToU8(`<html><body>${para('Still the second chapter.')}<h2 id="c3">CHAPTER III — THE END</h2>${para('Third chapter.')}</body></html>`),
      'OEBPS/h-9.xhtml': strToU8(`<html><body>${para('Last words of chapter three.')}<div id="pg-end-separator">*** END ***</div><h2 id="lic">THE FULL LICENSE</h2>${para('Legal text.')}</body></html>`),
      'OEBPS/plate.wrap.xhtml': strToU8('<html><body><img src="plate.png" alt="Original"/></body></html>'),
      'OEBPS/front.png': png(600, 800), 'OEBPS/plate.png': png(600, 800),
    });
    const f = await extractEpub(epub, { parse: linkedomParse, saveAsset: async (k, n) => `asset:${k}/${n}` });
    expect(f.markdown.match(/^# .+$/gm)).toEqual(['# CHAPTER I — THE START', '# CHAPTER II — THE MIDDLE', '# CHAPTER III — THE END']);
    expect(f.markdown.match(/^!\[.*$/gm)?.map(l => l.replace(/\(.*\//, '('))).toEqual(['![](OEBPS_front.png)', '![](OEBPS_plate.png)']);   // 文件名式 alt 不当图注；大图页不重复
    expect(f.markdown.indexOf('front.png')).toBeLessThan(f.markdown.indexOf('First chapter.'));
    expect(f.markdown).toContain('Still the second chapter.');
    expect(f.markdown).toContain('Last words of chapter three.');
    for (const junk of ['eBook is for the use', 'START OF THE EBOOK', 'CONTENTS', 'Original', 'Legal text', 'LICENSE']) expect(f.markdown).not.toContain(junk);
    expect(f.markdown).toMatch(/^‘One,’ said somebody/m);   // 被标成 h3 的章首句还原成段落
  });

  it('没有 saveAsset 时图片都去掉；存失败的也去掉', async () => {
    expect((await extractEpub(makeEpub(), { parse: linkedomParse })).markdown).not.toContain('![');
    const f = await extractEpub(makeEpub(), { parse: linkedomParse, saveAsset: async (k, n) => { if (n.includes('plate')) throw new Error('disk full'); return `asset:${k}/${n}`; } });
    expect(f.markdown.match(/^!\[.*$/gm)?.length).toBe(2);
    expect(f.markdown).not.toContain('plate');
  });

  it('桌面运行时把图片写到 app.db 旁边的 assets/<key>/', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tibi-epub-img-'));
    const book = join(dir, 'pictures.epub'); writeFileSync(book, makeEpub());
    const p = nodePlatform({ app_version: 'test', db_path: join(dir, 'app.db'), getSecret: async () => undefined });
    const f = await p.extractFile!(book);
    const uri = f.markdown.match(/\]\((asset:[^)]+)\)/)![1]!;
    expect(readFileSync(join(dir, 'assets', ...uri.slice('asset:'.length).split('/')))).toEqual(Buffer.from(png(800, 600)));
    await expect(p.saveAsset!('../x', 'a.png', new Uint8Array(1))).rejects.toThrow();
  });

  it('像文件名的 alt 不当图注', () => {
    const md = (alt: string) => htmlToMarkdown(`<p><img src="a.jpg" alt="${alt}"/></p>`, undefined, linkedomParse, { image: () => 'asset:k/a.jpg' }).trim();
    expect(md('0060m ')).toBe('![](asset:k/a.jpg)');
    expect(md('img_12.jpg')).toBe('![](asset:k/a.jpg)');
    expect(md('Oliver asking for more')).toBe('![Oliver asking for more](asset:k/a.jpg)');
    expect(md('Frontispiece')).toBe('![Frontispiece](asset:k/a.jpg)');
  });
  it('桌面运行时列得出、删得掉 assets/ 下的目录', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tibi-assets-'));
    const p = nodePlatform({ db_path: join(dir, 'app.db') } as never);
    await p.saveAsset!('k1', 'a.png', png(800, 600)); await p.saveAsset!('k2', 'b.png', png(800, 600));
    expect((await p.listAssets!()).map(d => d.key).sort()).toEqual(['k1', 'k2']);
    await p.removeAssets!('k1');
    expect((await p.listAssets!()).map(d => d.key)).toEqual(['k2']);
    await expect(p.removeAssets!('../x')).rejects.toThrow();
    expect(fileAssetDirs(':memory:')).toEqual({});
  });
  it('读得出 PNG / GIF / JPEG 的尺寸', () => {
    expect(imageSize(png(320, 240))).toEqual({ w: 320, h: 240 });
    expect(imageSize(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 20, 0, 0, 0]))).toEqual({ w: 10, h: 20 });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 50, 0, 70, 3, 0, 0, 0]);
    expect(imageSize(jpg)).toEqual({ w: 70, h: 50 });
  });
});
