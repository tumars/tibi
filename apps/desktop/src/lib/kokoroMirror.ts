const HF_REPO = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/';
const MS_REPO = 'https://modelscope.cn/models/onnx-community/Kokoro-82M-v1.0-ONNX/';
/**
 * Hugging Face 在中国大陆连不上，这个仓库的文件先走魔搭（同名仓库，模型 SHA-256 已比对一致），失败再走原地址。
 * 换 fetch 而不是 transformers 的 env.remoteHost：kokoro-js 的音色地址写死了 huggingface.co。缓存键仍是原 URL。
 * 单独一个文件：朗读的 Worker 也要用，别把界面的代码带进去
 */
export function withKokoroMirror(base: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(HF_REPO)) return base(input, init);
    try {
      const res = await base(MS_REPO + url.slice(HF_REPO.length), init);
      if (res.ok) return res;
    } catch (e) { if (init?.signal?.aborted) throw e; }
    return base(input, init);
  };
}
