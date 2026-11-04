import { useLayoutEffect } from 'react';
import { create } from 'zustand';

/** 阅读器的标注模式：全部标注 / 仅生词 / 纯净阅读 */
export type ReaderMode = 'all' | 'new' | 'clean';
export interface Toast { id: number; text: string; kind?: 'err'; action?: { label: string; run: () => void } }

interface UiState {
  collapsed: boolean; toggleSide(): void;
  sideWidth: number; setSideWidth(w: number, save?: boolean): void;
  panelWidth: number; setPanelWidth(w: number, save?: boolean): void;
  theme: 'auto' | 'light' | 'dark'; setTheme(t: 'auto' | 'light' | 'dark'): void;
  sepia: boolean; setSepia(on: boolean): void;
  readerMode: ReaderMode; setReaderMode(m: ReaderMode): void;
  toasts: Toast[]; toast(text: string, opts?: { kind?: 'err'; action?: Toast['action']; ms?: number }): void; dismiss(id: number): void;
  /** 正在读的文章在不在书架里：侧栏据此高亮「书架」或「订阅」 */
  readingShelved: boolean; setReadingShelved(v: boolean): void;
}

let seq = 0;
const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v == null ? d : (JSON.parse(v) as T); } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 私密窗口 */ } };

/** 侧栏宽度：默认与 styles.css 的 --side 一致，拖动范围 200–400 */
export const SIDE_W = 248;
const clampSide = (w: number) => Math.round(Math.min(400, Math.max(200, Number(w) || SIDE_W)));
/** 阅读页右栏（总结 / Tibi）宽度：默认 360，拖动范围 300–720 */
export const PANEL_W = 360;
const clampPanel = (w: number) => Math.round(Math.min(720, Math.max(300, Number(w) || PANEL_W)));

export const useUi = create<UiState>((set, get) => ({
  collapsed: read('tibi-side', false),
  toggleSide() { const c = !get().collapsed; write('tibi-side', c); set({ collapsed: c }); },
  sideWidth: clampSide(read('tibi-side-w', SIDE_W)),
  setSideWidth(w, save = true) { const v = clampSide(w); if (save) write('tibi-side-w', v); set({ sideWidth: v }); },
  panelWidth: clampPanel(read('tibi-panel-w', PANEL_W)),
  setPanelWidth(w, save = true) { const v = clampPanel(w); if (save) write('tibi-panel-w', v); set({ panelWidth: v }); },
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
  readerMode: (() => { const m = read<unknown>('tibi-reader-mode', 'all'); return m === 'new' || m === 'clean' ? m : 'all'; })(),
  setReaderMode(m) { write('tibi-reader-mode', m); set({ readerMode: m }); },
  toasts: [],
  toast(text, opts = {}) {
    const id = ++seq;
    set(s => ({ toasts: [...s.toasts.slice(-2), { id, text, kind: opts.kind, action: opts.action }] }));
    setTimeout(() => get().dismiss(id), opts.ms ?? (opts.action ? 6000 : 3000));
  },
  dismiss(id) { set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })); },
  readingShelved: true, setReadingShelved(v) { set({ readingShelved: v }); },
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
