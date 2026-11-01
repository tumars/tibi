import type { Profile, Provider } from '@tibi/core';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Top } from '../components/Shell';
import { Switch } from '../components/Switch';
import { saveProvider } from '../lib/providers';
import { BackupItems, ExportSummaryItem } from '../settings/DataItems';
import { MemoryItems } from '../settings/MemoryItems';
import { VoiceItems } from '../settings/VoiceItems';
import { SkillItems } from '../settings/SkillItems';
import { McpItems } from '../settings/McpItems';
import { SyncItems } from '../settings/SyncItems';
import { errorInfo, isTauri, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast, useUi } from '../store/ui';
import { lang, setLang, tl } from '../lib/i18n';

const SECTIONS = [['general', tl('通用')], ['learning', tl('学习与复习')], ['memory', tl('记忆')], ['advanced', tl('高级')], ['data', tl('数据')], ['about', tl('关于')]] as const;

export function Settings() {
  const nav = useNavigate();
  const [recognize, setRecognize] = useState(false);
  const [reminder, setReminder] = useState<string>('off');
  useEffect(() => { rpc.call('settings.get', { keys: ['reminder.time'] }).then(r => setReminder((r['reminder.time'] as string) ?? 'off'), () => undefined); }, []);
  useEffect(() => { rpc.call('settings.get', { keys: ['review.recognize'] }).then(r => setRecognize(!!r['review.recognize']), () => undefined); }, []);
  const theme = useUi(s => s.theme); const setTheme = useUi(s => s.setTheme);
  const status = useCore(s => s.status);
  const [params] = useSearchParams();
  const [sec, setSec] = useState<string>(params.get('sec') ?? 'general');
  const [profile, setProfile] = useState<Profile>();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [budget, setBudget] = useState<{ month: number; task: number }>({ month: 20, task: 1 });
  const [adv, setAdv] = useState(false);
  const [editing, setEditing] = useState<Partial<Provider> & { key?: string }>();

  // 全局搜索跳到某一项：?sec=advanced&item=模型 → 滚过去并闪一下浅蓝底
  const secParam = params.get('sec'), itemParam = params.get('item');
  useEffect(() => {
    if (!secParam) return;
    setSec(secParam); if (secParam === 'advanced') setAdv(true);
    const t = setTimeout(() => {
      const want = itemParam ? tl(itemParam) : '';
      const el = want ? [...document.querySelectorAll<HTMLElement>(`#s-${secParam} .t, #s-${secParam} h3`)].find(x => x.textContent?.trim() === want) : undefined;
      const target = (el?.closest('.item') as HTMLElement | null) ?? el ?? document.getElementById(`s-${secParam}`);
      target?.scrollIntoView({ behavior: 'smooth', block: el ? 'center' : 'start' });
      if (el) { const box = (el.closest('.item') as HTMLElement | null) ?? el; box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }
    }, 250);
    return () => clearTimeout(t);
  }, [secParam, itemParam]);
  useEffect(() => {
    rpc.call('profile.get', {}).then(setProfile, () => undefined);
    rpc.call('providers.list', {}).then(setProviders, () => undefined);
    rpc.call('settings.get', { keys: ['budget.month', 'budget.task'] }).then(s => setBudget({ month: (s['budget.month'] as number) ?? 20, task: (s['budget.task'] as number) ?? 1 }), () => undefined);
  }, []);

  const patch = async (p: Partial<Profile>) => { try { setProfile(await rpc.call('profile.update', { patch: p })); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };
  const setBudgetKey = async (k: 'month' | 'task', v: number) => { setBudget(b => ({ ...b, [k]: v })); try { await rpc.call('settings.set', { patch: { [`budget.${k}`]: v } }); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };

  const onSaveProvider = async () => {
    if (!editing) return;
    try {
      const { provider: p, keyStored } = await saveProvider(editing);
      if (editing.key && !keyStored) toast(tl('浏览器模式不能写钥匙串。dev 下用环境变量 TIBI_SECRET_<REF>'));
      setProviders(ps => ps.some(x => x.id === p.id) ? ps.map(x => x.id === p.id ? p : x) : [...ps, p]); setEditing(undefined); toast(tl('已保存'));
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };
  const testProvider = async (id: string) => {
    try { const r = await rpc.call('providers.test', { id }); toast(r.ok ? tl('连接成功{v0}', { v0: r.latency_ms ? ` · ${r.latency_ms} ms` : '' }) : tl('连接失败：{v0}', { v0: r.error ?? '' }), { kind: r.ok ? undefined : 'err' }); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); }
  };

  const Range = ({ label, value, min, max, step, unit, onChange, desc }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; desc?: string }) => (
    <div className="item"><div><div className="t">{label}</div>{desc && <div className="d">{desc}</div>}</div><div className="ctl"><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} aria-label={label} /><b style={{ minWidth: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}{unit}</b></div></div>
  );

  return (
    <>
      <Top crumbs={[{ label: tl('设置') }]} right={<span className="lbl">{tl('修改会自动保存')}</span>} />
      <div className="scroll"><div className="page"><div className="sw" style={{ marginTop: 12 }}>
        <nav className="snav">{SECTIONS.map(([k, l]) => <button key={k} className={sec === k ? 'on' : ''} onClick={() => { setSec(k); if (k === 'advanced') setAdv(true); document.getElementById(`s-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{l}</button>)}</nav>
        <div>
          <section className="ssec" id="s-general"><h2>{tl('通用')}</h2><div className="group">
            <div className="item"><div><div className="t">{tl('外观')}</div></div><div className="ctl"><div className="seg">{(['auto', 'light', 'dark'] as const).map(t => <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{{ auto: tl('跟随系统'), light: tl('浅色'), dark: tl('深色') }[t]}</button>)}</div></div></div>
            <div className="item"><div><div className="t">{tl('界面语言')}</div><div className="d">{tl('只换界面上的字；Tibi 讲解用的语言在「学习与复习」里。切换后界面会重新载入')}</div></div><div className="ctl"><div className="seg">{([['zh', '中文'], ['en', 'English']] as const).map(([v, l]) => <button key={v} className={lang === v ? 'on' : ''} onClick={() => { if (v !== lang) setLang(v); }}>{l}</button>)}</div></div></div>
            <div className="item"><div><div className="t">{tl('Tibi 怎么称呼你')}</div></div><div className="ctl"><input className="input" style={{ width: 120 }} value={profile?.assistant_prefs?.nickname ?? profile?.display_name ?? ''} onChange={e => setProfile(p => p && { ...p, display_name: e.target.value })} onBlur={e => patch({ display_name: e.target.value, assistant_prefs: { ...(profile?.assistant_prefs ?? { language: 'mixed', permission: 'default' }), nickname: e.target.value } })} /></div></div>
            <div className="item"><div><div className="t">{tl('权限模式')}</div><div className="d">{tl('Tibi 要写入数据（记住一件事、改熟练度等）之前要不要先问你。读过网页内容的任务写入时一律先问')}</div></div><div className="ctl"><div className="seg">{([['ask', tl('每次都问')], ['default', tl('标词自动，其余问')], ['auto', tl('全部自动')]] as const).map(([v, l]) => <button key={v} className={(profile?.assistant_prefs?.permission ?? 'default') === v ? 'on' : ''} onClick={() => patch({ assistant_prefs: { ...(profile?.assistant_prefs ?? { nickname: '你', language: 'mixed' }), permission: v } })}>{l}</button>)}</div></div></div>
            <div className="item"><div><div className="t">{tl('英语水平与目标')}</div><div className="d">{tl('影响生词标注和难度判断')}</div></div><div className="ctl">
              <select className="input" value={profile?.level_self ?? 'intermediate'} onChange={e => patch({ level_self: e.target.value })} aria-label={tl('水平')}><option value="beginner">{tl('入门')}</option><option value="intermediate">{tl('中级')}</option><option value="upper">{tl('中高级')}</option><option value="advanced">{tl('高级')}</option></select>
              <select className="input" value={profile?.goal ?? 'work'} onChange={e => patch({ goal: e.target.value })} aria-label={tl('目标')}><option value="work">{tl('工作阅读')}</option><option value="novel">{tl('读原版书')}</option><option value="ielts">{tl('雅思 / 托福')}</option><option value="cet">{tl('考研 / CET')}</option><option value="interest">{tl('兴趣')}</option></select>
              <span className="lbl">{tl('估算 {v0} 词{v1}', { v0: profile?.vocab_estimate?.toLocaleString() ?? '—', v1: profile?.vocab_source === 'self' ? tl('（按自评）') : profile?.vocab_source === 'test' ? tl('（测试）') : '' })}</span>
            </div></div>
            <div className="item"><div><div className="t">{tl('校准词汇量')}</div><div className="d">{tl('7 组词，点亮认识的，约 3–4 分钟。测完按新结果标注生词')}</div></div><div className="ctl"><button className="btn sm" onClick={() => nav('/welcome?step=2&from=settings')}>{tl('开始')}</button></div></div>
                      <VoiceItems />
          </div></section>

          <section className="ssec" id="s-learning"><h2>{tl('学习与复习')}</h2><div className="group">
            <div className="item"><div><div className="t">{tl('每日提醒')}</div><div className="d">{tl('到点提醒今天要复习的词；电脑上要 Tibi 开着（托盘里也行）')}</div></div><div className="ctl"><div className="seg">{([['off', tl('关闭')], ['morning', tl('早上 8 点')], ['noon', tl('中午 12 点')], ['evening', tl('晚上 8 点')]] as const).map(([v, l]) => <button key={v} className={reminder === v ? 'on' : ''} onClick={() => { setReminder(v); void rpc.call('settings.set', { patch: { 'reminder.time': v } }); }}>{l}</button>)}</div></div></div>
            <div className="item"><div><div className="t">{tl('Tibi 讲解用的语言')}</div><div className="d">{tl('总结、释义、对话回答用什么语言')}</div></div><div className="ctl"><div className="seg">{([['mixed', tl('中文夹英文')], ['zh', tl('只用中文')], ['en', 'English']] as const).map(([v, l]) => <button key={v} className={(profile?.assistant_prefs?.language ?? 'mixed') === v ? 'on' : ''} onClick={() => patch({ assistant_prefs: { ...(profile?.assistant_prefs ?? { nickname: '你', permission: 'default' }), language: v } })}>{l}</button>)}</div></div></div>
            <Range label={tl('每日阅读目标')} value={profile?.daily_goal_minutes ?? 20} min={5} max={60} step={5} unit={tl(' 分钟')} onChange={v => patch({ daily_goal_minutes: v })} />
            <Range label={tl('每天最多新学的词')} value={profile?.daily_new_cards ?? 20} min={5} max={50} step={5} unit={tl(' 个')} desc={tl('超过的排到第二天')} onChange={v => patch({ daily_new_cards: v })} />
            <Range label={tl('目标记得率')} value={Math.round((profile?.desired_retention ?? 0.9) * 100)} min={80} max={97} step={1} unit="%" desc={tl('越高复习越频繁')} onChange={v => patch({ desired_retention: v / 100 })} />
            <div className="item"><div><div className="t">{tl('出识别题')}</div><div className="d">{tl('看着词想意思，自己评分。关掉时这一步由选义题代替（R6）')}</div></div><div className="ctl"><Switch label={tl('出识别题')} checked={recognize} onChange={async v => { setRecognize(v); await rpc.call('settings.set', { patch: { 'review.recognize': v } }).catch(e => toast(errorInfo(e).message, { kind: 'err' })); }} /></div></div>
          </div></section>

          <section className="ssec" id="s-memory"><h2>{tl('记忆')}</h2><div className="group">
            <MemoryItems />
          </div></section>

          <section className="ssec" id="s-advanced">
            <h2>{tl('高级')}</h2>
            <button className="advtog" onClick={() => setAdv(!adv)} aria-expanded={adv}><span style={{ flex: 1 }}>{tl('模型、花费上限')}</span><ChevronDown size={14} style={{ transform: adv ? 'rotate(180deg)' : undefined }} /></button>
            {adv && <>
              <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>{tl('模型')}</h3>
              <div className="group">
                {providers.map(p => <div key={p.id} className="prov"><div><div className="t" style={{ fontSize: 14, fontWeight: 500 }}>{p.name} <span className="tagc">{p.tier === 'deep' ? tl('深入') : tl('快速')}{p.is_default ? tl(' · 默认') : ''}</span> <span className="tagc" style={{ color: p.has_secret ? 'var(--ok)' : 'var(--ink-3)' }}>{p.has_secret ? tl('已配置密钥') : tl('未配置密钥')}</span></div><div className="lbl">{p.model}{p.base_url ? ` · ${p.base_url}` : ''}</div></div><div className="ctl"><button className="btn sm" onClick={() => testProvider(p.id)}>{tl('测试连接')}</button><button className="btn sm" onClick={() => setEditing({ ...p })}>{tl('编辑')}</button></div></div>)}
                {!providers.length && !editing && <div className="item"><div><div className="t">{tl('还没有连接模型')}</div><div className="d">{tl('不连模型时查词、标注、复习照常。导入文章的总结、语境释义需要模型。')}</div></div><div className="ctl"><button className="btn sm pri" onClick={() => setEditing({ name: 'DeepSeek', kind: 'llm', protocol: 'openai_compatible', base_url: 'https://api.deepseek.com', model: 'deepseek-flash', tier: 'fast', is_default: true })}>{tl('连接 DeepSeek')}</button><button className="btn sm" onClick={() => setEditing({ name: '', kind: 'llm', protocol: 'openai_compatible', base_url: '', model: '', tier: 'fast', is_default: !providers.length })}>{tl('其他兼容服务')}</button></div></div>}
                {editing && <div className="pform">
                  <span>{tl('名称')}</span><input className="input" value={editing.name ?? ''} onChange={e => setEditing({ ...editing, name: e.target.value })} />
                  <span>Base URL</span><input className="input" value={editing.base_url ?? ''} onChange={e => setEditing({ ...editing, base_url: e.target.value })} placeholder="https://api.deepseek.com" />
                  <span>{tl('模型')}</span><input className="input" value={editing.model ?? ''} onChange={e => setEditing({ ...editing, model: e.target.value })} placeholder="deepseek-flash" />
                  <span>{tl('档位')}</span><select className="input" value={editing.tier ?? 'fast'} onChange={e => setEditing({ ...editing, tier: e.target.value as 'fast' | 'deep' })}><option value="fast">{tl('快速')}</option><option value="deep">{tl('深入')}</option></select>
                  <span>API Key</span><input className="input" type="password" value={editing.key ?? ''} onChange={e => setEditing({ ...editing, key: e.target.value })} placeholder={editing.has_secret ? tl('已保存，留空不改') : 'sk-…'} />
                  <div className="row"><button className="btn sm pri" onClick={onSaveProvider}>{tl('保存')}</button><button className="btn sm" onClick={() => setEditing(undefined)}>{tl('取消')}</button><span className="lbl" style={{ alignSelf: 'center' }}>{tl('Key 只存在这台电脑的钥匙串里')}</span></div>
                </div>}
                {providers.length > 0 && !editing && <div className="item"><div className="lbl">{tl('添加其他 OpenAI 兼容服务')}</div><div className="ctl"><button className="btn sm" onClick={() => setEditing({ name: '', kind: 'llm', protocol: 'openai_compatible', base_url: '', model: '', tier: 'deep', is_default: false })}>{tl('添加')}</button></div></div>}
              </div>
              <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>{tl('Tibi 能做的事')}</h3>
              <div className="group"><SkillItems /></div>
              <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>{tl('花费上限')}</h3>
              <div className="group">
                <div className="item"><div><div className="t">{tl('每月预算')}</div><div className="d">{tl('本月已用 ¥{v0}；超出后 AI 功能改为稍后补做', { v0: status?.budget.month_spent.toFixed(2) ?? '0.00' })}</div></div><div className="ctl"><input className="input" type="number" value={budget.month} min={0} style={{ width: 80, textAlign: 'right' }} onChange={e => setBudgetKey('month', Number(e.target.value))} /> {tl('元')}</div></div>
                <div className="item"><div><div className="t">{tl('单个任务上限')}</div><div className="d">{tl('超过时先问你')}</div></div><div className="ctl"><input className="input" type="number" value={budget.task} min={0} step={0.5} style={{ width: 80, textAlign: 'right' }} onChange={e => setBudgetKey('task', Number(e.target.value))} /> {tl('元')}</div></div>
              </div>
              <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>{tl('其他 AI 工具')}</h3>
              <div className="group"><McpItems /></div>
            </>}
          </section>


          <section className="ssec" id="s-data"><h2>{tl('数据')}</h2><div className="group">
            <div className="item"><div><div className="t">{tl('数据库位置')}</div><div className="mono" style={{ marginTop: 6 }}>{status?.db_path ?? '—'}</div></div><div className="ctl"><button className="btn sm" onClick={async () => { if (!isTauri() || !status) return toast(tl('浏览器模式不能打开')); const { invoke } = await import('@tauri-apps/api/core'); await invoke('open_path', { path: status.db_path }).catch(e => toast(String(e), { kind: 'err' })); }}>{tl('在文件夹中显示')}</button></div></div>
            <BackupItems />
            <div className="item"><div><div className="t">{tl('生词本导入与导出')}</div><div className="d">{tl('导出为 Anki / CSV / 纯文本；从其他工具导入已知词表或单词表。在生词本页右上角。')}</div></div><div className="ctl"><button className="btn sm" onClick={() => nav('/words')}>{tl('去生词本')}</button></div></div>
            <ExportSummaryItem />
            <SyncItems />
          </div></section>

          <section className="ssec" id="s-about"><h2>{tl('关于')}</h2><div className="group">
            <div className="item"><div><div className="t">Tibi {status?.version ?? ''}</div><div className="d">{tl('开源 · MIT 协议 · 本地优先的 AI 英语阅读工具')}</div></div></div>
            <div className="item"><div><div className="t">{tl('致谢')}</div><div className="d">ECDICT · FSRS · pi · Tauri · Charis SIL</div></div></div>
          </div></section>
        </div>
      </div></div></div>
    </>
  );
}
