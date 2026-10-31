/**
 * 运行时能力（Core 不自己做的事）：抓网页、抽正文、读密钥、读文件。
 * 桌面由 core-node 实现（undici fetch + Readability），手机由各自的运行时实现；测试用假的。
 */

export interface FetchedPage { status: number; final_url: string; content_type: string; body: string }
export interface ReadableArticle { title: string; byline?: string; excerpt?: string; lang?: string; /** 清洗后的正文 Markdown（代码块保留围栏） */ markdown: string; images: string[]; published_at?: number }

export interface Platform {
  /** 抓取网页；只在 Core 校验过 URL 之后调用。重定向每跳由实现方重查 */
  fetchUrl(url: string, opts?: { signal?: AbortSignal; timeout_ms?: number }): Promise<FetchedPage>;
  /** 可读性算法抽正文并转成 Markdown */
  extractReadable(html: string, url: string): Promise<ReadableArticle>;
  /** 读本地文件（path 已由壳登记）；手机上是沙盒内路径 */
  readFile?(path: string): Promise<Uint8Array>;
  /** 密钥：经壳按需取，只留内存（05 §8） */
  getSecret(ref: string): Promise<string | undefined>;
  /** 应用版本、平台 */
  info(): { app_version: string; platform: 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'test'; db_path: string };
  /** 是否在线（界面可提前知道 AI 跑不了） */
  isOnline(): boolean;
}

/** 测试与 dev 用的空实现 */
export function fakePlatform(overrides: Partial<Platform> = {}): Platform {
  return {
    async fetchUrl() { throw new Error('fakePlatform.fetchUrl 未实现'); },
    async extractReadable() { throw new Error('fakePlatform.extractReadable 未实现'); },
    async getSecret() { return undefined; },
    info: () => ({ app_version: '0.0.0-test', platform: 'test', db_path: ':memory:' }),
    isOnline: () => false,
    ...overrides,
  };
}
