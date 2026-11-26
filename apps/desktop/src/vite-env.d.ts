/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_CORE_WS?: string }

// SDK 2.86.0 的 core loader 实际导出 default，官方声明只有具名导出。
declare module 'mixpanel-browser/src/loaders/loader-module-core.js' {
  const mixpanel: Pick<import('mixpanel-browser').Mixpanel, 'init'>;
  export default mixpanel;
}
