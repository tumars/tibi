import { withModelScopeMirror } from './modelMirror';

/**
 * Kokoro 语音模型优先走魔搭（同名仓库，模型 SHA-256 已比对一致），失败再走 Hugging Face。
 * 单独保留导出，兼容现有朗读 Worker 与单测引用。
 */
export function withKokoroMirror(base: typeof fetch): typeof fetch {
  return withModelScopeMirror(base, 'onnx-community/Kokoro-82M-v1.0-ONNX');
}
