import type { Approval, Conversation, Memory, Term } from '@tibi/core';
import { Bell, BookA, Bookmark, Brain, ChevronRight, Cloud, KeyRound, ListChecks, MessageSquare, Moon, Languages } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Dictionary } from '../components/Dictionary';
import { lang, setLang, tl } from '../lib/i18n';
import { PRESETS, saveProvider } from '../lib/providers';
import { fmtAgo, fmtDate, STATUS_NAMES } from '../lib/util';
import { errorInfo, isTauri, rpc } from '../rpc';
import type { SyncStatus } from '../rpc/methods';
import { useCore } from '../store/core';
import { toast, useUi } from '../store/ui';
import { Empty, Ring, Sheet } from './ui';

type SheetKind = 'dict' | 'words' | 'chats' | 'memory' | 'tasks' | 'sync' | 'model' | 'look' | 'remind';

/** 我（00 §3.13）：连续天数圆环、已知词、生词本、对话记录、记忆、运行记录、同步、模型、外观与语言 */
export function Me() {
  const { streak, todayMinutes, goal, vocab, wordCount, status } = useCore();
  const [sheet, setSheet] = useState<SheetKind>();
  const [pending, setPending] = useState(0);
  const [sync, setSync] = useState<SyncStatus>();
  const nav = useNavigate();
  useEffect(() => {
    rpc.call('tasks.list', { limit: 1 }).then(r => setPending(r.pending.length), () => undefined);
    const load = () => rpc.call('sync.status', {}).then(setSync, () => undefined);
    void load(); return rpc.on('sync.update', () => void load());
  }, []);
  const Item = ({ k, icon, color, label, right }: { k: SheetKind; icon: ReactNode; color: string; label: string; right?: ReactNode }) =>
    <a href="#" onClick={e => { e.preventDefault(); setSheet(k); }}><span className="ti" style={{ ['--c' as string]: color }}>{icon}</span>{label}<span className="r">{right && <em>{right}</em>}<ChevronRight size={18} /></span></a>;
  return (
    <div className="screen me" id="s-me">
      <div className="topgap" />
      <div className="head"><Ring value={goal ? todayMinutes / goal : 0} size={64} stroke={6} /><div><b>{tl('连续 {n} 天', { n: streak })}</b><span>{tl('今日 {m} / {g} 分钟 · 约 {v} 词', { m: todayMinutes, g: goal, v: vocab.toLocaleString() })}</span></div></div>
      <div className="pad sec">
        <div className="card menu">
          <Item k="words" icon={<Bookmark />} color="#f5a043" label={tl('生词本')} right={wordCount || undefined} />
          <Item k="dict" icon={<BookA />} color="#0f8b8d" label={tl('词典')} />
          <Item k="chats" icon={<MessageSquare />} color="#3d52e0" label={tl('对话记录')} />
          <Item k="memory" icon={<Brain />} color="#8e5cd9" label={tl('Tibi 记忆')} />
          <Item k="tasks" icon={<ListChecks />} color="#2f9e5f" label={tl('运行记录')} right={pending ? tl('{n} 个等你确认', { n: pending }) : undefined} />
        </div>
      </div>
      <div className="pad sec">
        <div className="card menu">
          <Item k="sync" icon={<Cloud />} color="#0a84ff" label={tl('同步')} right={sync?.enabled ? (sync.last_synced_at ? fmtAgo(sync.last_synced_at) : tl('已开启')) : tl('关')} />
          <Item k="model" icon={<KeyRound />} color="#c98a1b" label={tl('模型')} right={status?.models.ok ? status.models.fast : tl('未连接')} />
          <Item k="remind" icon={<Bell />} color="#c2452d" label={tl('每日提醒')} />
          <Item k="look" icon={<Moon />} color="#636366" label={tl('外观与语言')} />
        </div>
      </div>
      <Sheet open={sheet === 'words'} onClose={() => setSheet(undefined)} tall><WordsList /></Sheet>
      <Sheet open={sheet === 'dict'} onClose={() => setSheet(undefined)} tall full>{sheet === 'dict' && <><h2>{tl('词典')}</h2><Dictionary compact onOpenDoc={id => nav(`/read/${id}`)} /></>}</Sheet>
      <Sheet open={sheet === 'chats'} onClose={() => setSheet(undefined)} tall><Chats onOpen={() => setSheet(undefined)} /></Sheet>
      <Sheet open={sheet === 'memory'} onClose={() => setSheet(undefined)} tall><Memories /></Sheet>
      <Sheet open={sheet === 'tasks'} onClose={() => setSheet(undefined)} tall><Tasks /></Sheet>
      <Sheet open={sheet === 'sync'} onClose={() => setSheet(undefined)} tall><SyncPanel st={sync} onChange={setSync} /></Sheet>
      <Sheet open={sheet === 'model'} onClose={() => setSheet(undefined)} tall><ModelPanel onDone={() => setSheet(undefined)} /></Sheet>
      <Sheet open={sheet === 'look'} onClose={() => setSheet(undefined)}><Look /></Sheet>
      <Sheet open={sheet === 'remind'} onClose={() => setSheet(undefined)}><Remind /></Sheet>
    </div>
  );
}

