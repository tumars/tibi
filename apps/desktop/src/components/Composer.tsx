import type { Provider } from '@tibi/core';
import { BarChart3, BookOpen, Brain, ChevronDown, Download, RefreshCw, Search, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { tl } from '../lib/i18n';
import { ACTIONS, matchActions, slashQuery, type ActionId, type SlashAction } from '../lib/slash';
import { rpc } from '../rpc';

/** 输入框共用的部件：首页和对话（对话页、阅读器 Tibi 面板）都用，/ 菜单、动作标签和模型选择行为一致 */
const ACTION_ICONS: Record<ActionId, LucideIcon> = { importer: Download, scout: Search, tutor: BookOpen, coach: RefreshCw, insight: BarChart3, archivist: Brain };

/** / 菜单的状态与键盘操作；handleKey 返回 true 表示这次按键被菜单用掉了 */
export function useSlashMenu(text: string, focus: boolean, onPick: (a: SlashAction) => void) {
  const [offSkills, setOffSkills] = useState<string[]>([]);   // 设置里关掉的技能不进菜单；导入是固定流程，不能关
  const [menuCur, setMenuCur] = useState(0);
  const [closed, setClosed] = useState(false);   // Esc 关掉后，改了内容再打开
  const actions = ACTIONS.filter(a => !offSkills.includes(a.id));
  const query = slashQuery(text);
  const menu = focus && !closed && query !== undefined ? matchActions(query, actions) : [];
  const cur = Math.min(menuCur, Math.max(0, menu.length - 1));

  useEffect(() => {
    const loadSkills = () => { rpc.call('skills.list', {}).then(l => setOffSkills(l.filter(s => !s.enabled && s.id !== 'importer').map(s => s.id)), () => undefined); };
    loadSkills();
    return rpc.on('data.changed', d => { if (d.table === 'skills') loadSkills(); });
  }, []);

  const pick = (a: SlashAction) => { setMenuCur(0); onPick(a); };
  const handleKey = (e: React.KeyboardEvent) => {
    if (!menu.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMenuCur((cur + (e.key === 'ArrowDown' ? 1 : -1) + menu.length) % menu.length); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(menu[cur]!); return true; }
    if (e.key === 'Escape') { e.preventDefault(); setClosed(true); return true; }
    return false;
  };
  const textChanged = () => { setClosed(false); setMenuCur(0); };
  return { actions, menu, cur, setMenuCur, pick, handleKey, textChanged };
}

export function SlashMenu({ menu, cur, setCur, pick }: { menu: SlashAction[]; cur: number; setCur: (i: number) => void; pick: (a: SlashAction) => void }) {
  if (!menu.length) return null;
  return (
    <div className="slashmenu" role="listbox" aria-label={tl('选择要做的事')}>
      <div className="mh">{tl('选择要做的事')}</div>
      {menu.map((a, i) => { const I = ACTION_ICONS[a.id]; return <div key={a.id} className={`mi${i === cur ? ' on' : ''}`} role="option" aria-selected={i === cur} onMouseMove={() => setCur(i)} onMouseDown={e => { e.preventDefault(); pick(a); }}>
        <I size={15} /><b>{a.title}</b><span>{a.desc}</span>
      </div>; })}
    </div>
  );
}

/** 选中的动作，显示在输入框上方 */
export function ActionChip({ action, onClear }: { action: SlashAction; onClear: () => void }) {
  const I = ACTION_ICONS[action.id];
  return (
    <div className="agsel">
      <span className="agchip"><I size={14} />/{action.slash}<button title={tl('取消')} aria-label={tl('取消')} onClick={onClear}><X size={10} strokeWidth={2.6} /></button></span>
      <span className="agdesc">{action.desc}</span>
    </div>
  );
}

/** 选模型：value 是 provider id，undefined 为"自动"（按技能设置的档位选）；没连模型时不显示 */
export function ModelPicker({ value, onChange }: { value?: string; onChange: (id?: string) => void }) {
  const [models, setModels] = useState<Provider[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const load = () => { rpc.call('providers.list', {}).then(l => setModels(l.filter(p => p.kind === 'llm' && p.model)), () => undefined); };
  useEffect(load, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  if (!models.length) return null;
  const only = models.length === 1 ? models[0] : undefined;   // 只有一个模型时"自动"就是它，不用多一项
  const label = models.find(m => m.id === value)?.model ?? only?.model ?? tl('自动');
  const choose = (id?: string) => { onChange(id); setOpen(false); };
  return (
    <div className="modelpick" ref={box}>
      <button className="tier" title={tl('选择模型')} aria-haspopup="listbox" aria-expanded={open} onClick={() => { if (!open) load(); setOpen(!open); }}><em>{label}</em> <ChevronDown size={12} /></button>
      {open && <div className="slashmenu modelmenu" role="listbox" aria-label={tl('选择模型')}>
        {!only && <div className={`mi${!value ? ' on' : ''}`} role="option" aria-selected={!value} onClick={() => choose(undefined)}><b>{tl('自动')}</b><span>{tl('按任务选模型')}</span></div>}
        {models.map(m => <div key={m.id} className={`mi${(only ?? models.find(x => x.id === value))?.id === m.id ? ' on' : ''}`} role="option" aria-selected={(only ?? models.find(x => x.id === value))?.id === m.id} onClick={() => choose(m.id)}><b>{m.model}</b><span>{m.name}</span></div>)}
      </div>}
    </div>
  );
}
