import { useSyncExternalStore } from 'react';
import { isTauri, isWeb } from '../rpc/client';

// 正文图片块的地址 → 能放进 <img> 的地址（Core 只存原样的 src）
// - sample:<示例 id>/<文件名>：内置示例的插图，随前端打包（真相源在 packages/core/samples/<id>/）
// - asset:<key>/<文件名>：导入的书里的插图（Platform.saveAsset），在应用数据目录的 assets/ 下，经 Tauri 的 asset 协议读；Web 版在 OPFS 里
// - http(s)：原样
// 其他（相对路径等）认不出来，不显示
const SAMPLE_IMAGES = import.meta.glob('../../../../packages/core/samples/*/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const bySample = new Map(Object.entries(SAMPLE_IMAGES).map(([k, url]) => [k.split('/samples/')[1]!, url]));

// 应用数据目录要异步取：启动时先取好；取到之前渲染的 asset: 图片在取到后重渲染一次（useImageSrcReady）
let assetUrl: ((rel: string) => string) | undefined;
const listeners = new Set<() => void>();
// Web 版：插图在 OPFS 里，由 Service Worker（public/web-sw.js）读
if (isWeb()) assetUrl = rel => `${import.meta.env.BASE_URL}__assets/${rel}`;
else if (isTauri()) {
  void Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/path')]).then(async ([core, path]) => {
    const dir = await path.appDataDir(); const sep = path.sep();
    assetUrl = rel => core.convertFileSrc([dir.replace(/[\\/]+$/, ''), 'assets', ...rel.split('/')].join(sep));
    for (const l of listeners) l();
  }).catch(() => undefined);
}

/** asset: 地址能不能换了；正文里有图片块的组件用它，取到应用数据目录后自动重渲染 */
export function useImageSrcReady(): boolean {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => !!assetUrl);
}

export function resolveImageSrc(src: string): string | undefined {
  if (src.startsWith('sample:')) return bySample.get(src.slice('sample:'.length));
  if (src.startsWith('asset:')) { const rel = src.slice('asset:'.length); return /^[\w-]+\/[\w-][\w.-]*$/.test(rel) ? assetUrl?.(rel) : undefined; }
  if (/^https?:\/\//i.test(src)) return src;
  return undefined;
}