function WordsList() {
  const [items, setItems] = useState<Term[]>();
  useEffect(() => { rpc.call('terms.list', { view: 'all', sort: 'added', limit: 100 }).then(r => setItems(r.items), () => setItems([])); }, []);
  return <><h2>{tl('生词本')}</h2>{items && !items.length ? <Empty image="empty-words" quip={tl('罐子还是空的。')} title={tl('这里还没有词')} text={tl('读文章时点开的生词会出现在这里。')} /> :
    <div className="card">{items?.map(t => <div key={t.id} className="doc"><span className="b"><span className="t">{t.display}</span><span className="m">{t.meaning}</span></span><span className={`stage s${t.status}`}>{STATUS_NAMES[t.status]}</span></div>)}</div>}</>;
}

function Chats({ onOpen }: { onOpen: () => void }) {
  const nav = useNavigate(); void nav; void onOpen;
  const [items, setItems] = useState<Conversation[]>();
  useEffect(() => { rpc.call('chat.list', { limit: 50 }).then(setItems, () => setItems([])); }, []);
  return <><h2>{tl('对话记录')}</h2>{items && !items.length ? <Empty title={tl('还没有对话')} /> :
    <div className="card">{items?.map(c => <div key={c.id} className="doc"><span className="b"><span className="t">{c.kind === 'day' && c.day ? tl('{d} · 今天的对话', { d: fmtDate(new Date(c.day).getTime()) }) : c.title || tl('对话')}</span><span className="m">{fmtAgo(c.updated_at)}</span></span></div>)}</div>}</>;
}

