/**
 * Hugging Face 在中国大陆连不上，白名单仓库优先走魔搭镜像（modelscope.cn 同名仓库），失败再退回原地址。
 * 换 fetch 而不是改 env.remoteHost：部分库（如 kokoro-js）把音色地址写死了 huggingface.co；同时缓存键仍保持原 Hugging Face URL。
 */
export function withModelScopeMirror(base: typeof fetch, repos: string | readonly string[]): typeof fetch {
  const list = (typeof repos === 'string' ? [repos] : repos).map(repo => ({
    hf: `https://huggingface.co/${repo}/`,
    ms: `https://modelscope.cn/models/${repo}/`,
  }));
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const hit = list.find(r => url.startsWith(r.hf));
    if (!hit) return base(input, init);
    try {
      const res = await base(hit.ms + url.slice(hit.hf.length), init);
      if (res.ok) return res;
    } catch (e) {
      if (init?.signal?.aborted) throw e;
    }
    return base(input, init);
  };
}
