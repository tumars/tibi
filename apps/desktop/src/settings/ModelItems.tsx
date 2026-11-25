import type { Provider } from '@tibi/core';
import { useEffect, useState } from 'react';
import { KeyGuide, type GuideKind } from '../components/KeyGuide';
import { Switch } from '../components/Switch';
import { Badge, SettingItem } from '../components/ui';
import { tl } from '../lib/i18n';
import {
  clearLocalAsrCache,
  detectDownloadedModels,
  hydrateLocalAsrConfig,
  isLocalAsrDownloaded,
  loadLocalAsr,
  LOCAL_ASR_MODELS,
  updateLocalAsrConfig,
  useLocalAsrConfig,
  type LocalAsrModelId,
} from '../lib/localAsr';
import {
  ASR_PRESETS,
  deleteProvider,
  isSiliconFlowProvider,
  PRESETS,
  saveProvider,
  saveSiliconFlowBundle,
} from '../lib/providers';
import { errorInfo, isWeb, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';

type EditingDraft = Partial<Provider> & { key?: string; bundle?: 'siliconflow'; includeAsr?: boolean };

function modelOptionLabel(id: LocalAsrModelId, sizeMb: number): string {
  if (id === 'onnx-community/whisper-tiny.en') return tl('极速版 · tiny.en（约 {mb} MB）', { mb: sizeMb });
  if (id === 'onnx-community/whisper-small.en') return tl('精准版 · small.en（约 {mb} MB）', { mb: sizeMb });
  return tl('均衡版 · base.en（推荐，约 {mb} MB）', { mb: sizeMb });
}

/** 设置 → 模型（00 §3.7、17 §3.1）：大语言模型（DeepSeek / 硅基流动一站式 / 自定义）与电台语音转写（本地离线 Whisper + 云端 BYOK ASR） */
export function ModelItems() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [editing, setEditing] = useState<EditingDraft>();
  const [removing, setRemoving] = useState<string>();
  const localCfg = useLocalAsrConfig();
  const [downloaded, setDownloaded] = useState<Set<LocalAsrModelId>>(() => new Set(LOCAL_ASR_MODELS.filter(m => isLocalAsrDownloaded(m.id)).map(m => m.id)));
  const [dl, setDl] = useState<{ state: 'idle' | 'loading' | 'err'; pct: number }>({ state: 'idle', pct: 0 });
  const [clearingLocal, setClearingLocal] = useState(false);

  const reloadProviders = () => rpc.call('providers.list', {}).then(setProviders, () => undefined);
  useEffect(() => {
    void reloadProviders();
    void hydrateLocalAsrConfig();
    void detectDownloadedModels().then(list => setDownloaded(new Set(list)));
  }, []);

  const llmProviders = providers.filter(p => p.kind === 'llm');
  const asrProviders = providers.filter(p => p.kind === 'asr');
  const siliconFlowLlm = llmProviders.find(p => isSiliconFlowProvider(p) && p.has_secret);
  const hasSiliconFlowAsr = asrProviders.some(p => isSiliconFlowProvider(p));
  const currentLocalReady = downloaded.has(localCfg.model);

  const onSaveProvider = async () => {
    if (!editing) return;
    try {
      if (editing.bundle === 'siliconflow') {
        if (!editing.key?.trim()) { toast(tl('先填 API Key'), { kind: 'err' }); return; }
        const { keyStored } = await saveSiliconFlowBundle({
          key: editing.key.trim(),
          includeAsr: editing.includeAsr ?? true,
          isDefaultLlm: !llmProviders.length,
          isDefaultAsr: !asrProviders.length,
        });
        if (!keyStored) toast(tl('浏览器模式不能写钥匙串。dev 下用环境变量 TIBI_SECRET_<REF>'));
        await reloadProviders();
        setEditing(undefined);
        toast(editing.includeAsr ? tl('已保存硅基流动模型与免费语音转写') : tl('已保存'));
        void useCore.getState().refresh();
        return;
      }
      const { provider: p, keyStored } = await saveProvider(editing);
      if (editing.key && !keyStored) toast(tl('浏览器模式不能写钥匙串。dev 下用环境变量 TIBI_SECRET_<REF>'));
      setProviders(ps => ps.some(x => x.id === p.id) ? ps.map(x => x.id === p.id ? p : x) : [...ps, p]);
      setEditing(undefined);
      toast(tl('已保存'));
      void useCore.getState().refresh();
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const reuseSiliconFlowForAsr = async () => {
    if (!siliconFlowLlm) return;
    try {
      const sf = PRESETS.siliconflow;
      await saveProvider({
        kind: 'asr', name: sf.asrName, protocol: sf.asrProtocol, base_url: sf.base_url,
        model: sf.asrModel, is_default: !asrProviders.length, reuse_secret_from: siliconFlowLlm.id,
      });
      await reloadProviders();
      toast(tl('已复用硅基流动密钥开启免费语音转写'));
      void useCore.getState().refresh();
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const testProvider = async (id: string) => {
    try { const r = await rpc.call('providers.test', { id }); toast(r.ok ? tl('连接成功{v0}', { v0: r.latency_ms ? ` · ${r.latency_ms} ms` : '' }) : tl('连接失败：{v0}', { v0: r.error ?? '' }), { kind: r.ok ? undefined : 'err' }); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const removeProvider = async (id: string) => {
    if (removing !== id) { setRemoving(id); return; }
    setRemoving(undefined);
    try {
      await deleteProvider(id);
      await reloadProviders();
      toast(tl('已删除'));
      void useCore.getState().refresh();
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const downloadLocalModel = async (modelId: LocalAsrModelId = localCfg.model) => {
    setDl({ state: 'loading', pct: 0 });
    try {
      await loadLocalAsr(modelId, pct => setDl({ state: 'loading', pct }));
      setDownloaded(prev => new Set([...prev, modelId]));
      setDl({ state: 'idle', pct: 100 });
      await updateLocalAsrConfig({ enabled: true, model: modelId });
      toast(tl('本地离线转写模型已就绪'));
      return true;
    } catch (err) {
      setDl({ state: 'err', pct: 0 });
      toast(tl('离线模型下载失败：{v0}', { v0: err instanceof Error ? err.message : String(err) }), { kind: 'err' });
      return false;
    }
  };

  const toggleLocalEnabled = async (on: boolean) => {
    if (on && !currentLocalReady) {
      await downloadLocalModel(localCfg.model);
      return;
    }
    await updateLocalAsrConfig({ enabled: on });
  };

  const changeLocalModel = async (modelId: LocalAsrModelId) => {
    await updateLocalAsrConfig({ model: modelId, ...(downloaded.has(modelId) ? {} : { enabled: false }) });
  };

  const clearLocalModels = async () => {
    if (!clearingLocal) { setClearingLocal(true); return; }
    setClearingLocal(false);
    await clearLocalAsrCache();
    setDownloaded(new Set());
    toast(tl('已清理本地转写模型缓存'));
  };

  const llmGuideKind = (draft: EditingDraft): GuideKind | undefined => {
    if (draft.bundle === 'siliconflow' || (draft.base_url ?? '').includes('siliconflow')) return 'siliconflow';
    if ((draft.base_url ?? '').includes('api.deepseek.com') || draft.name === 'DeepSeek') return 'deepseek';
    return undefined;
  };

  const asrGuideKind = (proto?: string): GuideKind | undefined => {
    if (proto === 'siliconflow_asr' || proto === 'groq_whisper' || proto === 'openai_whisper' || proto === 'deepgram') return proto;
    return undefined;
  };

  const activeSpec = LOCAL_ASR_MODELS.find(m => m.id === localCfg.model) ?? LOCAL_ASR_MODELS[1]!;
  const localStateText = dl.state === 'loading'
    ? tl('正在下载 {pct}%（魔搭镜像）…', { pct: dl.pct })
    : currentLocalReady
      ? tl('已缓存，支持离线使用')
      : tl('未下载 · 约 {mb} MB', { mb: activeSpec.sizeMb });

  return <>
    {llmProviders.map(p => (
      <div key={p.id} className="prov">
        <div>
          <div className="item-head">
            <div className="t">{p.name}</div>
            <Badge>{p.tier === 'deep' ? tl('深入') : p.tier === 'fast' ? tl('快速') : tl('未使用')}{p.is_default ? tl(' · 默认') : ''}</Badge>
            <Badge tone={p.has_secret ? 'ok' : 'neutral'}>{p.has_secret ? tl('已配置密钥') : tl('未配置密钥')}</Badge>
          </div>
          <div className="lbl">{p.model}{p.base_url ? ` · ${p.base_url}` : ''}</div>
        </div>
        <div className="ctl">
          <button className="btn sm" onClick={() => testProvider(p.id)}>{tl('测试连接')}</button>
          <button className="btn sm" onClick={() => setEditing({ ...p })}>{tl('编辑')}</button>
          <button className="btn sm danger" onClick={() => void removeProvider(p.id)} onBlur={() => setRemoving(undefined)}>{removing === p.id ? tl('确认删除') : tl('删除')}</button>
        </div>
      </div>
    ))}
    {!llmProviders.length && editing?.kind !== 'llm' && (
      <SettingItem
        title={tl('未连接语言模型')}
        tip={tl('未连接模型时，查词、标注与复习均可离线使用；推荐 DeepSeek 官方服务，或通过硅基流动一并配置对话模型与免费语音转写。')}
        control={<>
          <button className="btn sm pri" onClick={() => setEditing({ name: 'DeepSeek', kind: 'llm', protocol: 'openai_compatible', base_url: PRESETS.deepseek.base_url, model: PRESETS.deepseek.fast, tier: 'fast', is_default: true })}>{tl('连接 DeepSeek')}</button>
          <button className="btn sm" onClick={() => setEditing({ name: PRESETS.siliconflow.name, kind: 'llm', protocol: 'openai_compatible', base_url: PRESETS.siliconflow.base_url, model: PRESETS.siliconflow.fast, tier: 'fast', is_default: true, bundle: 'siliconflow', includeAsr: true })}>{tl('硅基流动（一站式）')}</button>
          <button className="btn sm" onClick={() => setEditing({ name: '', kind: 'llm', protocol: 'openai_compatible', base_url: '', model: '', tier: 'fast', is_default: !llmProviders.length })}>{tl('其他兼容服务')}</button>
        </>}
      />
    )}
    {editing?.kind === 'llm' && (
      <div className="pform">
        {editing.bundle === 'siliconflow' ? (
          <>
            <span>{tl('服务商')}</span>
            <div className="lbl" style={{ color: 'var(--ink)' }}>
              {tl('硅基流动（国内直连）· 快速档 {fast} / 深入档 {deep}', { fast: PRESETS.siliconflow.fast, deep: PRESETS.siliconflow.deep })}
            </div>
            <span>API Key</span>
            <input className="input" type="password" value={editing.key ?? ''} onChange={e => setEditing({ ...editing, key: e.target.value })} placeholder="sk-…" />
            <span />
            <label className="ob-check" style={{ margin: 0 }}>
              <input type="checkbox" checked={editing.includeAsr ?? true} onChange={e => setEditing({ ...editing, includeAsr: e.target.checked })} />
              <span>{tl('同时开通免费电台语音转写（SenseVoiceSmall，共用此 Key）')}</span>
            </label>
            <span />
            <KeyGuide kind="siliconflow" compact />
            <div className="row"><button className="btn sm pri" onClick={onSaveProvider}>{tl('保存')}</button><button className="btn sm" onClick={() => setEditing(undefined)}>{tl('取消')}</button><span className="lbl">{isWeb() ? tl('密钥仅存于当前浏览器') : tl('密钥仅存于本机')}</span></div>
          </>
        ) : (
          <>
            <span>{tl('名称')}</span><input className="input" value={editing.name ?? ''} onChange={e => setEditing({ ...editing, name: e.target.value })} />
            <span>Base URL</span><input className="input" value={editing.base_url ?? ''} onChange={e => setEditing({ ...editing, base_url: e.target.value })} placeholder="https://api.deepseek.com" />
            <span>{tl('模型')}</span><input className="input" value={editing.model ?? ''} onChange={e => setEditing({ ...editing, model: e.target.value })} placeholder="deepseek-flash" />
            <span>{tl('档位')}</span><select className="input" value={editing.tier ?? 'fast'} onChange={e => setEditing({ ...editing, tier: e.target.value as 'fast' | 'deep' })}><option value="fast">{tl('快速')}</option><option value="deep">{tl('深入')}</option></select>
            <span>API Key</span><input className="input" type="password" value={editing.key ?? ''} onChange={e => setEditing({ ...editing, key: e.target.value })} placeholder={editing.has_secret ? tl('已保存，留空不改') : 'sk-…'} />
            {llmGuideKind(editing) && <><span /><KeyGuide kind={llmGuideKind(editing)!} compact /></>}
            <div className="row"><button className="btn sm pri" onClick={onSaveProvider}>{tl('保存')}</button><button className="btn sm" onClick={() => setEditing(undefined)}>{tl('取消')}</button><span className="lbl">{isWeb() ? tl('密钥仅存于当前浏览器') : tl('密钥仅存于本机')}</span></div>
          </>
        )}
      </div>
    )}
    {llmProviders.length > 0 && editing?.kind !== 'llm' && (
      <div className="item">
        <div className="lbl">{tl('添加其他 OpenAI 兼容服务')}</div>
        <div className="ctl">
          {!siliconFlowLlm && (
            <button className="btn sm" onClick={() => setEditing({ name: PRESETS.siliconflow.name, kind: 'llm', protocol: 'openai_compatible', base_url: PRESETS.siliconflow.base_url, model: PRESETS.siliconflow.fast, tier: 'fast', is_default: false, bundle: 'siliconflow', includeAsr: !asrProviders.length })}>{tl('硅基流动（一站式）')}</button>
          )}
          <button className="btn sm" onClick={() => setEditing({ name: '', kind: 'llm', protocol: 'openai_compatible', base_url: '', model: '', tier: 'deep', is_default: false })}>{tl('添加')}</button>
        </div>
      </div>
    )}

    <SettingItem
      title={tl('本地离线转写（Whisper）')}
      badge={<Badge tone={currentLocalReady ? 'ok' : 'neutral'}>{currentLocalReady ? (localCfg.enabled ? tl('已启用') : tl('已下载')) : tl('未下载')}</Badge>}
      tip={tl('免费且无需 API Key，音频仅在本机处理，生成精准句级时间戳；首次下载优先使用魔搭镜像。')}
      status={localStateText}
      control={<>
        <select
          className="input"
          value={localCfg.model}
          disabled={dl.state === 'loading'}
          onChange={e => void changeLocalModel(e.target.value as LocalAsrModelId)}
          aria-label={tl('本地离线转写模型')}
        >
          {LOCAL_ASR_MODELS.map(m => (
            <option key={m.id} value={m.id}>{modelOptionLabel(m.id, m.sizeMb)}</option>
          ))}
        </select>
        {currentLocalReady ? (
          <>
            <Switch label={tl('启用本地离线转写')} checked={localCfg.enabled} onChange={v => void toggleLocalEnabled(v)} />
            <button className="btn sm danger" onClick={() => void clearLocalModels()} onBlur={() => setClearingLocal(false)}>
              {clearingLocal ? tl('确认清理') : tl('清理模型')}
            </button>
          </>
        ) : (
          <button className="btn sm pri" disabled={dl.state === 'loading'} onClick={() => void downloadLocalModel()}>
            {dl.state === 'loading' ? tl('下载中 {pct}%', { pct: dl.pct }) : tl('下载并启用')}
          </button>
        )}
      </>}
    />

    {localCfg.enabled && asrProviders.length > 0 && (
      <SettingItem
        title={tl('默认转写方式')}
        tip={tl('同时配置本地离线与云端转写时的默认策略，单集内可随时切换。')}
        control={
          <div className="seg">
            <button className={localCfg.preferred !== 'cloud' ? 'on' : ''} onClick={() => void updateLocalAsrConfig({ preferred: 'local' })}>{tl('本地离线优先')}</button>
            <button className={localCfg.preferred === 'cloud' ? 'on' : ''} onClick={() => void updateLocalAsrConfig({ preferred: 'cloud' })}>{tl('云端服务优先')}</button>
          </div>
        }
      />
    )}

    {asrProviders.map(p => (
      <div key={p.id} className="prov">
        <div>
          <div className="item-head">
            <div className="t">{p.name}</div>
            <Badge>{tl('云端转写')}{p.is_default ? tl(' · 默认') : ''}</Badge>
            <Badge tone={p.has_secret ? 'ok' : 'neutral'}>{p.has_secret ? tl('已配置密钥') : tl('未配置密钥')}</Badge>
          </div>
          <div className="lbl">{p.model}{p.base_url ? ` · ${p.base_url}` : ''}</div>
        </div>
        <div className="ctl">
          <button className="btn sm" onClick={() => testProvider(p.id)}>{tl('测试连接')}</button>
          <button className="btn sm" onClick={() => setEditing({ ...p })}>{tl('编辑')}</button>
          <button className="btn sm danger" onClick={() => void removeProvider(p.id)} onBlur={() => setRemoving(undefined)}>{removing === p.id ? tl('确认删除') : tl('删除')}</button>
        </div>
      </div>
    ))}
    {editing?.kind !== 'asr' && (
      <SettingItem
        title={tl('语音转写（云端 ASR）')}
        tip={tl('带官方字幕的播客无需转写；无字幕单集除本地离线转写外，也可配置硅基流动（国内直连免费）、Groq 或 Deepgram（支持说话人分离）。')}
        control={<>
          {siliconFlowLlm && !hasSiliconFlowAsr && (
            <button className="btn sm pri" onClick={() => void reuseSiliconFlowForAsr()}>{tl('复用硅基流动密钥')}</button>
          )}
          {ASR_PRESETS.map(pre => (
            <button key={pre.protocol} className="btn sm" onClick={() => setEditing({ name: pre.name, protocol: pre.protocol, base_url: pre.base_url, model: pre.model, kind: 'asr', is_default: !asrProviders.length })}>
              {pre.name}
            </button>
          ))}
        </>}
      />
    )}
    {editing?.kind === 'asr' && (
      <div className="pform">
        <span>{tl('名称')}</span><input className="input" value={editing.name ?? ''} onChange={e => setEditing({ ...editing, name: e.target.value })} />
        <span>{tl('协议')}</span>
        <select className="input" value={editing.protocol ?? 'siliconflow_asr'} onChange={e => {
          const proto = e.target.value;
          const preset = ASR_PRESETS.find(x => x.protocol === proto);
          setEditing({ ...editing, protocol: proto, ...(preset ? { name: preset.name, base_url: preset.base_url, model: preset.model } : {}) });
        }}>
          <option value="siliconflow_asr">{tl('硅基流动 SenseVoice（国内直连 · 免费）')}</option>
          <option value="groq_whisper">Groq Whisper (OpenAI 兼容)</option>
          <option value="openai_whisper">OpenAI Audio Transcriptions</option>
          <option value="deepgram">Deepgram Nova-3（含说话人分离）</option>
        </select>
        <span>Base URL</span><input className="input" value={editing.base_url ?? ''} onChange={e => setEditing({ ...editing, base_url: e.target.value })} placeholder="https://api.siliconflow.cn/v1" />
        <span>{tl('模型')}</span><input className="input" value={editing.model ?? ''} onChange={e => setEditing({ ...editing, model: e.target.value })} placeholder="FunAudioLLM/SenseVoiceSmall" />
        <span>API Key</span><input className="input" type="password" value={editing.key ?? ''} onChange={e => setEditing({ ...editing, key: e.target.value })} placeholder={editing.has_secret ? tl('已保存，留空不改') : 'sk-… / gsk_…'} />
        {asrGuideKind(editing.protocol) && <><span /><KeyGuide kind={asrGuideKind(editing.protocol)!} compact /></>}
        {editing.protocol === 'siliconflow_asr' && (
          <><span /><div className="lbl">{tl('SenseVoiceSmall 对长音频按段估算句级时间；如需精准对齐请使用本地离线转写。')}</div></>
        )}
        <div className="row"><button className="btn sm pri" onClick={onSaveProvider}>{tl('保存')}</button><button className="btn sm" onClick={() => setEditing(undefined)}>{tl('取消')}</button><span className="lbl">{isWeb() ? tl('密钥仅存于当前浏览器') : tl('密钥仅存于本机')}</span></div>
      </div>
    )}
  </>;
}
