import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkGfm from 'remark-gfm';

/**
 * Tibi 回答用的 Markdown（含 GFM 表格、删除线、任务列表）。
 * 模型输出当不可信文本：HTML 只显示成文字，图片只留说明文字（不替模型请求外部地址），链接只放行 http(s)。
 * 单个换行保留成换行；remark-cjk-friendly 让 **“中文标点”** 紧贴文字时也能加粗。
 */
const plugins = [remarkGfm, remarkCjkFriendly, remarkBreaks];

const heading: Components['h1'] = ({ children }) => <h4>{children}</h4>;   // 对话里字号不分级

const components: Components = {
  h1: heading, h2: heading, h3: heading, h4: heading, h5: heading, h6: heading,
  a: ({ href, children }) => /^https?:\/\//i.test(href ?? '') ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>,
  img: ({ alt }) => <>{alt}</>,
  table: ({ children }) => <div className="mdtable"><table>{children}</table></div>,   // 宽表在自己的框里横向滚动
};

export function Markdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={plugins} components={components}>{text.replace(/^(\s*)•\s+/gm, '$1- ')}</ReactMarkdown>;
}
