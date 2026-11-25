import type { Provider } from '@tibi/core';
import { isTauri, isWeb, rpc } from '../rpc';
import { tl } from './i18n';
import { isAppStore } from './update';

export type ProviderDraft = Partial<Provider> & { key?: string; reuse_secret_from?: string };

/**
 * 硅基流动邀请码（可选）：维护者构建时通过环境变量 VITE_SILICONFLOW_REFERRAL 注入，留空则直达官网注册页。
 */
export const SILICONFLOW_REFERRAL_CODE = ((import.meta.env?.VITE_SILICONFLOW_REFERRAL as string | undefined) ?? '').trim();

export function siliconflowRegisterUrl(code = SILICONFLOW_REFERRAL_CODE): string {
  const clean = code.trim();
  return clean ? `https://cloud.siliconflow.cn/i/${encodeURIComponent(clean)}` : 'https://cloud.siliconflow.cn/';
}

/** 每个服务一个密钥条目；LLM 的快速 / 深入两档共用；非英文名退回域名作为 slug，避免中文名碰撞 */
export function secretRef(name: string, kind: Provider['kind'] = 'llm', baseUrl?: string): string {
  const fromName = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let slug = fromName;
  if (!slug && baseUrl) {
    try { slug = new URL(baseUrl).hostname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); } catch { /* 忽略 */ }
  }
  return `provider.${slug || kind}.${kind}`;
}

/** Key 交给壳保存（Tauri：钥匙串；Web 版：IndexedDB；浏览器 dev 模式写不了，用环境变量 TIBI_SECRET_<REF>） */
export async function storeSecret(ref: string, key: string): Promise<boolean> {
  if (isWeb()) { await (await import('../web/secrets')).setSecret(ref, key); return true; }
  if (!isTauri()) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('keyring_set', { ref, secret: key });
  return true;
}

export async function removeSecret(ref: string): Promise<void> {
  if (isWeb()) { await (await import('../web/secrets')).deleteSecret(ref); return; }
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('keyring_delete', { ref });
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
  const kind = d.kind ?? 'llm';
  const ref = secretRef(d.name ?? kind, kind, d.base_url);
  const keyStored = d.key ? await storeSecret(ref, d.key) : !!d.reuse_secret_from;
  const provider = await rpc.call('providers.upsert', {
    provider: {
      id: d.id, kind, name: d.name ?? (kind === 'asr' ? 'Groq Whisper' : 'DeepSeek'),
      protocol: d.protocol ?? (kind === 'asr' ? 'groq_whisper' : 'openai_compatible'),
      base_url: d.base_url, auth: 'api_key',
      ...(kind === 'llm' ? { tier: d.tier ?? 'fast' } : {}),
      model: d.model ?? (kind === 'asr' ? 'whisper-large-v3-turbo' : 'deepseek-flash'),
      is_default: d.is_default ?? true,
    },
    ...(d.key ? { secret_ref: ref } : {}),
    ...(!d.key && d.reuse_secret_from ? { reuse_secret_from: d.reuse_secret_from } : {}),
  });
  return { provider, keyStored };
}

/** 删除一条连接；没有别的记录再用这个 Key 时，同时把 Key 删掉 */
export async function deleteProvider(id: string): Promise<void> {
  const { secret_ref } = await rpc.call('providers.delete', { id });
  if (secret_ref) await removeSecret(secret_ref);
}

/** 是否属于硅基流动平台（用于设置页提供一键复用同一把 Key 开启免费云端转写） */
export function isSiliconFlowProvider(p: Pick<Provider, 'base_url' | 'protocol' | 'name'>): boolean {
  return (p.base_url ?? '').toLowerCase().includes('siliconflow') || p.protocol === 'siliconflow_asr';
}

/** 预设（00 §3.9 连接模型）：DeepSeek 官方与硅基流动（国内一站式：LLM + 免费 ASR） */
export const PRESETS = {
  deepseek: {
    name: 'DeepSeek',
    base_url: 'https://api.deepseek.com',
    fast: 'deepseek-flash',
    deep: 'deepseek-v4-pro',
    registerUrl: 'https://platform.deepseek.com/',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  siliconflow: {
    name: '硅基流动',
    base_url: 'https://api.siliconflow.cn/v1',
    fast: 'deepseek-ai/DeepSeek-V3.2',
    deep: 'deepseek-ai/DeepSeek-R1',
    asrName: '硅基流动 SenseVoice',
    asrProtocol: 'siliconflow_asr',
    asrModel: 'FunAudioLLM/SenseVoiceSmall',
    registerUrl: siliconflowRegisterUrl(),
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  custom: { name: '', base_url: '', fast: '', deep: '' },
} as const;

/** 云端语音转写（ASR）服务商预设 */
export const ASR_PRESETS = [
  {
    name: '硅基流动 SenseVoice',
    protocol: 'siliconflow_asr',
    base_url: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    registerUrl: siliconflowRegisterUrl(),
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    name: 'Groq Whisper',
    protocol: 'groq_whisper',
    base_url: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3-turbo',
    registerUrl: 'https://console.groq.com/',
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    name: 'OpenAI Whisper',
    protocol: 'openai_whisper',
    base_url: 'https://api.openai.com/v1',
    model: 'whisper-1',
    registerUrl: 'https://platform.openai.com/',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    name: 'Deepgram Nova-3',
    protocol: 'deepgram',
    base_url: 'https://api.deepgram.com',
    model: 'nova-3',
    registerUrl: 'https://console.deepgram.com/',
    keyUrl: 'https://console.deepgram.com/',
  },
] as const;

/** 硅基流动一站式保存：一把 Key 同时配置快速档 + 深入档，可选同时开通免费电台语音转写 */
export async function saveSiliconFlowBundle(opts: {
  key: string;
  includeAsr?: boolean;
  isDefaultLlm?: boolean;
  isDefaultAsr?: boolean;
}): Promise<{ fast: Provider; deep: Provider; asr?: Provider; keyStored: boolean }> {
  const sf = PRESETS.siliconflow;
  const first = await saveProvider({
    name: sf.name, kind: 'llm', protocol: 'openai_compatible', base_url: sf.base_url,
    model: sf.fast, tier: 'fast', is_default: opts.isDefaultLlm ?? true, key: opts.key,
  });
  const second = await saveProvider({
    name: sf.name, kind: 'llm', protocol: 'openai_compatible', base_url: sf.base_url,
    model: sf.deep, tier: 'deep', is_default: opts.isDefaultLlm ?? true, reuse_secret_from: first.provider.id,
  });
  let asr: Provider | undefined;
  if (opts.includeAsr) {
    const r = await saveProvider({
      name: sf.asrName, kind: 'asr', protocol: sf.asrProtocol, base_url: sf.base_url,
      model: sf.asrModel, is_default: opts.isDefaultAsr ?? true, reuse_secret_from: first.provider.id,
    });
    asr = r.provider;
  }
  return { fast: first.provider, deep: second.provider, asr, keyStored: first.keyStored };
}
