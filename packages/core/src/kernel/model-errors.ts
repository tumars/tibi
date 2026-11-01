/**
 * 模型服务商返回的错误 → 给用户看的两句话（03 §9 的写法）。原始信息放在括号里的状态码，诊断信息里有全文。
 */
export function friendlyModelError(raw: string): string {
  const s = raw.replace(/\s+/g, ' ');
  const code = /\b(4\d\d|5\d\d)\b/.exec(s)?.[1];
  if (/\b401\b|unauthori[sz]ed|authentication|invalid api key|api key.*invalid|incorrect api key/i.test(s)) return 'API Key 不对或已经失效（服务商返回 401）。到 设置 → 高级 → 模型 重新填写。';
  if (/\b402\b|insufficient (balance|quota)|余额不足|billing|payment required/i.test(s)) return '服务商账户余额不足（402）。充值后再试。';
  if (/\b403\b|forbidden|permission/i.test(s)) return '服务商拒绝了这个请求（403）。检查 Key 的权限或模型名。';
  if (/\b404\b|model.*(not found|does not exist)|no such model/i.test(s)) return '服务商那里没有这个模型（404）。检查模型名。';
  if (/\b429\b|rate.?limit|too many requests/i.test(s)) return '请求太频繁或额度用完了（429）。稍等一会儿再试。';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|socket|timed? ?out|unable to connect/i.test(s)) return '连不上模型服务。检查网络和 Base URL。';
  if (code && code.startsWith('5')) return `模型服务暂时出错（${code}）。稍后再试。`;
  return `模型调用失败：${s.length > 160 ? s.slice(0, 160) + '…' : s}`;
}
