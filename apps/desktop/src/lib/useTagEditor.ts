import type { DocumentSummary } from '@tibi/core';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { errorInfo, rpc } from '../rpc';
import { toast } from '../store/ui';
import { isImeKey } from './util';

/** 大小写不敏感去重，留先出现的写法（和 Core 的 setDocumentTags 一致）；逗号、顿号分隔的一次拆开，空格算标签的一部分 */
function merge(tags: string[], input: string): string[] {
  const out = [...tags];
  for (const raw of input.split(/[,，、]/)) {
    const name = raw.trim();
    if (name && !out.some(t => t.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

/** 改一篇文章的标签（书架桌面端、手机端共用）：回车加一个，空输入时退格删最后一个；保存时还没回车的也算上 */
export function useTagEditor(doc: DocumentSummary, onDone: () => void) {
  const [tags, setTags] = useState(doc.tags);
  const [input, setInput] = useState('');
  const [known, setKnown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void rpc.call('documents.list', { limit: 200 }).then(r => { if (live) setKnown([...new Set(r.items.flatMap(d => d.tags))].sort()); }, () => undefined);
    return () => { live = false; };
  }, []);

  const q = input.trim().toLowerCase();
  const suggestions = known.filter(t => !tags.some(x => x.toLowerCase() === t.toLowerCase()) && t.toLowerCase().includes(q)).slice(0, 8);

  const add = (name: string) => { setTags(merge(tags, name)); setInput(''); };
  const remove = (name: string) => setTags(tags.filter(t => t !== name));

  const save = async () => {
    const next = merge(tags, input);
    if (next.length === doc.tags.length && next.every(t => doc.tags.includes(t))) { onDone(); return; }
    setBusy(true);
    try { await rpc.call('documents.update', { id: doc.id, patch: { tags: next } }); onDone(); }
    catch (e) { toast(errorInfo(e).message, { kind: 'err' }); setBusy(false); }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isImeKey(e.nativeEvent)) return; // 中文输入法选词的回车不算
    if (e.key === 'Enter') { e.preventDefault(); if (input.trim()) add(input); else void save(); }
    else if (e.key === 'Backspace' && !input && tags.length) setTags(tags.slice(0, -1));
  };

  return { tags, input, setInput, suggestions, busy, add, remove, save, onKeyDown };
}
