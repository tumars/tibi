import type { Readable } from 'node:stream';

/**
 * 流式 CSV（ECDICT 的字段里有带换行的引号串，所以不能按行切）。
 * 规则：逗号分隔；双引号包裹的字段里可以有逗号、换行，"" 表示一个引号。
 */
export async function* parseCsv(stream: Readable): AsyncGenerator<string[]> {
  let field = ''; let row: string[] = []; let inQuotes = false; let afterQuote = false;
  const flushField = () => { row.push(field); field = ''; };
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!;
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; afterQuote = true; }
        } else field += c;
        continue;
      }
      if (c === '"' && field === '' && !afterQuote) { inQuotes = true; continue; }
      if (c === ',') { flushField(); afterQuote = false; continue; }
      if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        flushField(); afterQuote = false;
        if (row.length > 1 || row[0] !== '') yield row;
        row = []; continue;
      }
      field += c;
    }
  }
  if (field !== '' || row.length) { flushField(); if (row.length > 1 || row[0] !== '') yield row; }
}
