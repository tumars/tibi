import type { Document, SectionContent, Sentence, Status, Term, Undo } from '@tibi/core';
import { MoreHorizontal, Sparkles } from 'lucide-react';
import { useEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from 'react';
import { ContextMenu, type ContextItem, type MenuPosition } from '../components/ContextMenu';
import { tl } from '../lib/i18n';
import { isMacDesktop } from '../lib/macNative';
import { errorInfo, isTauri, rpc } from '../rpc';
import { toast } from '../store/ui';
import { contextTarget, selectionTarget, type ReaderTarget, type WordTarget } from './contextTarget';
import type { Mode } from './Section';

export interface ReadRequest { key: number; sectionId: string; sentenceId?: string; text?: string }
export interface ReaderMenuHandle { sentence(sentence: Sentence, element: HTMLElement): void }
interface Props {
  ref?: Ref<ReaderMenuHandle>; root: RefObject<HTMLDivElement | null>; doc: Document; content: SectionContent; active: boolean;
  overrides: Map<string, Status>; mode: Mode; translations: boolean;
  onOpen(): void; onWord(target: WordTarget): void; onPhrase(text: string, sentence: Sentence): void;
  onMark(text: string, status: Status | undefined): void;
  onAsk(text: string, extra: { sentence_id?: string; selection?: string }): void;
  onRead(request: ReadRequest): void; onFind(): void; onTranslations(): void; onMode(mode: Mode): void;
}
interface OpenMenu { target: ReaderTarget; position: MenuPosition; key: number; documentId: string; sectionId: string; scrollTop: number }
type PhraseState = 'loading' | 'missing' | 'error' | Term;

export function ReaderMenu(props: Props) {
  const current = useRef(props); current.current = props;
  const sequence = useRef(0);
  const activeMenu = useRef<OpenMenu | undefined>(undefined);
  const [open, setOpen] = useState<OpenMenu>();
  const [phrase, setPhrase] = useState<PhraseState>('loading');
  const phraseRef = useRef(phrase); phraseRef.current = phrase;
  const [wordStatus, setWordStatus] = useState<Status>();
  const wordStatusRef = useRef<Status | undefined>(undefined);
  const [selection, setSelection] = useState<{ target: ReaderTarget; x: number; y: number }>();
  const snapshot = useRef<ReaderTarget | undefined>(undefined);
  const close = () => { activeMenu.current = undefined; setOpen(undefined); };
  const valid = (menu: OpenMenu) => current.current.active && current.current.doc.id === menu.documentId && current.current.content.id === menu.sectionId;
  const show = (target: ReaderTarget, x: number, y: number, focus?: HTMLElement) => {
    if (!current.current.active) return;
    const root = current.current.root.current;
    if (!root) return;
    const menu = { target, key: ++sequence.current, documentId: current.current.doc.id, sectionId: current.current.content.id, scrollTop: root.scrollTop,
      position: { x, y, focus: focus ?? (target.element.hasAttribute('tabindex') ? target.element : root) } };
    activeMenu.current = menu; setOpen(menu); setPhrase('loading'); phraseRef.current = 'loading'; setSelection(undefined); current.current.onOpen();
    if (target.kind === 'word') {
      const status = current.current.overrides.get(target.token.l) ?? target.token.status;
      wordStatusRef.current = status; setWordStatus(status);
      // sections.get 不着色的已知 / 掌握词没有 token.status。只读查询补齐菜单勾选。
      if (status === undefined) void rpc.call('terms.lookup', { text: target.text }).then(r => {
        if (activeMenu.current !== menu || !valid(menu)) return;
        wordStatusRef.current = r.term?.status; setWordStatus(r.term?.status);
      }, () => undefined);
    }
    if (target.kind === 'selection' && target.phrase) checkPhrase(menu);
  };
  const checkPhrase = (menu: OpenMenu) => {
    if (menu.target.kind !== 'selection') return;
    setPhrase('loading'); phraseRef.current = 'loading';
    void rpc.call('terms.lookup', { text: menu.target.text }).then(r => {
      if (activeMenu.current !== menu || !valid(menu)) return;
      phraseRef.current = r.term ?? 'missing'; setPhrase(phraseRef.current);
    }, () => { if (activeMenu.current === menu && valid(menu)) { phraseRef.current = 'error'; setPhrase('error'); } });
  };
  useImperativeHandle(props.ref, () => ({ sentence(sentence, element) { const r = element.getBoundingClientRect(); show({ kind: 'sentence', text: sentence.text, sentence, element }, r.left, r.bottom + 4, element); } }));

  useEffect(() => {
    const root = props.root.current;
    if (!root || !props.active) return;
    const capture = (e: PointerEvent) => {
      if (e.button === 2 || (isMacDesktop && e.button === 0 && e.ctrlKey)) snapshot.current = contextTarget(root, current.current.content, e.target as Element, { x: e.clientX, y: e.clientY });
    };
    const onContext = (e: MouseEvent) => {
      const target = snapshot.current ?? contextTarget(root, current.current.content, e.target as Element, e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : undefined);
      snapshot.current = undefined;
      if (!target) return;
      e.preventDefault(); e.stopPropagation();
      if (target.kind !== 'selection' && !(target.kind === 'copy' && target.partial) && target.kind !== 'word') window.getSelection()?.removeAllRanges();
      else if (target.kind === 'word' && window.getSelection()?.toString().trim() !== target.text) window.getSelection()?.removeAllRanges();
      const r = target.element.getBoundingClientRect();
      show(target, e.clientX || r.left, e.clientY || r.bottom);
    };
    const onSelect = (e: MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey || (e.target as Element).closest('button')) return;
      const target = selectionTarget(root, current.current.content);
      close();
      if (!target || !('text' in target)) { setSelection(undefined); return; }
      const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
      setSelection({ target, x: Math.max(110, Math.min(innerWidth - 110, r.left + r.width / 2)), y: Math.max(48, r.top) });
      current.current.onOpen();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
      if ((e.target as Element).closest('input, textarea, select, [contenteditable="true"]')) return;
      const el = e.target as HTMLElement;
      const target = selectionTarget(root, current.current.content) ?? contextTarget(root, current.current.content, el);
      if (!target) return;
      e.preventDefault(); e.stopPropagation();
      const r = target.element.getBoundingClientRect(); show(target, r.left, Math.min(innerHeight - 8, r.bottom), el);
    };
    const dismiss = () => { close(); setSelection(undefined); snapshot.current = undefined; };
    // 浏览器可能先滚到右键目标，再延迟派发 scroll；不要把已发生的滚动误当成新滚动。
    const onScroll = () => { if (!activeMenu.current || activeMenu.current.scrollTop !== root.scrollTop) dismiss(); };
    const onDown = (e: PointerEvent) => { if (!(e.target as Element).closest('.ctx-menu, .selask')) dismiss(); };
    root.addEventListener('pointerdown', capture, true); root.addEventListener('contextmenu', onContext);
    root.addEventListener('mouseup', onSelect); root.addEventListener('keydown', onKey);
    root.addEventListener('scroll', onScroll); document.addEventListener('pointerdown', onDown, true); window.addEventListener('blur', dismiss);
    return () => {
      activeMenu.current = undefined;
      root.removeEventListener('pointerdown', capture, true); root.removeEventListener('contextmenu', onContext);
      root.removeEventListener('mouseup', onSelect); root.removeEventListener('keydown', onKey);
      root.removeEventListener('scroll', onScroll); document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('blur', dismiss);
    };
  }, [props.root, props.active, props.doc.id, props.content.id]);

  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast(tl('已复制')); } catch { toast(tl('没能复制'), { kind: 'err' }); } };
  const source = async (url: string) => {
    if (!/^https?:\/\//i.test(url)) return;
    if (isTauri()) { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(url); }
    else window.open(url, '_blank', 'noopener,noreferrer');
  };
  const ask = (target: ReaderTarget) => {
    if (!('text' in target)) return;
    const sentence = 'sentence' in target ? target.sentence : undefined;
    const text = target.kind === 'word' ? tl('「{w}」在这句话里是什么意思？用法上要注意什么？', { w: target.text })
      : target.kind === 'sentence' ? tl('解释这句话的意思和句子结构：{text}', { text: target.text }) : tl('解释这段选中内容：{text}', { text: target.text });
    current.current.onAsk(text, { sentence_id: sentence?.id, selection: target.text });
    setSelection(undefined);
  };
  const receipt = (message: string, undo: Undo | undefined, onUndo?: () => void) => toast(message, undo ? { action: { label: tl('撤销'), run: () => {
    void rpc.call('system.undo', { undo_id: undo.undo_id }).then(onUndo, e => toast(errorInfo(e).message, { kind: 'err' }));
  } } } : undefined);
  const build = (menu: OpenMenu): (ContextItem | null)[] => {
    const target = menu.target;
    const action = (label: string, fn: () => void | Promise<unknown>, extra: Partial<ContextItem> = {}): ContextItem => ({ label, ...extra, run: () => {
      if (!valid(menu) || activeMenu.current !== menu) return;
      close();
      void Promise.resolve().then(fn).catch(e => toast(errorInfo(e).message, { kind: 'err' }));
    } });
    const read = (text: string | undefined, sentence?: Sentence) => current.current.onRead({ key: ++sequence.current, sectionId: menu.sectionId, sentenceId: sentence?.id, text });
    const sentenceItems = (sentence: Sentence) => [
      action(tl('问 Tibi：解释这句'), () => ask({ kind: 'sentence', text: sentence.text, sentence, element: target.element })),
      action(tl('朗读这句'), () => read(sentence.text, sentence)), action(tl('从这里朗读'), () => read(undefined, sentence)), null,
      action(tl('复制这句'), () => copy(sentence.text)),
    ];
    if (target.kind === 'word') {
      const status = wordStatus;
      const mark = async (status: Status) => {
        const r = await rpc.call('terms.mark', { text: target.text, status, sentence_id: target.sentence.id });
        if (valid(menu)) props.onMark(r.term.text, r.term.status);
        receipt(status === 0 ? tl('已标为生词') : tl('已标为已知'), r.undo, () => { if (valid(menu)) props.onMark(r.term.text, r.previous); });
      };
      return [action(tl('查词'), () => props.onWord(target)), action(tl('朗读单词'), () => read(target.text, target.sentence)), action(tl('问 Tibi：这里的意思'), () => ask(target)), null,
        action(tl('标为生词'), () => wordStatusRef.current === 0 ? undefined : mark(0), { id: 'reader-new', checked: status === 0 }),
        action(status === 5 ? tl('已掌握') : tl('标为已知'), () => wordStatusRef.current === 5 || wordStatusRef.current === 97 ? undefined : mark(97), { id: 'reader-known', checked: status === 5 || status === 97 }), null,
        action(tl('复制单词'), () => copy(target.text)), { label: tl('所在句子'), items: sentenceItems(target.sentence) }];
    }
    if (target.kind === 'sentence') return sentenceItems(target.sentence);
    if (target.kind === 'source') return [action(tl('打开原文'), () => source(target.text)), action(tl('复制原文链接'), () => copy(target.text))];
    if (target.kind === 'copy') return [action(target.code ? target.partial ? tl('复制选中代码') : tl('复制代码') : tl('复制选中内容'), () => copy(target.text))];
    if (target.kind === 'selection') {
      const rows: (ContextItem | null)[] = target.text.length <= 600 ? [action(tl('问 Tibi：解释选中内容'), () => ask(target)), action(tl('朗读选中内容'), () => read(target.text, target.sentence)), null] : [];
      if (target.phrase && target.sentence) {
        rows.push({ id: 'reader-phrase', label: phrase === 'loading' ? tl('正在检查短语…') : phrase === 'error' ? tl('重试检查短语') : phrase === 'missing' ? tl('加入短语') : tl('查看短语'), enabled: phrase !== 'loading', run: () => {
          if (!valid(menu) || activeMenu.current !== menu) return;
          if (phraseRef.current === 'error') { show(target, menu.position.x, menu.position.y, menu.position.focus); return; }
          if (phraseRef.current === 'loading') return;
          close();
          if (typeof phraseRef.current === 'object') { props.onPhrase(target.text, target.sentence!); return; }
          void rpc.call('terms.addPhrase', { text: target.text, sentence_id: target.sentence!.id, surface: target.text }).then(r => receipt(r.undo ? tl('已加入短语') : tl('这条短语已收录'), r.undo), e => toast(errorInfo(e).message, { kind: 'err' }));
        } }, null);
      }
      rows.push(action(tl('复制选中内容'), () => copy(target.text))); return rows;
    }
    const rows: (ContextItem | null)[] = [action(tl('在本章查找…'), props.onFind), action(props.translations ? tl('隐藏译文') : tl('显示译文'), props.onTranslations, { checked: props.translations }),
      { label: tl('标注模式'), items: ([['all', tl('全部标注')], ['new', tl('仅生词')], ['clean', tl('纯净阅读')]] as const).map(([mode, label]) => action(label, () => props.onMode(mode), { checked: props.mode === mode })) }];
    if ((props.root.current?.scrollTop ?? 0) > 5) rows.push(null, action(tl('回到开头'), () => props.root.current?.scrollTo({ top: 0, behavior: 'smooth' })));
    if (props.doc.source_url && /^https?:\/\//i.test(props.doc.source_url)) rows.push(null, action(tl('打开原文'), () => source(props.doc.source_url!)));
    return rows;
  };
  if (!props.active) return null;
  const selectable = selection && 'text' in selection.target;
  const canAsk = selectable && (selection.target.kind === 'word' || selection.target.kind === 'selection') && selection.target.text.length <= 600;
  return <>
    {open && <ContextMenu key={open.key} position={open.position} items={build(open)} onClose={() => { if (activeMenu.current === open) close(); }} />}
    {selectable && <div className="selask reader-selection" style={{ left: selection.x, top: selection.y }} onMouseDown={e => e.preventDefault()}>
      {canAsk && <button onClick={() => ask(selection.target)}><Sparkles size={13} />{tl('问 Tibi')}</button>}
      {!canAsk && selection.target.kind === 'selection' && <span>{tl('解释和朗读请选 600 字符以内')}</span>}
      <button aria-label={tl('更多操作')} onClick={e => { const r = e.currentTarget.getBoundingClientRect(); show(selection.target, r.left, r.bottom, props.root.current!); }}><MoreHorizontal size={16} /></button>
    </div>}
  </>;
}
