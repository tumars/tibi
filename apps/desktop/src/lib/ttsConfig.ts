import { rpc } from '../rpc';

export const TTS_SETTING_KEYS = ['tts.engine', 'tts.voice', 'tts.ai_voice', 'tts.rate'] as const;

/** 把设置里的朗读配置应用到 TTS 模块 */
export function applyTtsSettings(s: Record<string, unknown>): void {
  void import('./tts').then(t => t.configure({
    engine: (s['tts.engine'] as 'system' | 'kokoro') ?? 'system',
    voice: (s['tts.voice'] as string) ?? '',
    aiVoice: (s['tts.ai_voice'] as string) || undefined,
    rate: Number(s['tts.rate'] ?? 1) || 1,
  }));
}

/** 从 Core 读取朗读设置并立即应用（桌面主窗口、托盘、手机端共用） */
export function syncTtsFromSettings(): Promise<void> {
  return rpc.call('settings.get', { keys: [...TTS_SETTING_KEYS] }).then(applyTtsSettings, () => undefined);
}