function Memories() {
  const [items, setItems] = useState<Memory[]>();
  const load = () => rpc.call('memory.list', {}).then(setItems, () => setItems([]));
  useEffect(() => { void load(); }, []);
  const del = async (id: string) => { try { await rpc.call('memory.delete', { id }); void load(); toast(tl('已删除这条记忆')); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };
  return <><h2>{tl('Tibi 记忆')}</h2>{items && !items.length ? <Empty title={tl('Tibi 还没有记住什么')} /> :
    <div className="card">{items?.map(m => <div key={m.id} className="doc"><span className="b" style={{ whiteSpace: 'normal' }}><span className="m" style={{ color: 'var(--ink)', fontSize: 15 }}>{m.content}</span></span><button className="btn sm" onClick={() => void del(m.id)}>{tl('删除')}</button></div>)}</div>}</>;
}

function Tasks() {
  const [list, setList] = useState<{ pending: Approval[]; running: { id: string; title: string }[] }>();
  const load = () => rpc.call('tasks.list', { limit: 20 }).then(r => setList({ pending: r.pending, running: r.running }), () => undefined);
  useEffect(() => { void load(); }, []);
  const decide = async (a: Approval, d: 'allow' | 'deny') => { try { await rpc.call('tasks.approve', { id: a.task_id, decision: d }); void load(); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };
  return <><h2>{tl('运行记录')}</h2>
    {list && !list.pending.length && !list.running.length && <Empty image="empty-tasks" title={tl('没有进行中的任务')} text={tl('任务详情在电脑上看。')} />}
    {list?.pending.map(a => <div key={a.task_id} className="approve" style={{ marginBottom: 8 }}><div className="h">{a.title}</div><div className="b">{a.body}</div><div className="acts"><button className="btn sm tint" onClick={() => void decide(a, 'allow')}>{tl('允许')}</button><button className="btn sm" onClick={() => void decide(a, 'deny')}>{tl('拒绝')}</button></div></div>)}
    {list?.running.map(t => <div key={t.id} className="lbl">{tl('进行中')} · {t.title}</div>)}
  </>;
}

/** 同步（08 §10 手机：我 › 同步）：iPhone 上默认 iCloud Drive，也可以 WebDAV */
function SyncPanel({ st, onChange }: { st?: SyncStatus; onChange: (s: SyncStatus) => void }) {
  const [kind, setKind] = useState<'icloud' | 'webdav'>('icloud');
  const [dav, setDav] = useState({ url: '', user: '', pw: '' });
  const [busy, setBusy] = useState(false);
  const enable = async () => {
    setBusy(true);
    try {
      if (kind === 'webdav' && dav.pw && isTauri()) { const { invoke } = await import('@tauri-apps/api/core'); await invoke('keyring_set', { ref: 'sync.webdav', secret: dav.pw }); }
      const backend = kind === 'icloud' ? { kind } as const : { kind, url: dav.url.trim(), user: dav.user.trim(), password_ref: 'sync.webdav' } as const;
      const p = await rpc.call('sync.probe', { backend });
      if (!p.ok) { toast(p.error?.message ?? tl('连不上'), { kind: 'err' }); return; }
      onChange(await rpc.call('sync.enable', { backend })); toast(p.library ? tl('已加入，两边的数据会合并') : tl('同步已开启'));
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } finally { setBusy(false); }
  };
  if (st?.enabled) return <><h2>{tl('同步')}</h2>
    <div className="card menu ysync">
      <a href="#" onClick={e => e.preventDefault()}><span>{st.state === 'syncing' ? tl('正在同步…') : st.state === 'error' ? st.error?.message : st.last_synced_at ? tl('已同步 · {ago}', { ago: fmtAgo(st.last_synced_at) }) : tl('还没有同步过')}</span></a>
      <a href="#" onClick={e => { e.preventDefault(); void rpc.call('sync.now', {}).then(onChange); }}><span>{tl('立即同步')}</span></a>
    </div>
    <div className="sec"><h2>{tl('设备')}</h2><div className="card">
      <div className="doc"><span className="b"><span className="t">{st.device?.name}</span><span className="m">{tl('本机')}</span></span></div>
      {st.peers.filter(p => !p.removed).map(p => <div key={p.id} className="doc"><span className="b"><span className="t">{p.name}</span><span className="m">{p.platform}{p.last_seen_at ? ` · ${fmtAgo(p.last_seen_at)}` : ''}</span></span></div>)}
    </div></div>
    <button className="btn full" style={{ marginTop: 14 }} onClick={() => void rpc.call('sync.disable', {}).then(() => rpc.call('sync.status', {}).then(onChange))}>{tl('停止同步')}</button>
  </>;
  return <><h2>{tl('同步')}</h2>
    <p className="note2">{tl('和电脑上的 Tibi 同步，经过你自己的 iCloud Drive 或 WebDAV 云盘。同步文件不加密。')}</p>
    <div className="seg" style={{ marginTop: 10 }}><button className={kind === 'icloud' ? 'on' : ''} onClick={() => setKind('icloud')}>iCloud Drive</button><button className={kind === 'webdav' ? 'on' : ''} onClick={() => setKind('webdav')}>WebDAV</button></div>
    {kind === 'webdav' && <>
      <input className="field" value={dav.url} onChange={e => setDav({ ...dav, url: e.target.value })} placeholder="https://dav.jianguoyun.com/dav/Tibi" />
      <input className="field" value={dav.user} onChange={e => setDav({ ...dav, user: e.target.value })} placeholder={tl('邮箱或用户名')} />
      <input className="field" type="password" value={dav.pw} onChange={e => setDav({ ...dav, pw: e.target.value })} placeholder={tl('应用密码')} />
    </>}
    <button className="btn pri full" style={{ marginTop: 14 }} disabled={busy || (kind === 'webdav' && (!dav.url || !dav.user))} onClick={() => void enable()}>{busy ? tl('正在检查…') : tl('开启同步')}</button>
  </>;
}

/** 模型（手机可以单独用：自己的 API Key，存 iOS 钥匙串） */
export function ModelPanel({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const { provider, keyStored } = await saveProvider({ name: PRESETS.deepseek.name, base_url: PRESETS.deepseek.base_url, model: PRESETS.deepseek.fast, tier: 'fast', key });
      if (!keyStored) { toast(tl('浏览器模式不能写钥匙串。dev 下用环境变量 TIBI_SECRET_<REF>')); return; }
      const r = await rpc.call('providers.test', { id: provider.id });
      if (r.ok) { toast(tl('连接成功')); void useCore.getState().refresh(); onDone(); } else toast(tl('连接失败：{v0}', { v0: r.error ?? '' }), { kind: 'err' });
    } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } finally { setBusy(false); }
  };
  return <><h2>{tl('连接模型')}</h2>
    <p className="note2">{tl('连上模型后才能讲解和总结。推荐 DeepSeek：便宜、中文好。Key 只存在这台手机的钥匙串里。')}</p>
    <input className="field" type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="DeepSeek API Key" autoCapitalize="off" autoCorrect="off" />
    <button className="btn pri full" style={{ marginTop: 14 }} disabled={!key.trim() || busy} onClick={() => void save()}>{busy ? tl('正在连接…') : tl('保存并测试')}</button>
    <p className="note2">{tl('其他 OpenAI 兼容的服务在电脑上的 设置 → 模型 里添加。')}</p>
  </>;
}

