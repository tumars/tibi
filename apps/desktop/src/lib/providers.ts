import type { Provider } from '@tibi/core';
import { isTauri, rpc } from '../rpc';

export type ProviderDraft = Partial<Provider> & { key?: string };

/** 每个服务一个钥匙串条目；快速 / 深入两档共用 */
export const secretRef = (name: string) => `provider.${(name || 'llm').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.llm`;

/** Key 写进系统钥匙串（只在 Tauri 里能写；浏览器 dev 模式用环境变量 TIBI_SECRET_<REF>） */
export async function storeSecret(ref: string, key: string): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('keyring_set', { ref, secret: key });
  return true;
}

export async function saveProvider(d: ProviderDraft): Promise<{ provider: Provider; keyStored: boolean }> {
  const ref = secretRef(d.name ?? 'llm');
  const keyStored = d.key ? await storeSecret(ref, d.key) : false;
  const provider = await rpc.call('providers.upsert', { provider: { id: d.id, kind: d.kind ?? 'llm', name: d.name ?? 'DeepSeek', protocol: d.protocol ?? 'openai_compatible', base_url: d.base_url, auth: 'api_key', tier: d.tier ?? 'fast', model: d.model ?? 'deepseek-flash', is_default: d.is_default ?? true }, secret_ref: d.key ? ref : undefined });
  return { provider, keyStored };
}

/** 预设（00 §3.9 连接模型）：两档模型；pi-ai 目录里的 DeepSeek id 见 T6 */
export const PRESETS = {
  deepseek: { name: 'DeepSeek', base_url: 'https://api.deepseek.com', fast: 'deepseek-flash', deep: 'deepseek-v4-pro' },
  custom: { name: '', base_url: '', fast: '', deep: '' },
} as const;
