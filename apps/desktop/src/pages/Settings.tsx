import { Mascot } from '../components/Mascot';
import type { Profile } from '@tibi/core';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Top } from '../components/Shell';
import { Switch } from '../components/Switch';
import { BackupItems, ExportSummaryItem } from '../settings/DataItems';
import { MemoryItems } from '../settings/MemoryItems';
import { ModelItems } from '../settings/ModelItems';
import { VoiceItems } from '../settings/VoiceItems';
import { SkillItems } from '../settings/SkillItems';
import { McpItems } from '../settings/McpItems';
import { SyncItems } from '../settings/SyncItems';
import { UpdateItems } from '../settings/UpdateItems';
import { AuthorItems, DonateItems } from '../settings/AuthorItems';
import { FeedbackItems } from '../settings/FeedbackItems';
import { useSettingsSearch } from '../settings/search';
import { errorInfo, isTauri, isWeb, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast, useUi } from '../store/ui';
import { lang, setLang, tl } from '../lib/i18n';
import { isImeKey } from '../lib/util';

const SECTIONS = [['general', tl('通用')], ['model', tl('模型')], ['learning', tl('学习与复习')], ['memory', tl('记忆')], ['advanced', tl('高级')], ['data', tl('数据')], ['about', tl('关于')]] as const;