function Look() {
  const theme = useUi(s => s.theme); const setTheme = useUi(s => s.setTheme);
  const less = useUi(s => s.lessMascot); const setLess = useUi(s => s.setLessMascot);
  return <><h2>{tl('外观与语言')}</h2>
    <div className="seg">{(['auto', 'light', 'dark'] as const).map(t => <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{{ auto: tl('跟随系统'), light: tl('浅色'), dark: tl('深色') }[t]}</button>)}</div>
    <div className="seg" style={{ marginTop: 12 }}><button className={lang === 'zh' ? 'on' : ''} onClick={() => lang !== 'zh' && setLang('zh')}><Languages size={14} /> 中文</button><button className={lang === 'en' ? 'on' : ''} onClick={() => lang !== 'en' && setLang('en')}>English</button></div>
    <div className="seg" style={{ marginTop: 12 }}><button className={less ? '' : 'on'} onClick={() => setLess(false)}>{tl('显示吉祥物')}</button><button className={less ? 'on' : ''} onClick={() => setLess(true)}>{tl('减少吉祥物')}</button></div>
  </>;
}

/** 每日提醒（J8）：每天一条，内容是当天待复习数 */
function Remind() {
  const [v, setV] = useState<string>('off');
  useEffect(() => { rpc.call('settings.get', { keys: ['reminder.time'] }).then(r => setV((r['reminder.time'] as string) ?? 'off'), () => undefined); }, []);
  const pick = (x: string) => { setV(x); void rpc.call('settings.set', { patch: { 'reminder.time': x } }); };
  return <><h2>{tl('每日提醒')}</h2>
    <p className="note2">{tl('每天一条，告诉你今天有几个词要复习。')}</p>
    <div className="card menu" style={{ background: 'var(--sunken)', marginTop: 10 }}>{([['off', tl('关闭')], ['morning', tl('早上 8 点')], ['noon', tl('中午 12 点')], ['evening', tl('晚上 8 点')]] as const).map(([k, l]) => <a key={k} href="#" onClick={e => { e.preventDefault(); pick(k); }}>{l}<span className="r">{v === k ? '✓' : ''}</span></a>)}</div>
  </>;
}
