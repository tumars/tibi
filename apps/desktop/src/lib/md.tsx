import remarkBreaks from 'remark-breaks';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { defaultRehypePlugins, defaultRemarkPlugins, Streamdown, type Components, type ControlsConfig } from 'streamdown';

/**
 * Tibi 回答用的 Markdown（含 GFM 表格、删除线、任务列表），由 Streamdown 渲染：流式输出时没写完的加粗、表格、代码块先补齐再画，不闪。
 * 模型输出当不可信文本：不解析 HTML（去掉 Streamdown 默认的 rehype-raw），图片只留说明文字（不替模型请求外部地址），链接只放行 http(s)。
 * 单个换行保留成换行；remark-cjk-friendly 让 **“中文标点”** 紧贴文字时也能加粗。
 */
const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkCjkFriendly, remarkBreaks];
const rehypePlugins = Object.entries(defaultRehypePlugins).filter(([k]) => k !== 'raw').map(([, p]) => p);
// 代码块只留"复制"，不要下载；表格用自己的框（手机端没有 Tailwind，也认这个框）
const controls: ControlsConfig = { code: { copy: true, download: false }, table: false, mermaid: false, image: false };

const heading: Components['h1'] = ({ children }) => <h4>{children}</h4>;   // 对话里字号不分级

const components: Components = {
  h1: heading, h2: heading, h3: heading, h4: heading, h5: heading, h6: heading,
  a: ({ href, children }) => /^https?:\/\//i.test(href ?? '') ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>,
  img: ({ alt }) => <>{alt}</>,
  strong: ({ children }) => <strong>{children}</strong>,   // Streamdown 默认画成 span，读屏和复制都认不出是强调
  table: ({ children }) => <div className="mdtable"><table>{children}</table></div>,   // 宽表在自己的框里横向滚动
};

/** streaming：这段还在往外吐字（只影响没写完的块怎么补齐，不影响最终样子） */
export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return <Streamdown className="md" mode={streaming ? 'streaming' : 'static'} isAnimating={streaming} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}
    components={components} controls={controls} lineNumbers={false} linkSafety={{ enabled: false }}>{text.replace(/^(\s*)•\s+/gm, '$1- ')}</Streamdown>;
}
