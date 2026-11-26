import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

/**
 * 流式 CSV（ECDICT 的字段里有带换行的引号串，所以不能按行切）。
 * 规则：逗号分隔；双引号包裹的字段里可以有逗号、换行，"" 表示一个引号。
 * 使用 StringDecoder 处理跨 chunk 的多字节 UTF-8，并用状态机处理跨 chunk 的 "" 与 \r\n。
 */
export async function* parseCsv(stream: Readable): AsyncGenerator<string[]> {
  let field = ''; let row: string[] = []; let inQuotes = false; let afterQuote = false;
  let pendingQuote = false; let pendingCR = false;
  const decoder = new StringDecoder('utf8');
  const flushField = () => { row.push(field); field = ''; };
  const processText = function* (s: string): Generator<string[]> {
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!;
      if (pendingCR) {
        pendingCR = false;
        if (c === '\n') continue;
      }
      if (pendingQuote) {
        pendingQuote = false;
        if (c === '"') { field += '"'; continue; }
        inQuotes = false; afterQuote = true;
        // 落到下方按引号外字符处理当前字符 c
      }
      if (inQuotes) {
        if (c === '"') pendingQuote = true;
        else field += c;
        continue;
      }
      if (c === '"' && field === '' && !afterQuote) { inQuotes = true; continue; }
      if (c === ',') { flushField(); afterQuote = false; continue; }
      if (c === '\n' || c === '\r') {
        if (c === '\r') pendingCR = true;
        flushField(); afterQuote = false;
        if (row.length > 1 || row[0] !== '') yield row;
        row = []; continue;
      }
      field += c;
    }
  };
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const s = typeof chunk === 'string' ? chunk : decoder.write(chunk);
    yield* processText(s);
  }
  const rest = decoder.end();
  if (rest) yield* processText(rest);
  if (pendingQuote) { inQuotes = false; afterQuote = true; }
  if (field !== '' || row.length) { flushField(); if (row.length > 1 || row[0] !== '') yield row; }
}