// 放在组件外：定义在 Settings 里每次渲染都是新组件，input 会被重挂，拖到一半就断了。拖动时先改本地值，停手 300ms 再保存
function Range({ label, value, min, max, step, unit, onChange, desc }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; desc?: string }) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { if (!timer.current) setDraft(value); }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (v: number) => {
    setDraft(v); clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = undefined; onChange(v); }, 300);
  };
  return (
    <div className="item"><div><div className="t">{label}</div>{desc && <div className="d">{desc}</div>}</div><div className="ctl"><input type="range" min={min} max={max} step={step} value={draft} onChange={e => change(Number(e.target.value))} aria-label={label} /><b style={{ minWidth: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{draft}{unit}</b></div></div>
  );
}

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

  // 页内搜索：q 是输入框里的字，query 是拿去过滤的字（拼音输入法选字途中不过滤）
  const [q, setQ] = useState(''); const [query, setQuery] = useState('');
  const swRef = useRef<HTMLDivElement>(null); const findRef = useRef<HTMLInputElement>(null);
  const { total, missed } = useSettingsSearch(swRef, query);
  const searching = !!query.trim();
  const clearSearch = () => { setQ(''); setQuery(''); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); findRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 全局搜索跳到某一项：?sec=advanced&item=权限模式 → 滚过去并闪一下浅蓝底
  const secParam = params.get('sec'), itemParam = params.get('item');
  useEffect(() => {
    if (!secParam) return;
    clearSearch(); setSec(secParam);
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
  }, []);

  // 左边目录跟着滚动走：顶上那一节高亮；滚到底时是最后一节（它可能顶不到上面）
  useEffect(() => {
    const root = swRef.current?.closest('.scroll'); if (!root || searching) return;
    const onScroll = () => {
      const top = root.getBoundingClientRect().top + 80; let cur: string = SECTIONS[0]![0];
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) cur = SECTIONS[SECTIONS.length - 1]![0];
      else for (const [k] of SECTIONS) { const el = document.getElementById(`s-${k}`); if (el && el.getBoundingClientRect().top <= top) cur = k; }
      setSec(cur);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [searching]);

  const patch = async (p: Partial<Profile>) => { try { setProfile(await rpc.call('profile.update', { patch: p })); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };

  return (
    <>
      <Top crumbs={[{ label: tl('设置') }]} right={<span className="lbl">{tl('修改会自动保存')}</span>} />
      <div className="scroll"><div className="page"><div ref={swRef} className={searching ? 'sw searching' : 'sw'} style={{ marginTop: 12 }}>
        <nav className="snav">
          <label className="sfind"><Search size={14} /><input ref={findRef} value={q} placeholder={tl('搜索设置')} aria-label={tl('搜索设置')} autoComplete="off" onChange={e => { setQ(e.target.value); if (!(e.nativeEvent as InputEvent).isComposing) setQuery(e.target.value); }} onCompositionEnd={e => setQuery(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Escape' && !isImeKey(e.nativeEvent)) { clearSearch(); e.currentTarget.blur(); } }} />{!q && <span className="k">/</span>}</label>
          {SECTIONS.map(([k, l]) => <button key={k} className={sec === k ? 'on' : ''} disabled={missed.includes(k)} onClick={() => { setSec(k); document.getElementById(`s-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{l}</button>)}
        </nav>
        <div>
          <section className="ssec" id="s-general"><h2>{tl('通用')}</h2><div className="group">
            <div className="item"><div><div className="t">{tl('外观')}</div></div><div className="ctl"><div className="seg">{(['auto', 'light', 'dark'] as const).map(t => <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{{ auto: tl('跟随系统'), light: tl('浅色'), dark: tl('深色') }[t]}</button>)}</div></div></div>
            <div className="item"><div><div className="t">{tl('界面语言')}</div><div className="d">{tl('只换界面上的字，切换后界面会重新载入')}</div></div><div className="ctl"><div className="seg">{([['zh', '中文'], ['en', 'English']] as const).map(([v, l]) => <button key={v} className={lang === v ? 'on' : ''} onClick={() => { if (v !== lang) setLang(v); }}>{l}</button>)}</div></div></div>
            <div className="item"><div><div className="t">{tl('Tibi 怎么称呼你')}</div></div><div className="ctl"><input className="input" style={{ width: 120 }} maxLength={20} placeholder={tl('比如：小孟')} value={(profile?.assistant_prefs?.nickname ?? profile?.display_name ?? '') === '你' ? '' : profile?.assistant_prefs?.nickname ?? profile?.display_name ?? ''} onChange={e => { const v = e.target.value; setProfile(p => p && { ...p, display_name: v, assistant_prefs: { ...p.assistant_prefs, nickname: v } }); }} onBlur={e => { const v = e.target.value.trim(); void patch({ display_name: v, assistant_prefs: { ...(profile?.assistant_prefs ?? { permission: 'default' }), nickname: v || '你' } }).then(() => useCore.getState().refresh()); }} /></div></div>
            <VoiceItems />
          </div></section>

          <section className="ssec" id="s-model"><h2>{tl('模型')}</h2><div className="group">
            <ModelItems />
          </div></section>

          <section className="ssec" id="s-learning"><h2>{tl('学习与复习')}</h2><div className="group">
            <div className="item"><div><div className="t">{tl('每日提醒')}</div><div className="d">{tl('到点提醒今天要复习的词；电脑上要 Tibi 开着（托盘里也行）')}</div></div><div className="ctl"><div className="seg">{([['off', tl('关闭')], ['morning', tl('早上 8 点')], ['noon', tl('中午 12 点')], ['evening', tl('晚上 8 点')]] as const).map(([v, l]) => <button key={v} className={reminder === v ? 'on' : ''} onClick={() => { setReminder(v); void rpc.call('settings.set', { patch: { 'reminder.time': v } }); }}>{l}</button>)}</div></div></div>
            <Range label={tl('每日阅读目标')} value={profile?.daily_goal_minutes ?? 20} min={5} max={60} step={5} unit={tl(' 分钟')} onChange={v => patch({ daily_goal_minutes: v })} />
            <Range label={tl('每天最多新学的词')} value={profile?.daily_new_cards ?? 20} min={5} max={50} step={5} unit={tl(' 个')} desc={tl('超过的排到第二天')} onChange={v => patch({ daily_new_cards: v })} />
            <Range label={tl('目标记得率')} value={Math.round((profile?.desired_retention ?? 0.9) * 100)} min={80} max={97} step={1} unit="%" desc={tl('越高复习越频繁')} onChange={v => patch({ desired_retention: v / 100 })} />
            <div className="item"><div><div className="t">{tl('出识别题')}</div><div className="d">{tl('看着词想意思，自己评分。关掉时这一步改出选义题')}</div></div><div className="ctl"><Switch label={tl('出识别题')} checked={recognize} onChange={async v => { setRecognize(v); await rpc.call('settings.set', { patch: { 'review.recognize': v } }).catch(e => toast(errorInfo(e).message, { kind: 'err' })); }} /></div></div>
          </div></section>

          <section className="ssec" id="s-memory"><h2>{tl('记忆')}</h2><div className="group">
            <MemoryItems />
          </div></section>

          <section className="ssec" id="s-advanced">
          <h2>{tl('高级')}</h2>
            <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>{tl('Tibi 能做的事')}</h3>
            <div className="group">
              <div className="item"><div><div className="t">{tl('权限模式')}</div><div className="d">{tl('Tibi 改你的数据（熟练度、文章等）前要不要先问。读过网页的任务一律先问')}</div></div><div className="ctl"><div className="seg">{([['ask', tl('每次都问')], ['default', tl('标词自动，其余问')], ['auto', tl('全部自动')]] as const).map(([v, l]) => <button key={v} className={(profile?.assistant_prefs?.permission ?? 'default') === v ? 'on' : ''} onClick={() => patch({ assistant_prefs: { ...(profile?.assistant_prefs ?? { nickname: '你' }), permission: v } })}>{l}</button>)}</div></div></div>
              <SkillItems />
            </div>
            {/* MCP、备份、软件更新要原生壳，Web 版没有（12 §1） */}
            {!isWeb() && <><h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>{tl('其他 AI 工具')}</h3>
              <div className="group"><McpItems /></div></>}
          </section>


          <section className="ssec" id="s-data"><h2>{tl('数据')}</h2><div className="group">
            <div className="item"><div><div className="t">{tl('数据库位置')}</div><div className="mono" style={{ marginTop: 6 }}>{status?.db_path ?? '—'}</div>{isWeb() && <div className="d">{tl('存在这个浏览器里。清除网站数据会把它删掉，建议开启同步')}</div>}</div><div className="ctl">{!isWeb() && <button className="btn sm" onClick={async () => { if (!isTauri() || !status) return toast(tl('浏览器模式不能打开')); const { invoke } = await import('@tauri-apps/api/core'); await invoke('open_path', { path: status.db_path }).catch(e => toast(String(e), { kind: 'err' })); }}>{tl('在文件夹中显示')}</button>}</div></div>
            {!isWeb() && <BackupItems />}
            <ExportSummaryItem />
            <SyncItems />
          </div></section>

          <section className="ssec" id="s-about"><h2>{tl('关于')}</h2><div className="about-art"><Mascot id="about" /></div><div className="group">
            <div className="item"><div><div className="t">Tibi {status?.version ?? ''}</div><div className="d">{tl('开源 · MIT 协议 · 本地优先的 AI 英语阅读工具')}</div></div></div>
            {!isWeb() && <UpdateItems />}
            <FeedbackItems />
            <div className="item"><div><div className="t">{tl('致谢')}</div><div className="d">ECDICT · Open English WordNet · Word Atlas · FSRS · pi · Tauri · Charis SIL</div></div></div>
          </div>
            <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>{tl('关于作者')}</h3>
            <div className="group"><AuthorItems /></div>
            <h3 style={{ fontSize: 14, margin: '18px 0 8px' }}>{tl('请作者喝咖啡')}</h3>
            <div className="group"><DonateItems /></div>
          </section>
          {searching && total === 0 && <div className="snores">{tl('没有找到「{v0}」', { v0: query.trim() })}</div>}
        </div>
      </div></div></div>
    </>
  );
}
