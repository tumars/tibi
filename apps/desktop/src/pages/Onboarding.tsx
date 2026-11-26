import type { SampleInfo } from '@tibi/core';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Fox } from '../components/Fox';
import { KeyGuide } from '../components/KeyGuide';
import { sampleMeta } from '../components/Samples';
import { GenreBadge } from '../components/TibiIcons';
import { InfoTip } from '../components/ui';
import { PRESETS, saveProvider, saveSiliconFlowBundle } from '../lib/providers';
import { classifyInput, GENRE_NAMES, isImeKey } from '../lib/util';
import { errorInfo, isWeb, rpc } from '../rpc';
import { AnalyticsItem } from '../settings/AnalyticsItem';
import { useCore } from '../store/core';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';

/**
 * 首次启动引导（00 §3.9，原型 onboarding.html）。没有侧栏，一张居中的卡片。
 * 主流程三步：先认识一下 → 连接模型 → 读第一篇。另有单独入口 ?step=3 连接模型，完成后回到 from。
 * 不问英语水平、目标，也不测词汇量：生词只看用户自己标的。
 */
const MATS = [['tech', tl('技术文档')], ['news', tl('新闻')], ['lit', tl('小说')], ['academic', tl('论文')], ['blog', tl('社交媒体 / 博客')]] as const;
const BACK: Record<string, [string, string]> = { settings: ['/settings', tl('设置')], reader: ['/library', tl('书架')], home: ['/', tl('首页')] };

export const ONBOARDING_KEY = 'onboarding.done';
const markDone = () => rpc.call('settings.set', { patch: { [ONBOARDING_KEY]: true } }).catch(() => undefined);

type Step = 1 | 3 | 4;

