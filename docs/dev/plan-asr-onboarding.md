# 实施计划：国内一站式模型引导 + 本地离线语音转写（T43，2026-11-25）

调研见 [08-podcast-radio.md](../research/08-podcast-radio.md) §4.3，电台总体方案见 [17-podcast-radio.md](../design/17-podcast-radio.md)，决策见 [DECISIONS.md](../DECISIONS.md) T43。

## 1. 背景与目标

针对普通中文英语学习者配置 DeepSeek + Groq 的两道核心门槛：
1. **配置双平台 + 国际网络硬门槛**：Groq 需要海外网络，同时配置 LLM 与 ASR 劝退非技术用户；
2. **零成本、零配置、音频不出本机**：电台 P2 规划的本地离线 ASR 落地后，桌面端与 Web 端均可在不配任何云端 ASR Key 的情况下完成离线播客转写。

本次不引入任何托管代理服务器，坚持 `R12`（本地优先、零后端、开源 BYOK），分两步降门槛：
- **第一步（国内一站式 LLM + ASR 预设与极简引导）**：接入硅基流动（`https://api.siliconflow.cn/v1`）一站式预设，一把 Key 配齐 DeepSeek 对话（快速档 `deepseek-ai/DeepSeek-V3.2` + 深入档 `deepseek-ai/DeepSeek-R1`）与免费播客转写（`FunAudioLLM/SenseVoiceSmall`），配套 3 步获取 Key 向导、一键直达控制台与可选邀请码配置位（`VITE_SILICONFLOW_REFERRAL`）。
- **第二步（本地离线 Whisper ONNX 转写）**：复用随包已有的 `onnxruntime-web` WASM（0 新增安装包体积），在 Web Worker 中运行 `onnx-community/whisper-{tiny,base,small}.en`（q8 量化，41–249 MB），首次按需从魔搭镜像（ModelScope）高速下载，失败自动回退 Hugging Face，通过 Web Audio 原生解码任意音频格式，静音边界切窗并支持实时进度与随时取消。

## 2. 改动清单

### Core & Core-Node
- `packages/core/src/domain/profile/methods.ts`：`providers.upsert` 支持 `reuse_secret_from`（同平台跨 LLM/ASR 安全复用密钥引用，删除按引用计数回收）与同协议同地址 ASR 去重；新增 `prefersLocalAsr(ctx)`。
- `packages/core/src/domain/documents/pipeline.ts` & `methods.ts`：新增 `documents.ensureMedia { id }`（SSRF 校验下载并缓存单集音频供前端离线转写零跨域读取）；扩展 `documents.transcribe` 支持回写 `segments` + `duration_ms` + `transcript_source: 'local_asr'`；当开启并优先使用本地离线转写时，播客/本地音频导入跳过云端自动转写。
- `packages/core-node/src/media.ts`：新增 `siliconflow_asr` 协议支持（仅发送 `file` + `model`、剥离 SenseVoice `<|...|>` 控制标签、`splitMp3ByDuration` 按 ~45s 帧边界分块并发转写、`splitTextToTimedSegments` 按自然句长度比例估算句级时间戳、`testAsr` 校验 `/models`）。

### Desktop Shell & UI
- `apps/desktop/src-tauri/tauri.conf.json`：CSP `connect-src` 放行 `asset: http://asset.localhost`（开发态补 `http://127.0.0.1:3456`），允许 WebView `fetch()` 本机已缓存音频进行离线解码。
- `apps/desktop/package.json` & `vite.config.ts`：显式声明 `@huggingface/transformers@3.8.1`（复用已有锁文件版本与同版 `onnxruntime-web`），dev 态排除预打包避免首次启动 Worker 触发热重载。
- `apps/desktop/src/lib/modelMirror.ts` & `kokoroMirror.ts`：抽离通用 `withModelScopeMirror(base, repos)`，同时服务 Kokoro 与 Whisper ONNX 魔搭镜像优先下载。
- `apps/desktop/src/lib/whisperAudio.ts`、`whisper.worker.ts`、`localAsr.ts`：实现三档英文 Whisper ONNX q8 模型清单、RMS 静音边界切窗（<= 29.5s）、Whisper 输出清洗、Web Audio 16 kHz 单声道重采样、Worker 队列与取消、Cache API 状态检测与独立清理（不误伤 Kokoro）。
- `apps/desktop/src/lib/providers.ts` & `components/KeyGuide.tsx`：新增硅基流动预设、`saveSiliconFlowBundle`、`SILICONFLOW_REFERRAL_CODE` / `siliconflowRegisterUrl`、非 ASCII 服务商名 `secretRef` 域名回退防碰撞，以及可复用 3 步获取 Key 向导组件。
- `apps/desktop/src/pages/Onboarding.tsx`、`settings/ModelItems.tsx`、`mobile/Me.tsx`、`pages/Radio.tsx`、`pages/Reader.tsx`、`App.tsx`、`settings/search.ts`、`locales/en.json`：全面接入一站式预设、本地离线转写管理与单集内原地一键离线转写进度条/取消交互。

## 3. 验收结果

- `pnpm typecheck`：全仓通过。
- `pnpm --filter @tibi/desktop i18n:check`：1400 条，0 缺失 0 多余。
- `pnpm test`：68 个测试文件 / 398 项测试通过（含硅基流动 ASR、密钥复用、本地转写回写、魔搭镜像与静音切窗单测）。
- `pnpm build`：生产构建通过，`whisper.worker` 与 Kokoro 共享同一份 21 MB `ort-wasm-simd-threaded.jsep.wasm`。
- 真实浏览器端到端验证：Onboarding、Settings、Radio 与 Reader 原地点击「本地离线转写（免费）」完整走通「魔搭下载 `whisper-tiny.en` → 音频解码 → WASM 离线转写 → 句级时间戳入库 → 听读器同步高亮」，0 控制台报错与 0 CSP 拦截。
