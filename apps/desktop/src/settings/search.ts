import { useEffect, useState, type RefObject } from 'react';
import { tl } from '../lib/i18n';

/** 设置项：名称、所在分组、关键词（00 §3.8：输入"深色""api key""fsrs"能找到）。全局搜索和设置页内搜索共用 */
export const SETTINGS: { label: string; sec: string; kw: string }[] = [
  { label: '外观', sec: 'general', kw: '深色 浅色 主题 dark light theme appearance' },
  { label: '界面语言', sec: 'general', kw: 'english 英文 中文 language' },
  { label: 'Tibi 怎么称呼你', sec: 'general', kw: '昵称 名字 nickname name' },
  { label: '权限模式', sec: 'general', kw: '审批 确认 自动 permission' },
  { label: '系统朗读', sec: 'general', kw: '朗读 语音 发音 音色 tts voice' },
  { label: 'AI 朗读', sec: 'general', kw: '朗读 语音 发音 音色 kokoro tts voice' },
  { label: '默认朗读方式', sec: 'general', kw: '朗读引擎 语音 快捷键 自动播放 tts engine default' },
  { label: '每日阅读目标', sec: 'learning', kw: '目标 分钟 goal' },
  { label: '每天最多新学的词', sec: 'learning', kw: '新词 上限 new cards' },
  { label: '目标记得率', sec: 'learning', kw: 'fsrs 记得率 retention 复习' },
  { label: '出识别题', sec: 'learning', kw: '识别 题型 recognize' },
  { label: '暂停记住新的事', sec: 'memory', kw: '记忆 memory 隐私' },
  { label: '模型', sec: 'model', kw: 'api key deepseek 模型 连接 model provider openai' },
  { label: 'Tibi 能做的事', sec: 'advanced', kw: '技能 订阅 文章来源 找文章 rss feed skill' },
  { label: '其他 AI 工具', sec: 'advanced', kw: 'mcp claude code codex' },
  { label: '自动备份', sec: 'data', kw: '备份 恢复 backup restore' },
  { label: '导出学习汇总', sec: 'data', kw: '导出 汇总 export' },
  { label: '检查更新', sec: 'about', kw: '更新 升级 新版本 版本 update upgrade version' },
  { label: '自动检查更新', sec: 'about', kw: '更新 升级 自动 update auto' },
  { label: '反馈与建议', sec: 'about', kw: '反馈 建议 问题 报错 bug 意见 联系 邮件 feedback issue report contact email' },
  { label: '关于作者', sec: 'about', kw: '作者 开发者 博客 邮箱 twitter github email author developer' },
  { label: '请作者喝咖啡', sec: 'about', kw: '捐赠 打赏 赞助 支付宝 微信 收款码 donate coffee sponsor alipay wechat' },
];

const ROWS = '.item, .prov, .pform';
const HIGHLIGHT = 'settings-search';

/** 这一项的文字（含按钮、选项上的字，"深色"才能找到"外观"）加上它的关键词 */
function hits(el: Element, q: string) {
  const title = (el.matches('h2, h3') ? el : el.querySelector('.t'))?.textContent?.trim();
  const s = SETTINGS.find(x => tl(x.label) === title);
  return `${el.textContent} ${s ? `${s.label} ${s.kw}` : ''}`.toLowerCase().includes(q);
}

function collectRanges(el: Element, q: string, out: Range[]) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (node.parentElement?.tagName === 'OPTION') continue;
    const text = node.data.toLowerCase();
    for (let i = text.indexOf(q); i >= 0 && i + q.length <= node.length; i = text.indexOf(q, i + q.length)) {
      const r = new Range(); r.setStart(node, i); r.setEnd(node, i + q.length); out.push(r);
    }
  }
}

/** 按 q 显示 / 隐藏设置项，返回命中数和没有命中的分组。标题命中时整组都留下 */
function applySettingsSearch(root: Element, q: string) {
  let total = 0; const missed: string[] = []; const ranges: Range[] = [];
  root.querySelectorAll<HTMLElement>('.ssec').forEach(sec => {
    const h2 = sec.querySelector('h2');
    const secHit = !!q && !!h2 && hits(h2, q);
    if (q && secHit && h2) collectRanges(h2, q, ranges);
    let n = 0;
    sec.querySelectorAll<HTMLElement>('.group').forEach(group => {
      const prev = group.previousElementSibling as HTMLElement | null;
      const h3 = prev?.tagName === 'H3' ? prev : null;
      const headHit = secHit || (!!q && !!h3 && hits(h3, q));
      let m = 0;
      group.querySelectorAll<HTMLElement>(ROWS).forEach(row => {
        const hit = !q || headHit || hits(row, q);
        row.hidden = !hit;
        if (hit) { m++; if (q) collectRanges(row, q, ranges); }
      });
      group.hidden = !!q && m === 0;
      if (h3) { h3.hidden = group.hidden; if (q && m) collectRanges(h3, q, ranges); }
      n += m;
    });
    sec.hidden = !!q && n === 0;
    if (q && n === 0) missed.push(sec.id.replace(/^s-/, ''));
    total += n;
  });
  // 用 Highlight API 上色，不改 DOM：这些文字节点归 React 管，塞 <mark> 会让它之后更新不到
  if ('highlights' in CSS) { if (ranges.length) CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges)); else CSS.highlights.delete(HIGHLIGHT); }
  return { total, missed: missed.join(' ') };
}

/** 设置页内搜索。设置项是各子组件异步加载的，所以盯着 DOM，内容一变就重新过滤 */
export function useSettingsSearch(root: RefObject<HTMLElement | null>, query: string) {
  const [result, setResult] = useState({ total: 0, missed: '' });
  useEffect(() => {
    const el = root.current; if (!el) return;
    const q = query.trim().toLowerCase();
    const run = () => { const r = applySettingsSearch(el, q); setResult(p => (p.total === r.total && p.missed === r.missed ? p : r)); };
    run();
    el.closest('.scroll')?.scrollTo({ top: 0 });
    if (!q) return;
    const mo = new MutationObserver(run);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [root, query]);
  useEffect(() => () => { if ('highlights' in CSS) CSS.highlights.delete(HIGHLIGHT); }, []);
  return { total: result.total, missed: result.missed ? result.missed.split(' ') : [] };
}
