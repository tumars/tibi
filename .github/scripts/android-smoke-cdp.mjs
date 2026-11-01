// Android 冒烟测试的界面部分（android-smoke.sh 调）：经 Chrome DevTools 协议连上 debug 包里的 WebView，像用户一样走一遍：
//   欢迎面板点「开始」→ 书架里出现示例文章 → 打开 → 点一个生词 → 词卡里有词典释义（词典 dict.db 从安装包的资源里读）
// 用法：node android-smoke-cdp.mjs <本机端口> <输出目录>。每一步打一行日志；有一步不对就退出 1。
import { writeFileSync } from 'node:fs';

const [port = '9222', out = 'smoke'] = process.argv.slice(2);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(p => p.type === 'page' && /mobile\.html|tauri\.localhost/.test(p.url)) ?? pages.find(p => p.type === 'page');
if (!page) { console.log('没找到 WebView 页面', JSON.stringify(pages)); process.exit(1); }
console.log('页面', page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
};
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
const send = (method, params = {}) => new Promise(ok => { const id = ++seq; pending.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (expr, ms, what) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(1000)) if (await ev(expr)) { console.log('✓', what); return true; }
  console.log('✗', what); return false;
};
const text = () => ev('document.body.innerText');
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const fail = async (why) => { console.log('失败：', why); console.log('--- 诊断', await ev(`JSON.stringify({ hash: location.hash, w: document.querySelectorAll('.w').length, spans: document.querySelectorAll('.rd span').length, sid: document.querySelectorAll('[data-sid]').length, first: document.querySelector('[data-sid]')?.outerHTML.slice(0, 300), cls: [...new Set([...document.querySelectorAll('.rd *')].map(e => e.className).filter(Boolean))].slice(0, 15) })`)); console.log('--- 页面文字\n' + String(await text()).slice(0, 1500)); console.log('--- 页面错误', errors.slice(0, 10)); await shot('fail'); process.exit(1); };
await send('Runtime.enable'); await send('Page.enable');

const clickText = t => ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(t)}); if (!b) return false; b.click(); return true; })()`);

if (!await waitFor(`!!window.__TIBI_LOCAL_CORE__`, 60000, 'Core 在 WebView 里跑起来了（__TIBI_LOCAL_CORE__）')) await fail('Core 没起来');
if (!await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '开始')`, 60000, '欢迎面板的「开始」')) await fail('没有欢迎面板');
await shot('welcome');
await clickText('开始');
await ev(`location.hash = '#/library'`);
if (!await waitFor(`document.body.innerText.includes('How a Compiler Sees Your Code')`, 90000, '书架里有示例文章（导入流水线在手机上跑完）')) await fail('示例文章没进书架');
await shot('library');
await ev(`document.querySelector('.doc')?.click()`);
if (!await waitFor(`document.querySelectorAll('.w').length > 20`, 30000, '阅读器打开，正文分好词')) await fail('阅读器没打开');
await shot('reader');
const word = await ev(`(() => { const w = document.querySelector('.w.s0') ?? document.querySelector('.w.s99') ?? document.querySelector('.w'); w?.click(); return w?.textContent; })()`);
console.log('点了生词：', word);
if (!await waitFor(`/[\\u4e00-\\u9fff]/.test(document.querySelector('.wc .dict')?.textContent ?? '')`, 20000, '词卡里有中文释义（词典从安装包资源里读到）')) await fail('词卡没有释义');
console.log('释义：', await ev(`document.querySelector('.wc .dict')?.textContent`));
await shot('word');
console.log('页面错误：', errors.length ? errors.slice(0, 10) : '无');
ws.close();
console.log('界面冒烟测试通过');
