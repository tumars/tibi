import type { SampleInfo } from '@tibi/core';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Fox } from '../components/Fox';
import { PRESETS, saveProvider } from '../lib/providers';
import { classifyInput, fmtPct, GENRE_NAMES } from '../lib/util';
import { errorInfo, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';

/**
 * 首次启动引导（00 §3.9，原型 onboarding.html）。没有侧栏，一张居中的卡片。
 * 主流程两步：1 先认识一下 → 读第一篇。另有两个单独入口：?step=2 校准词汇量、?step=3 连接模型，完成后回到 from。
 */
const GOALS = [['work', '工作里读文档和邮件'], ['ielts', '雅思 / 托福'], ['novel', '读原版书'], ['cet', '考研 / CET'], ['interest', '就是感兴趣']] as const;   // 取值与设置页一致
const LEVELS = [['beginner', '入门', '能看懂简单句子，长一点就吃力'], ['intermediate', '中级', '能读新闻大意，生词不少'], ['upper', '中高级', '能读大部分文章，偶尔查词'], ['advanced', '高级', '读原版书和论文基本不费劲']] as const;
const MATS = [['tech', '技术文档'], ['news', '新闻'], ['lit', '小说'], ['academic', '论文'], ['blog', '社交媒体 / 博客']] as const;
const LANGS = [['mixed', '中文为主，夹英文'], ['zh', '只用中文'], ['en', 'English only']] as const;
const BACK: Record<string, [string, string]> = { settings: ['/settings', '设置'], reader: ['/library', '书架'], home: ['/', '首页'] };

export const ONBOARDING_KEY = 'onboarding.done';
const markDone = () => rpc.call('settings.set', { patch: { [ONBOARDING_KEY]: true } }).catch(() => undefined);

type Step = 1 | 2 | 3 | 4;

export function Onboarding() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const single = (Number(params.get('step')) === 2 ? 2 : Number(params.get('step')) === 3 ? 3 : 0) as 0 | 2 | 3;
  const back = params.get('back');   // 从阅读器来：回到原来那一页
  const [backTo, backLabel] = back?.startsWith('/') ? [back, '阅读'] : BACK[params.get('from') ?? (single === 2 ? 'settings' : 'home')] ?? BACK.home!;
  const [step, setStep] = useState<Step>(single || 1);
  const [say, setSay] = useState('你好，我是 Tibi。');
  const [fox, setFox] = useState('idle');
  // 第 1 步
  const [nick, setNick] = useState('');
  const [goal, setGoal] = useState('work');
  const [level, setLevel] = useState('upper');
  const [mats, setMats] = useState<string[]>(['tech', 'news']);
  const [lang, setLang] = useState('mixed');
  const vocab = useCore(s => s.vocab);

  const saveProfile = async (skip: boolean) => {
    try {
      await rpc.call('profile.update', { patch: skip ? { level_self: 'upper', vocab_source: 'self' } : {
        level_self: level, vocab_source: 'self', goal, interests: mats, assistant_prefs: { nickname: nick.trim() || '你', language: lang as 'mixed' },
      } });
      void useCore.getState().refresh();
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const go = (n: Step) => { setStep(n); setSay(({ 1: '你好，我是 Tibi。', 2: '只点确定认识的词。', 3: '连上模型后才能讲解和总结。', 4: '先读一篇。' } as const)[n]); setFox(n === 2 ? 'listening' : 'idle'); };
  const leave = (to: string) => { setFox('happy'); setTimeout(() => nav(to, { replace: true }), 500); };

  return (
    <div className="obwrap">
      <div className="ob">
        <aside className="left">
          <div className="obbrand"><img src="/logo.svg" alt="" />Tibi</div>
          <Fox className="fx" size={150} state={fox} />
          <div className="obsay">{say}</div>
          {!single && <ol className="obsteps">
            <li className={step === 1 ? 'cur' : 'done'}><i>{step === 1 ? 1 : <Check size={12} strokeWidth={3.5} />}</i>先认识一下</li>
            <li className={step === 4 ? 'cur' : ''}><i>2</i>读第一篇</li>
          </ol>}
        </aside>
        <section className="right">
          {step === 1 && <div className="pane">
            <h1>先认识一下</h1>
            <p className="oblead">用来挑文章和标生词。可以跳过，之后在设置里改。</p>
            <div className="f"><label className="t" htmlFor="nick">Tibi 怎么称呼你</label><input id="nick" className="input" value={nick} maxLength={20} placeholder="比如：小孟" onFocus={() => setFox('listening')} onBlur={() => setFox('idle')} onChange={e => { setNick(e.target.value); if (e.target.value.trim()) setSay(`${e.target.value.trim()}，你好。`); }} /></div>
            <div className="f"><span className="t">你学英语是为了</span><div className="opts">{GOALS.map(([v, l]) => <button key={v} className={`chip${goal === v ? ' on' : ''}`} onClick={() => setGoal(v)}>{l}</button>)}</div></div>
            <div className="f"><span className="t">你觉得自己现在的水平</span><div className="lv4">{LEVELS.map(([v, l, d]) => <button key={v} className={level === v ? 'on' : ''} onClick={() => setLevel(v)}><b>{l}</b><span>{d}</span></button>)}</div></div>
            <div className="f"><span className="t">你平时常读的材料（可多选）</span><div className="opts">{MATS.map(([v, l]) => <button key={v} className={`chip${mats.includes(v) ? ' on' : ''}`} onClick={() => setMats(m => m.includes(v) ? m.filter(x => x !== v) : [...m, v])}>{l}</button>)}</div></div>
            <div className="f"><span className="t">Tibi 和你说话时</span><div className="opts">{LANGS.map(([v, l]) => <button key={v} className={`chip${lang === v ? ' on' : ''}`} onClick={() => setLang(v)}>{l}</button>)}</div></div>
          </div>}
          {step === 2 && <VocabTest onFox={setFox} onSay={setSay} onDone={() => leave(backTo)} onCancel={() => nav(backTo, { replace: true })} backLabel={backLabel} />}
          {step === 3 && <ConnectModel onFox={setFox} onSay={setSay} onDone={() => leave(backTo)} onCancel={() => { toast('已跳过，之后可在设置里连接'); nav(backTo, { replace: true }); }} backLabel={backLabel} />}
          {step === 4 && <FirstRead vocab={vocab} onFox={setFox} onSay={setSay} onOpen={id => { void markDone(); leave(`/read/${id}`); }} onSkip={() => { void markDone(); leave('/'); }} onBack={() => go(1)} />}
          {step === 1 && <footer className="foot">
            <span className="sp" />
            <button className="skip" onClick={async () => { await saveProfile(true); go(4); }}>跳过</button>
            <button className="btn pri" onClick={async () => { await saveProfile(false); go(4); }}>继续</button>
          </footer>}
        </section>
      </div>
    </div>
  );
}

/* ---------- 读第一篇 ---------- */
function FirstRead({ vocab, onFox, onSay, onOpen, onSkip, onBack }: { vocab: number; onFox: (s: string) => void; onSay: (s: string) => void; onOpen: (id: string) => void; onSkip: () => void; onBack: () => void }) {
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [pick, setPick] = useState<string>();
  const [text, setText] = useState('');
  const [state, setState] = useState<{ title: string; sample: boolean; running: boolean; doc?: { id: string; ratio: number }; error?: string }>();
  const started = useRef(false);

  const run = async (source: { type: 'sample'; id: string } | { type: 'url'; url: string } | { type: 'text'; text: string }, title: string) => {
    setState({ title, sample: source.type === 'sample', running: true }); onFox('reading');
    let taskId: string | undefined; const early = new Map<string, { id?: string; error?: string }>();
    const finish = (r: { id?: string; error?: string }) => {
      offDone(); offFail();
      if (r.id) { void rpc.call('documents.get', { id: r.id }).then(d => { setState(s => s && { ...s, title: d.title, running: false, doc: { id: d.id, ratio: d.unknown_ratio } }); onFox('happy'); onSay('第一篇准备好了。'); }); }
      else { setState(s => s && { ...s, running: false, error: r.error ?? '导入失败' }); onFox('idle'); }
    };
    const offDone = rpc.on('task.done', d => { if (!taskId) early.set(d.task.id, { id: d.result?.document_id }); else if (d.task.id === taskId) finish({ id: d.result?.document_id }); });
    const offFail = rpc.on('task.update', d => { if (d.task.state !== 'err') return; if (!taskId) early.set(d.task.id, { error: d.task.error }); else if (d.task.id === taskId) finish({ error: d.task.error }); });
    try {
      taskId = (await rpc.call('documents.import', { source })).task_id;
      const e = early.get(taskId); if (e) finish(e);
    } catch (e) { offDone(); offFail(); setState(s => s && { ...s, running: false, error: errorInfo(e).message }); }
  };

  useEffect(() => {
    rpc.call('documents.samples', {}).then(list => {
      setSamples(list);
      const def = list.find(s => s.is_default) ?? list[0];
      if (def && !started.current) { started.current = true; setPick(def.id); if (def.document_id) setState({ title: def.title, sample: true, running: false, doc: { id: def.document_id, ratio: 0 } }); else void run({ type: 'sample', id: def.id }, def.title); }
    }, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (s: SampleInfo) => { setPick(s.id); if (s.document_id) setState({ title: s.title, sample: true, running: false, doc: { id: s.document_id, ratio: 0 } }); else void run({ type: 'sample', id: s.id }, s.title); };
  const importText = () => {
    const t = text.trim(); if (!t) return; setPick(undefined);
    const k = classifyInput(t);
    if (k === 'url') void run({ type: 'url', url: t }, t.replace(/^https?:\/\//, '').split('/')[0] ?? t);
    else void run({ type: 'text', text: t }, t.split(/\s+/).slice(0, 6).join(' '));
  };

  return <>
    <div className="pane">
      <h1>读第一篇</h1>
      <p className="oblead">示例不连模型也能看完整效果。也可以粘贴网址或一段英文。</p>
      <div className="samples2">{samples.map(s => <button key={s.id} className={pick === s.id ? 'on' : ''} onClick={() => choose(s)}><span className="g">{GENRE_NAMES[s.genre] ?? s.genre} · 示例</span><span className="t">{s.title}</span><span className="m">约 {s.minutes} 分钟{s.author && s.author !== 'Tibi' ? ` · ${s.author}` : ''}</span></button>)}</div>
      <div className="or">或者</div>
      <div className="urlrow"><input className="input" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') importText(); }} placeholder="粘贴网址，或一段英文" /><button className="btn" onClick={importText} disabled={!text.trim()}>导入</button></div>
      {state && <div className={`imp${state.running ? '' : ' finished'}`}>
        {['获取内容', '分句、词形还原', `按你的水平（约 ${(vocab || 6000).toLocaleString()} 词）标注生词`, state.sample ? 'AI 总结（示例已备好）' : 'AI 总结（没连模型，先跳过）'].map(l => <div key={l} className={`st ${state.running ? 'run' : state.error ? '' : 'ok'}`}><i>{!state.running && !state.error && <Check size={9} strokeWidth={4} color="white" />}</i>{l}</div>)}
        {state.doc && <div className="done">《{state.title}》已放进书架{state.doc.ratio ? `，生词率 ${fmtPct(state.doc.ratio)}` : ''}。</div>}
        {state.error && <div className="done err">{state.error}</div>}
      </div>}
    </div>
    <footer className="foot">
      <button className="btn" onClick={onBack}>上一步</button>
      <span className="sp" />
      <button className="skip" onClick={onSkip}>先不读，进入 Tibi</button>
      <button className="btn pri" disabled={!state?.doc} onClick={() => state?.doc && onOpen(state.doc.id)}>开始阅读</button>
    </footer>
  </>;
}

/* ---------- 校准词汇量（?step=2） ---------- */
function VocabTest({ onFox, onSay, onDone, onCancel, backLabel }: { onFox: (s: string) => void; onSay: (s: string) => void; onDone: () => void; onCancel: () => void; backLabel: string }) {
  const [bands, setBands] = useState<{ label: string; words: string[] }[]>([]);
  const [band, setBand] = useState(0);
  const [picks, setPicks] = useState<Set<string>[]>([]);
  const [res, setRes] = useState<{ estimate: number; cefr: string; bands: number[]; pseudo_hits: number }>();
  const [manual, setManual] = useState('');
  useEffect(() => { rpc.call('vocab.start', {}).then(r => { setBands(r.bands); setPicks(r.bands.map(() => new Set())); }, e => toast(errorInfo(e).message, { kind: 'err' })); }, []);
  const cur = bands[band]; const set = picks[band] ?? new Set<string>();
  const toggle = (w: string) => setPicks(p => p.map((s, i) => { if (i !== band) return s; const n = new Set(s); if (n.has(w)) n.delete(w); else n.add(w); return n; }));
  const next = async () => {
    if (band < bands.length - 1) { setBand(band + 1); onFox('thinking'); setTimeout(() => onFox('listening'), 500); return; }
    try { const r = await rpc.call('vocab.submit', { picks: picks.map(s => [...s]) }); setRes(r); onFox('happy'); onSay('测完了。读得越多，估算越准。'); void useCore.getState().refresh(); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const save = async () => {
    const v = Number(manual);
    if (v >= 500) { try { await rpc.call('profile.update', { patch: { vocab_estimate: v, vocab_source: 'manual' } }); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); return; } }
    toast('词汇量已更新，生词会按新结果标注'); void useCore.getState().refresh(); onDone();
  };
  return <>
    <div className="pane">
      <h1>测测词汇量</h1>
      {!res ? <>
        <p className="oblead"><b>点亮确定认识的词。</b>其中混了几个不存在的词。共 {bands.length || 7} 组，约 3–4 分钟。</p>
        {cur && <>
          <div className="vt-head"><span>第 {band + 1} / {bands.length} 组</span><div className="bar2"><i style={{ width: `${band / bands.length * 100}%` }} /></div><span>词频 {cur.label}</span></div>
          <div className="vt">{cur.words.map(w => <button key={w} className={set.has(w) ? 'on' : ''} onClick={() => toggle(w)}>{w}</button>)}</div>
          <div className="vt-foot"><span>已点亮 {set.size} 个</span><span style={{ flex: 1 }} /><button className="btn sm" onClick={() => setPicks(p => p.map((s, i) => i === band ? new Set() : s))}>这组一个都不认识</button><button className="btn sm pri" onClick={next}>{band === bands.length - 1 ? '看结果' : '下一组'}</button></div>
        </>}
      </> : <>
        <p className="oblead">测完了。读得越多，估算越准。</p>
        <div className="vres">
          <div className="big"><div className="n">{res.estimate.toLocaleString()}<small>词</small></div><div className="d">估算词汇量，相当于 <b>CEFR {res.cefr}</b>。<br />{res.pseudo_hits ? `点亮了 ${res.pseudo_hits} 个不存在的词，估算已相应下调。` : '没有被伪词骗到。'}</div></div>
          <div className="box"><b>按词频看</b>各组认识的比例<div className="bands">{res.bands.map((x, i) => <i key={i} style={{ height: `${Math.max(8, x * 100)}%` }} data-l={bands[i]?.label} title={`${Math.round(x * 100)}%`} />)}</div></div>
          <div className="box"><b>怎么用这个结果</b>词频前 {res.estimate.toLocaleString()} 视为已认识，不标注；{res.estimate.toLocaleString()}–{(res.estimate + 3000).toLocaleString()} 标为待确认；更难的标为生词。</div>
        </div>
        <div className="manual">数不对？自己填：<input className="input" type="number" step={100} min={500} max={30000} placeholder={String(res.estimate)} value={manual} onChange={e => setManual(e.target.value)} /><span>词（以你填的为准）</span></div>
      </>}
    </div>
    <footer className="foot">
      <span className="sp" />
      <button className="skip" onClick={onCancel}>取消</button>
      <button className="btn pri" disabled={!res} onClick={save}>保存并回到{backLabel}</button>
    </footer>
  </>;
}

/* ---------- 连接模型（?step=3） ---------- */
function ConnectModel({ onFox, onSay, onDone, onCancel, backLabel }: { onFox: (s: string) => void; onSay: (s: string) => void; onDone: () => void; onCancel: () => void; backLabel: string }) {
  const [prov, setProv] = useState<'deepseek' | 'custom'>('deepseek');
  const [key, setKey] = useState('');
  const [base, setBase] = useState('');
  const [fast, setFast] = useState('');
  const [conn, setConn] = useState<{ state: 'run' | 'ok' | 'err'; text: string }>();
  const p = prov === 'deepseek' ? PRESETS.deepseek : { name: 'Custom', base_url: base, fast, deep: fast };
  const test = async () => {
    if (!key.trim()) { setConn({ state: 'err', text: '先填 API Key' }); onFox('surprised'); setTimeout(() => onFox('idle'), 1200); return; }
    if (prov === 'custom' && (!base.trim() || !fast.trim())) { setConn({ state: 'err', text: '填上 Base URL 和模型名' }); return; }
    setConn({ state: 'run', text: '正在连接…' }); onFox('thinking');
    try {
      const { provider, keyStored } = await saveProvider({ name: p.name, base_url: p.base_url, model: p.fast, tier: 'fast', is_default: true, key });
      if (p.deep && p.deep !== p.fast) await saveProvider({ name: p.name, base_url: p.base_url, model: p.deep, tier: 'deep', is_default: true, key });
      if (!keyStored) { setConn({ state: 'err', text: '浏览器模式不能写钥匙串。dev 下用环境变量 TIBI_SECRET_<REF>' }); onFox('idle'); return; }
      const r = await rpc.call('providers.test', { id: provider.id });
      if (r.ok) { setConn({ state: 'ok', text: `连接成功 · ${r.model ?? p.fast}${r.latency_ms ? ` · ${r.latency_ms} ms` : ''}` }); onFox('happy'); onSay('连接成功。'); }
      else { setConn({ state: 'err', text: `连接失败：${r.error ?? ''}` }); onFox('idle'); }
    } catch (e) { setConn({ state: 'err', text: errorInfo(e).message }); onFox('idle'); }
  };
  return <>
    <div className="pane">
      <h1>连接一个模型</h1>
      <p className="oblead">讲解、总结和语境释义需要模型。查词、标注和复习不需要。Key 只存在这台电脑的钥匙串里。</p>
      <div className="prov">
        <button className={prov === 'deepseek' ? 'on' : ''} onClick={() => setProv('deepseek')}><b>DeepSeek <span className="tag">推荐</span></b><span>便宜、中文好；快速档 {PRESETS.deepseek.fast}，深入档 {PRESETS.deepseek.deep}</span></button>
        <button className={prov === 'custom' ? 'on' : ''} onClick={() => setProv('custom')}><b>其他兼容 OpenAI 的服务</b><span>自己填 Base URL 和模型名</span></button>
      </div>
      {prov === 'custom' && <div className="keyrow" style={{ marginBottom: 8 }}><input className="input" value={base} onChange={e => setBase(e.target.value)} placeholder="Base URL，如 https://api.example.com/v1" /><input className="input" value={fast} onChange={e => setFast(e.target.value)} placeholder="模型名" /></div>}
      <div className="keyrow"><input className="input" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-…（只存在本机）" /><button className="btn" onClick={test}>测试连接</button></div>
      <div className={`conn${conn ? ' ' + conn.state : ''}`}>{conn?.state === 'run' && <span className="spin" />}{conn?.state === 'ok' && <Check size={15} strokeWidth={2.5} />}{conn?.text}</div>
      {prov === 'deepseek' && <div className="tiers"><div><span>快速档 · 查词、标注、日常问答</span><span>{PRESETS.deepseek.fast}</span></div><div><span>深入档 · 长难句、学习洞察、出题</span><span>{PRESETS.deepseek.deep}</span></div></div>}
    </div>
    <footer className="foot">
      <span className="sp" />
      <button className="skip" onClick={onCancel}>先不连</button>
      <button className="btn pri" disabled={conn?.state !== 'ok'} onClick={() => { toast('模型已连接'); onDone(); }}>保存并回到{backLabel}</button>
    </footer>
  </>;
}
