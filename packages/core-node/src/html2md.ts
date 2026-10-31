import { parseHTML } from 'linkedom';
import { web } from '@tibi/core';

/** linkedom 解析（Node 里没有 DOMParser）；实现在 @tibi/core 的 web/html.ts，手机 WebView 里用 DOMParser */
export const linkedomParse: web.HtmlParser = html => parseHTML(html).document as unknown as Document;
export const htmlToMarkdown = (html: string, baseUrl?: string) => web.htmlToMarkdown(html, baseUrl, linkedomParse);
