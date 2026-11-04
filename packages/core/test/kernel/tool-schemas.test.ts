import { describe, expect, it } from 'vitest';
import { documentsCapabilities } from '../../src/domain/documents/capabilities.js';
import { websearchCapabilities } from '../../src/domain/documents/websearch.js';
import { feedsCapabilities } from '../../src/domain/feeds/index.js';
import { memoryCapabilities } from '../../src/domain/memory/index.js';
import { reviewCapabilities } from '../../src/domain/review/capabilities.js';
import { statsCapabilities } from '../../src/domain/stats/methods.js';
import { termsCapabilities } from '../../src/domain/terms/capabilities.js';
import { builtinCapabilities } from '../../src/kernel/capabilities.js';

/** 找出 items 写成数组（元组）的位置：DeepSeek 等 OpenAI 兼容服务会整个请求 400 */
function tuples(schema: unknown, path: string): string[] {
  if (Array.isArray(schema)) return schema.flatMap((x, i) => tuples(x, `${path}[${i}]`));
  if (!schema || typeof schema !== 'object') return [];
  return Object.entries(schema).flatMap(([k, v]) => [...(k === 'items' && Array.isArray(v) ? [`${path}.items`] : []), ...tuples(v, `${path}.${k}`)]);
}

describe('工具参数定义', () => {
  it('根节点是 object、不用元组，模型服务商才接受', () => {
    const all = { ...documentsCapabilities, ...feedsCapabilities, ...websearchCapabilities, ...memoryCapabilities, ...reviewCapabilities, ...statsCapabilities, ...termsCapabilities, ...builtinCapabilities({} as never) };
    expect(Object.keys(all)).toContain('get_document');
    expect(Object.entries(all).filter(([, def]) => (def.params as { type?: string }).type !== 'object').map(([name]) => name)).toEqual([]);
    expect(Object.entries(all).flatMap(([name, def]) => tuples(def.params, name))).toEqual([]);
  });
});