export function Onboarding() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const single = (Number(params.get('step')) === 3 ? 3 : 0) as 0 | 3;
  const back = params.get('back');   // 从阅读器来：回到原来那一页
  const [backTo, backLabel] = back?.startsWith('/') ? [back, tl('阅读')] : BACK[params.get('from') ?? 'home'] ?? BACK.home!;
  const [step, setStep] = useState<Step>(single || 1);
  const [say, setSay] = useState(tl('你好，我是 Tibi。'));
  const [fox, setFox] = useState('idle');
  // 第 1 步
  const [nick, setNick] = useState('');
  const [mats, setMats] = useState<string[]>(['tech', 'news']);
  const [modelOk] = useState(() => !!useCore.getState().status?.models.ok);   // 进来时就连好了（如同步过来）才跳过；不随本步连上而变，上一步还能回到这里

  const saveProfile = async (skip: boolean) => {
    if (skip) return;
    try {
      await rpc.call('profile.update', { patch: { interests: mats, assistant_prefs: { nickname: nick.trim() || '你' } } });
      void useCore.getState().refresh();
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const go = (n: Step) => { setStep(n); setSay(({ 1: tl('你好，我是 Tibi。'), 3: tl('连上模型后才能讲解和总结。'), 4: tl('先读一篇。') } as const)[n]); setFox('idle'); };
  const leave = (to: string) => { setFox('happy'); setTimeout(() => nav(to, { replace: true }), 500); };

  return (
    <div className="obwrap">
      <div className="ob">
        <aside className="left">
          <div className="obbrand"><img src="/logo.svg" alt="" />Tibi</div>
          <Fox className="fx" size={150} state={fox} />
          <div className="obsay">{say}</div>
          {!single && <ol className="obsteps">
            <li className={step === 1 ? 'cur' : 'done'}><i>{step === 1 ? 1 : <Check size={12} strokeWidth={3.5} />}</i>{tl('先认识一下')}</li>
            <li className={step === 3 ? 'cur' : step === 4 ? 'done' : ''}><i>{step === 4 ? <Check size={12} strokeWidth={3.5} /> : 2}</i>{tl('连接模型')}</li>
            <li className={step === 4 ? 'cur' : ''}><i>3</i>{tl('读第一篇')}</li>
          </ol>}
        </aside>
        <section className="right">
          {step === 1 && <div className="pane">
            <div className="pane-head">
              <h1>{tl('先认识一下')}</h1>
              <InfoTip content={tl('用于推荐阅读材料，可跳过并随时在设置中修改。')} />
            </div>
            <div className="f"><label className="t" htmlFor="nick">{tl('Tibi 怎么称呼你')}</label><input id="nick" className="input" value={nick} maxLength={20} placeholder={tl('比如：小孟')} onFocus={() => setFox('listening')} onBlur={() => setFox('idle')} onChange={e => { setNick(e.target.value); if (e.target.value.trim()) setSay(tl('{v0}，你好。', { v0: e.target.value.trim() })); }} /></div>
            <div className="f"><span className="t">{tl('你平时常读的材料（可多选）')}</span><div className="opts">{MATS.map(([v, l]) => <button key={v} className={`chip${mats.includes(v) ? ' on' : ''}`} onClick={() => setMats(m => m.includes(v) ? m.filter(x => x !== v) : [...m, v])}>{l}</button>)}</div></div>
            <AnalyticsItem firstRun />
          </div>}
          {step === 3 && <ConnectModel onFox={setFox} onSay={setSay} onDone={() => { if (single) leave(backTo); else go(4); }} onCancel={() => { toast(tl('已跳过，之后可在设置里连接')); if (single) nav(backTo, { replace: true }); else go(4); }} doneLabel={single ? tl('保存并回到{backLabel}', { backLabel }) : tl('继续')} onBack={single ? undefined : () => go(1)} />}
          {step === 4 && <FirstRead onFox={setFox} onSay={setSay} onOpen={id => { void markDone(); leave(`/read/${id}`); }} onSkip={() => { void markDone(); leave('/'); }} onBack={() => go(modelOk ? 1 : 3)} />}
          {step === 1 && <footer className="foot">
            <span className="sp" />
            <button className="skip" onClick={async () => { await saveProfile(true); go(modelOk ? 4 : 3); }}>{tl('跳过')}</button>
            <button className="btn pri" onClick={async () => { await saveProfile(false); go(modelOk ? 4 : 3); }}>{tl('继续')}</button>
          </footer>}
        </section>
      </div>
    </div>
  );
}

/* ---------- 读第一篇 ---------- */
function FirstRead({ onFox, onSay, onOpen, onSkip, onBack }: { onFox: (s: string) => void; onSay: (s: string) => void; onOpen: (id: string) => void; onSkip: () => void; onBack: () => void }) {
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [pick, setPick] = useState<string>();
  const [text, setText] = useState('');
  const [state, setState] = useState<{ title: string; sample: boolean; running: boolean; doc?: { id: string; level?: string }; error?: string }>();
  const started = useRef(false);
  const openWhenDone = useRef(false);   // 点了「开始阅读」才导入的：好了直接打开
  const activeCleanup = useRef<(() => void) | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; activeCleanup.current?.(); activeCleanup.current = undefined; };
  }, []);

  const run = async (source: { type: 'sample'; id: string } | { type: 'url'; url: string } | { type: 'text'; text: string }, title: string) => {
    activeCleanup.current?.();
    setState({ title, sample: source.type === 'sample', running: true }); onFox('reading');
    let importId: string | undefined; const early = new Map<string, { id?: string; error?: string }>();
    const finish = (r: { id?: string; error?: string }) => {
      offDone();
      if (activeCleanup.current === offDone) activeCleanup.current = undefined;
      if (!mounted.current) return;
      if (r.id) {
        if (openWhenDone.current) { onOpen(r.id); return; }
        void rpc.call('documents.get', { id: r.id }).then(
          d => { if (!mounted.current) return; setState(s => s && { ...s, title: d.title, running: false, doc: { id: d.id, level: d.level } }); onFox('happy'); onSay(tl('第一篇准备好了。')); },
          e => { if (!mounted.current) return; setState(s => s && { ...s, running: false, error: errorInfo(e).message }); onFox('idle'); },
        );
      } else {
        setState(s => s && { ...s, running: false, error: r.error ?? tl('导入失败') }); onFox('idle');
      }
    };
    const offDone = rpc.on('import.done', d => { const r = d.ok ? { id: d.document_id } : { error: d.error }; if (!importId) early.set(d.import_id, r); else if (d.import_id === importId) finish(r); });
    activeCleanup.current = offDone;
    try {
      const id = importId = (await rpc.call('documents.import', { source })).import_id;
      const e = early.get(id); if (e) finish(e);
    } catch (e) {
      offDone();
      if (activeCleanup.current === offDone) activeCleanup.current = undefined;
      if (mounted.current) setState(s => s && { ...s, running: false, error: errorInfo(e).message });
    }
  };

  useEffect(() => {
    rpc.call('documents.samples', {}).then(list => {
      setSamples(list);
      const def = list.find(s => s.is_default) ?? list[0];
      // 默认选中一篇，但不导入：点「开始阅读」才放进书架，换着看几篇不会都进书架
      if (def && !started.current) { started.current = true; choose(def); }
    }, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (s: SampleInfo) => { if (state?.running) return; setPick(s.id); setState(s.document_id ? { title: s.title, sample: true, running: false, doc: { id: s.document_id } } : undefined); };
  const start = () => {
    if (state?.doc) { onOpen(state.doc.id); return; }
    const s = samples.find(x => x.id === pick); if (!s) return;
    openWhenDone.current = true; void run({ type: 'sample', id: s.id }, s.title);
  };
  const importText = () => {
    const t = text.trim(); if (!t) return; setPick(undefined);
    const k = classifyInput(t);
    if (k === 'url') void run({ type: 'url', url: t }, t.replace(/^https?:\/\//, '').split('/')[0] ?? t);
    else void run({ type: 'text', text: t }, t.split(/\s+/).slice(0, 6).join(' '));
  };

  return <>
    <div className="pane">
      <div className="pane-head">
        <h1>{tl('读第一篇')}</h1>
        <InfoTip content={tl('示例文章内置总结，未连接模型亦可体验查词与标注。')} />
      </div>
      <div className="samples2">{samples.map(s => <button key={s.id} className={pick === s.id ? 'on' : ''} onClick={() => choose(s)}><span className="g"><GenreBadge genre={s.genre} book={!!s.chapters} label={tl('{v0} · 示例', { v0: GENRE_NAMES[s.genre] ?? s.genre })} /></span><span className="t">{s.title}</span><span className="m">{sampleMeta(s)}</span></button>)}</div>
      <div className="or">{tl('或者')}</div>
      <div className="urlrow"><input className="input" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !isImeKey(e.nativeEvent)) importText(); }} placeholder={tl('粘贴网址，或一段英文')} /><button className="btn" onClick={importText} disabled={!text.trim()}>{tl('导入')}</button></div>
      {state && <div className={`imp${state.running ? '' : ' finished'}`}>
        {[tl('获取内容'), tl('分句、词形还原'), tl('估文本级别'), state.sample ? tl('AI 总结（示例已备好）') : tl('AI 总结（没连模型，先跳过）')].map(l => <div key={l} className={`st ${state.running ? 'run' : state.error ? '' : 'ok'}`}><i>{!state.running && !state.error && <Check size={9} strokeWidth={4} color="white" />}</i>{l}</div>)}
        {state.doc && <div className="done">{tl('《{title}》已放进书架{v1}。', { title: state.title, v1: state.doc.level ? tl('，难度约 {level}', { level: state.doc.level }) : '' })}</div>}
        {state.error && <div className="done err">{state.error}</div>}
      </div>}
    </div>
    <footer className="foot">
      <button className="btn" onClick={onBack}>{tl('上一步')}</button>
      <span className="sp" />
      <button className="skip" onClick={onSkip}>{tl('先不读，进入 Tibi')}</button>
      <button className="btn pri" disabled={state?.running || (!state?.doc && !pick)} onClick={start}>{state?.running ? tl('正在准备…') : tl('开始阅读')}</button>
    </footer>
  </>;
}

/* ---------- 连接模型（?step=3） ---------- */
function ConnectModel({ onFox, onSay, onDone, onCancel, doneLabel, onBack }: { onFox: (s: string) => void; onSay: (s: string) => void; onDone: () => void; onCancel: () => void; doneLabel: string; onBack?: () => void }) {
  const [prov, setProv] = useState<'deepseek' | 'siliconflow' | 'custom'>('deepseek');
  const [includeAsr, setIncludeAsr] = useState(true);
  const [key, setKey] = useState('');
  const [base, setBase] = useState('');
  const [fast, setFast] = useState('');
  const [conn, setConn] = useState<{ state: 'run' | 'ok' | 'err'; text: string }>();
  const p = prov === 'deepseek' ? PRESETS.deepseek : prov === 'siliconflow' ? PRESETS.siliconflow : { name: 'Custom', base_url: base, fast, deep: fast };
  const test = async () => {
    if (!key.trim()) { setConn({ state: 'err', text: tl('先填 API Key') }); onFox('surprised'); setTimeout(() => onFox('idle'), 1200); return; }
    if (prov === 'custom' && (!base.trim() || !fast.trim())) { setConn({ state: 'err', text: tl('填上 Base URL 和模型名') }); return; }
    setConn({ state: 'run', text: tl('正在连接…') }); onFox('thinking');
    try {
      let testId: string;
      let keyStored: boolean;
      if (prov === 'siliconflow') {
        const res = await saveSiliconFlowBundle({ key: key.trim(), includeAsr, isDefaultLlm: true, isDefaultAsr: true });
        testId = res.fast.id;
        keyStored = res.keyStored;
      } else {
        const { provider, keyStored: stored } = await saveProvider({ name: p.name, base_url: p.base_url, model: p.fast, tier: 'fast', is_default: true, key: key.trim() });
        if (p.deep && p.deep !== p.fast) await saveProvider({ name: p.name, base_url: p.base_url, model: p.deep, tier: 'deep', is_default: true, reuse_secret_from: provider.id });
        testId = provider.id;
        keyStored = stored;
      }
      if (!keyStored) { setConn({ state: 'err', text: tl('浏览器模式不能写钥匙串。dev 下用环境变量 TIBI_SECRET_<REF>') }); onFox('idle'); return; }
      const r = await rpc.call('providers.test', { id: testId });
      if (r.ok) { setConn({ state: 'ok', text: tl('连接成功 · {v0}{v1}', { v0: r.model ?? p.fast, v1: r.latency_ms ? ` · ${r.latency_ms} ms` : '' }) }); onFox('happy'); onSay(tl('连接成功。')); void useCore.getState().refresh(); }
      else { setConn({ state: 'err', text: tl('连接失败：{v0}', { v0: r.error ?? '' }) }); onFox('idle'); }
    } catch (e) { setConn({ state: 'err', text: errorInfo(e).message }); onFox('idle'); }
  };
  return <>
    <div className="pane">
      <div className="pane-head">
        <h1>{tl('连接模型')}</h1>
        <InfoTip content={isWeb() ? tl('用于文章总结、语境释义与问答；查词、标注与复习可离线使用。API Key 仅保存在当前浏览器。') : tl('用于文章总结、语境释义与问答；查词、标注与复习可离线使用。API Key 仅保存在本机。')} />
      </div>
      <div className="prov">
        <button className={prov === 'deepseek' ? 'on' : ''} onClick={() => { setProv('deepseek'); setConn(undefined); }}>
          <b>DeepSeek <span className="tag">{tl('推荐')}</span></b>
          <span>{tl('官方直连、便宜、中文好，支持网页搜索')}</span>
        </button>
        <button className={prov === 'siliconflow' ? 'on' : ''} onClick={() => { setProv('siliconflow'); setConn(undefined); }}>
          <b>{tl('硅基流动')} <span className="tag">{tl('一站式')}</span></b>
          <span>{tl('国内直连，一把 Key 配齐 DeepSeek 与免费播客转写')}</span>
        </button>
        <button className={`full${prov === 'custom' ? ' on' : ''}`} onClick={() => { setProv('custom'); setConn(undefined); }}>
          <b>{tl('其他兼容 OpenAI 的服务')}</b>
          <span>{tl('自己填 Base URL 和模型名')}</span>
        </button>
      </div>
      {prov === 'custom' && <div className="keyrow" style={{ marginBottom: 8 }}><input className="input" value={base} onChange={e => setBase(e.target.value)} placeholder={tl('Base URL，如 https://api.example.com/v1')} /><input className="input" value={fast} onChange={e => setFast(e.target.value)} placeholder={tl('模型名')} /></div>}
      <div className="keyrow"><input className="input" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={tl('sk-…（只存在本机）')} /><button className="btn" onClick={test}>{tl('测试连接')}</button></div>
      {prov === 'siliconflow' && (
        <label className="ob-check">
          <input type="checkbox" checked={includeAsr} onChange={e => setIncludeAsr(e.target.checked)} />
          <span>{tl('同时开通免费电台语音转写（SenseVoiceSmall，共用此 Key）')}</span>
        </label>
      )}
      {prov !== 'custom' && <KeyGuide kind={prov} compact />}
      <div className={`conn${conn ? ' ' + conn.state : ''}`}>{conn?.state === 'run' && <span className="spin" />}{conn?.state === 'ok' && <Check size={15} strokeWidth={2.5} />}{conn?.text}</div>
      {prov === 'deepseek' && <div className="tiers"><div><span>{tl('快速档 · 讲解、语境释义、日常问答')}</span><span>{PRESETS.deepseek.fast}</span></div><div><span>{tl('深入档 · 长难句、学习洞察、出题')}</span><span>{PRESETS.deepseek.deep}</span></div></div>}
      {prov === 'siliconflow' && (
        <div className="tiers">
          <div><span>{tl('快速档 · 讲解、语境释义、日常问答')}</span><span>{PRESETS.siliconflow.fast}</span></div>
          <div><span>{tl('深入档 · 长难句、学习洞察、出题')}</span><span>{PRESETS.siliconflow.deep}</span></div>
          {includeAsr && <div><span>{tl('电台转写 · 无字幕播客免费转逐字稿')}</span><span>{PRESETS.siliconflow.asrModel}</span></div>}
        </div>
      )}
    </div>
    <footer className="foot">
      {onBack && <button className="btn" onClick={onBack}>{tl('上一步')}</button>}
      <span className="sp" />
      <button className="skip" onClick={onCancel}>{tl('先不连')}</button>
      <button className="btn pri" disabled={conn?.state !== 'ok'} onClick={() => { toast(tl('模型已连接')); onDone(); }}>{doneLabel}</button>
    </footer>
  </>;
}
