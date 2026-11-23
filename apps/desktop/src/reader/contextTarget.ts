import type { SectionContent, Sentence, Token } from '@tibi/core';

export interface WordTarget { kind: 'word'; text: string; sentence: Sentence; token: Token; element: HTMLElement }
export type ReaderTarget = WordTarget
  | { kind: 'sentence'; text: string; sentence: Sentence; element: HTMLElement }
  | { kind: 'selection'; text: string; sentence?: Sentence; phrase: boolean; range: Range; element: HTMLElement }
  | { kind: 'copy'; text: string; code: boolean; partial: boolean; element: HTMLElement }
  | { kind: 'source'; text: string; element: HTMLElement }
  | { kind: 'blank'; element: HTMLElement };

const parent = (node: Node) => node instanceof Element ? node : node.parentElement;
const sentenceOf = (el: Element | null, content: SectionContent) => content.sentences.find(s => s.id === el?.closest<HTMLElement>('[data-sid]')?.dataset.sid);
function wordOf(el: Element, content: SectionContent): WordTarget | undefined {
  const element = el.closest<HTMLElement>('[data-token-start]');
  const sentence = sentenceOf(element, content);
  const token = sentence?.tokens.find(t => t.s === Number(element?.dataset.tokenStart));
  return element && sentence && token ? { kind: 'word', element, sentence, token, text: sentence.text.slice(token.s, token.e) } : undefined;
}

/** 只解析本章正文的选区。没有句子 id 的跨句选区仍保留完整文字。 */
export function selectionTarget(root: HTMLElement, content: SectionContent, point?: { x: number; y: number }): ReaderTarget | undefined {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const range = sel.getRangeAt(0).cloneRange();
  const body = root.querySelector('[data-reader-body]');
  if (!body?.contains(range.startContainer) || !body.contains(range.endContainer)) return;
  if (point && !Array.from(range.getClientRects()).some(r => point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom)) return;
  const rawText = sel.toString();
  const text = rawText.trim();
  if (!text) return;
  const start = parent(range.startContainer), end = parent(range.endContainer);
  const code = start?.closest<HTMLElement>('pre, code');
  if (code && code === end?.closest('pre, code')) return { kind: 'copy', text: rawText, code: true, partial: true, element: code };
  // 原译文混选、代码混选都只复制，不猜英文学习对象。
  if (Array.from(body.querySelectorAll('.tr, pre, code')).some(el => range.intersectsNode(el))) return { kind: 'copy', text: rawText, code: false, partial: true, element: root };
  const elements = Array.from(body.querySelectorAll<HTMLElement>('[data-token-start]')).filter(el => range.intersectsNode(el));
  const complete = elements.length > 0 && elements.every(el => el.firstChild && range.comparePoint(el.firstChild, 0) === 0 && range.comparePoint(el.firstChild, el.firstChild.textContent?.length ?? 0) === 0);
  const first = sentenceOf(start, content), last = sentenceOf(end, content);
  const sentence = first?.id === last?.id ? first : undefined;
  if (complete && elements.length === 1 && elements[0]!.textContent === text) return wordOf(elements[0]!, content);
  const phrase = !!sentence && complete && elements.length >= 2 && elements.length <= 8 && text.length >= 3 && rawText.length <= 80 && /^[A-Za-z][A-Za-z'’\-\s]*$/.test(text);
  return { kind: 'selection', text: rawText, sentence, phrase, range, element: root };
}

export function contextTarget(root: HTMLElement, content: SectionContent, element: Element, point?: { x: number; y: number }): ReaderTarget | undefined {
  if (element.closest('input, textarea, select, button, [contenteditable="true"]')) return;
  const selected = selectionTarget(root, content, point);
  if (selected) return selected;
  const source = element.closest<HTMLAnchorElement>('a.src[href]');
  if (source && /^https?:\/\//i.test(source.href)) return { kind: 'source', text: source.href, element: source };
  const code = element.closest<HTMLElement>('[data-reader-body] pre, [data-reader-body] code');
  if (code) return { kind: 'copy', text: code.textContent ?? '', code: true, partial: false, element: code };
  if (element.closest('figure, img, a')) return;
  const word = wordOf(element, content);
  if (word) return word;
  const sentence = sentenceOf(element, content);
  if (sentence) return { kind: 'sentence', text: sentence.text, sentence, element: element.closest<HTMLElement>('[data-sid]')! };
  return { kind: 'blank', element: root };
}
