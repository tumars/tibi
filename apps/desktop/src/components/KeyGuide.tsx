import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { tl } from '../lib/i18n';
import { ASR_PRESETS, PRESETS } from '../lib/providers';
import { openLink } from '../settings/AuthorItems';

export type GuideKind = 'deepseek' | 'siliconflow' | 'siliconflow_asr' | 'groq_whisper' | 'openai_whisper' | 'deepgram';

/**
 * 极简 3 步获取 API Key 向导（复用在首次引导、设置 → 模型、手机端模型页）：
 * - 默认收起为一行轻量操作条（不抢占空间），一键直达控制台或展开查看步骤；
 * - 所有外链统一经 openLink，桌面端交系统浏览器打开（符合 capabilities 白名单）。
 */
export function KeyGuide({ kind, defaultOpen = false, compact = false }: { kind: GuideKind; defaultOpen?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  const info = guideFor(kind);
  if (!info) return null;

  return (
    <div className={`kguide${compact ? ' compact' : ''}`}>
      <div className="kguide-bar">
        <button type="button" className="linkbtn kguide-toggle" onClick={() => setOpen(v => !v)}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {tl('怎么获取 API Key？')}
        </button>
        <div className="kguide-links">
          {info.registerUrl && info.registerLabel && (
            <a className="linkbtn" href={info.registerUrl} target="_blank" rel="noopener noreferrer" onClick={e => void openLink(e)}>
              {info.registerLabel}<ExternalLink size={11} />
            </a>
          )}
          <a className="linkbtn" href={info.keyUrl} target="_blank" rel="noopener noreferrer" onClick={e => void openLink(e)}>
            {info.keyLabel}<ExternalLink size={11} />
          </a>
        </div>
      </div>
      {open && (
        <ol className="kguide-steps">
          {info.steps.map((s, idx) => <li key={idx}>{s}</li>)}
        </ol>
      )}
    </div>
  );
}

function guideFor(kind: GuideKind): {
  registerUrl?: string;
  registerLabel?: string;
  keyUrl: string;
  keyLabel: string;
  steps: string[];
} | undefined {
  if (kind === 'deepseek') {
    return {
      registerUrl: PRESETS.deepseek.registerUrl,
      registerLabel: tl('打开 DeepSeek 平台'),
      keyUrl: PRESETS.deepseek.keyUrl,
      keyLabel: tl('直接去创建 Key'),
      steps: [
        tl('打开 DeepSeek 开放平台注册账号，微信或支付宝充值几元即可用很久'),
        tl('在左侧进入「API Keys」，新建并复制以 sk- 开头的密钥'),
        tl('粘贴到上方输入框，点击「测试连接」通过后即可使用'),
      ],
    };
  }
  if (kind === 'siliconflow' || kind === 'siliconflow_asr') {
    return {
      registerUrl: PRESETS.siliconflow.registerUrl,
      registerLabel: tl('注册硅基流动'),
      keyUrl: PRESETS.siliconflow.keyUrl,
      keyLabel: tl('打开 API 密钥页'),
      steps: [
        tl('打开硅基流动注册账号（国内直连、支持微信/支付宝，新用户常含体验额度）'),
        tl('进入左侧「API 密钥」，新建并复制以 sk- 开头的密钥'),
        tl('粘贴到上方测试连接；同一把 Key 可同时用于 DeepSeek 对话与免费播客语音转写'),
      ],
    };
  }
  const asr = ASR_PRESETS.find(p => p.protocol === kind);
  if (!asr) return undefined;
  if (kind === 'groq_whisper') {
    return {
      keyUrl: asr.keyUrl,
      keyLabel: tl('打开 Groq Console'),
      steps: [
        tl('登录 Groq Console（需国际网络环境），进入 API Keys 页面'),
        tl('创建并复制以 gsk_ 开头的密钥，粘贴到上方保存'),
        tl('如果不方便访问海外服务，推荐使用上方的「本地离线转写」或「硅基流动」'),
      ],
    };
  }
  if (kind === 'openai_whisper') {
    return {
      keyUrl: asr.keyUrl,
      keyLabel: tl('打开 OpenAI API Keys'),
      steps: [
        tl('登录 OpenAI 控制台并确保账户有余额，新建以 sk- 开头的密钥'),
        tl('粘贴到上方输入框保存，支持标准 Whisper 精准句级时间戳'),
      ],
    };
  }
  return {
    keyUrl: asr.keyUrl,
    keyLabel: tl('打开 Deepgram Console'),
    steps: [
      tl('登录 Deepgram 控制台创建项目并生成 API Key（新账号含免费试用额度）'),
      tl('粘贴到上方保存，Nova-3 支持多人播客自动说话人分离'),
    ],
  };
}
