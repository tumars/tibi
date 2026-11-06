import type { Provider } from '@tibi/core';
import { isTauri, rpc } from '../rpc';
import { tl } from './i18n';
import { isAppStore } from './update';

export type ProviderDraft = Partial<Provider> & { key?: string };

/** 每个服务一个密钥条目；快速 / 深入两档共用 */
const secretRef = (name: string) => `provider.${(name || 'llm').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.llm`;

/** Key 交给壳保存（只在 Tauri 里能写；浏览器 dev 模式用环境变量 TIBI_SECRET_<REF>） */
export async function storeSecret(ref: string, key: string): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('keyring_set', { ref, secret: key });
  return true;
}

export async function saveProvider(d: ProviderDraft): Promise<{ provider: Provider; keyStored: boolean }> {
  if (isAppStore) {
    const endpoint = d.base_url || 'https://api.deepseek.com';
    const consentKey = `tibi.ai-sharing.v1:${endpoint}`;
    if (localStorage.getItem(consentKey) !== 'yes') {
      const { invoke } = await import('@tauri-apps/api/core');
      const accepted = await invoke<boolean>('confirm_ai_sharing', {
        message: tl('启用 AI 后，Tibi 会将任务需要的文章、句子、问题和学习信息发送给你选择的第三方模型服务：{service}（{url}）。对方按其隐私政策处理数据。你可以在设置中删除连接，停止发送。是否同意？', { service: d.name || 'DeepSeek', url: endpoint }),
        agree: tl('同意并连接'), cancel: tl('取消'),
      });
      if (!accepted) throw new Error(tl('未同意分享，模型连接未保存'));
      localStorage.setItem(consentKey, 'yes');
    }
  }
  const ref = secretRef(d.name ?? 'llm');
  const keyStored = d.key ? await storeSecret(ref, d.key) : false;
  const provider = await rpc.call('providers.upsert', { provider: { id: d.id, kind: d.kind ?? 'llm', name: d.name ?? 'DeepSeek', protocol: d.protocol ?? 'openai_compatible', base_url: d.base_url, auth: 'api_key', tier: d.tier ?? 'fast', model: d.model ?? 'deepseek-flash', is_default: d.is_default ?? true }, secret_ref: d.key ? ref : undefined });
  return { provider, keyStored };
}

/** 删除一条连接；没有别的记录再用这个 Key 时，同时把 Key 删掉 */
export async function deleteProvider(id: string): Promise<void> {
  const { secret_ref } = await rpc.call('providers.delete', { id });
  if (!secret_ref || !isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('keyring_delete', { ref: secret_ref });
}

/** 预设（00 §3.9 连接模型）：两档模型；pi-ai 目录里的 DeepSeek id 见 T6 */
export const PRESETS = {
  deepseek: { name: 'DeepSeek', base_url: 'https://api.deepseek.com', fast: 'deepseek-flash', deep: 'deepseek-v4-pro' },
  custom: { name: '', base_url: '', fast: '', deep: '' },
} as const;
