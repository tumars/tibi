import { useLayoutEffect } from 'react';
import { create } from 'zustand';

export interface Toast { id: number; text: string; kind?: 'err'; action?: { label: string; run: () => void } }

interface UiState {
  collapsed: boolean; toggleSide(): void;
  theme: 'auto' | 'light' | 'dark'; setTheme(t: 'auto' | 'light' | 'dark'): void;
  sepia: boolean; setSepia(on: boolean): void;
  lessMascot: boolean; setLessMascot(on: boolean): void;
  toasts: Toast[]; toast(text: string, opts?: { kind?: 'err'; action?: Toast['action']; ms?: number }): void; dismiss(id: number): void;
}

let seq = 0;
const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v == null ? d : (JSON.parse(v) as T); } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 私密窗口 */ } };

if (read('tibi-less-mascot', false)) document.documentElement.dataset.mascot = 'less';

export const useUi = create<UiState>((set, get) => ({
  collapsed: read('tibi-side', false),
  toggleSide() { const c = !get().collapsed; write('tibi-side', c); set({ collapsed: c }); },
  theme: (() => { try { const t = localStorage.getItem('tibi-theme'); return t === 'light' || t === 'dark' ? t : 'auto'; } catch { return 'auto'; } })(),
  setTheme(t) {
    const r = document.documentElement;
    if (t === 'auto') { delete r.dataset.theme; try { localStorage.removeItem('tibi-theme'); } catch { /* */ } } else { r.dataset.theme = t; try { localStorage.setItem('tibi-theme', t); } catch { /* */ } }
    set({ theme: t });
    // 阅读页里切深浅色：护眼纸面盖着看不出变化，以后选的为准
    if (r.dataset.paper) get().setSepia(false);
  },
  sepia: read('tibi-sepia', false),
  setSepia(on) { write('tibi-sepia', on); set({ sepia: on }); },
  lessMascot: read('tibi-less-mascot', false),
  // 减少吉祥物：插画和狐狸靠 <html data-mascot> 在样式里隐藏，导航里的狐狸和 Tibi 头像不算；文案由各处读这个值
  setLessMascot(on) { const r = document.documentElement; if (on) r.dataset.mascot = 'less'; else delete r.dataset.mascot; write('tibi-less-mascot', on); set({ lessMascot: on }); },
  toasts: [],
  toast(text, opts = {}) {
    const id = ++seq;
    set(s => ({ toasts: [...s.toasts.slice(-2), { id, text, kind: opts.kind, action: opts.action }] }));
    setTimeout(() => get().dismiss(id), opts.ms ?? (opts.action ? 6000 : 3000));
  },
  dismiss(id) { set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })); },
}));

export const toast = (text: string, opts?: Parameters<UiState['toast']>[1]) => useUi.getState().toast(text, opts);

/** 护眼纸面只在阅读页生效：进阅读页挂到 <html>（词卡、弹窗也跟着变），离开就摘掉 */
export function useSepiaPaper() {
  const sepia = useUi(s => s.sepia);
  useLayoutEffect(() => {
    if (!sepia) return;
    const r = document.documentElement;
    r.dataset.paper = 'sepia';
    return () => { delete r.dataset.paper; };
  }, [sepia]);
  return sepia;
}
