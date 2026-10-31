import { create } from 'zustand';

export interface Toast { id: number; text: string; kind?: 'err'; action?: { label: string; run: () => void } }

interface UiState {
  collapsed: boolean; toggleSide(): void;
  theme: 'auto' | 'light' | 'dark'; setTheme(t: 'auto' | 'light' | 'dark'): void;
  toasts: Toast[]; toast(text: string, opts?: { kind?: 'err'; action?: Toast['action']; ms?: number }): void; dismiss(id: number): void;
}

let seq = 0;
const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v == null ? d : (JSON.parse(v) as T); } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 私密窗口 */ } };

export const useUi = create<UiState>((set, get) => ({
  collapsed: read('tibi-side', false),
  toggleSide() { const c = !get().collapsed; write('tibi-side', c); set({ collapsed: c }); },
  theme: (() => { try { const t = localStorage.getItem('tibi-theme'); return t === 'light' || t === 'dark' ? t : 'auto'; } catch { return 'auto'; } })(),
  setTheme(t) {
    const r = document.documentElement;
    if (t === 'auto') { delete r.dataset.theme; try { localStorage.removeItem('tibi-theme'); } catch { /* */ } } else { r.dataset.theme = t; try { localStorage.setItem('tibi-theme', t); } catch { /* */ } }
    set({ theme: t });
  },
  toasts: [],
  toast(text, opts = {}) {
    const id = ++seq;
    set(s => ({ toasts: [...s.toasts.slice(-2), { id, text, kind: opts.kind, action: opts.action }] }));
    setTimeout(() => get().dismiss(id), opts.ms ?? (opts.action ? 6000 : 3000));
  },
  dismiss(id) { set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })); },
}));

export const toast = (text: string, opts?: Parameters<UiState['toast']>[1]) => useUi.getState().toast(text, opts);
