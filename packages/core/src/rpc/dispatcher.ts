import { TibiError } from '../types.js';
import { validateParams, type Ctx, type MethodMap } from './define.js';

/** JSON-RPC 2.0（06 §1）：请求 → 校验参数 → 处理；错误码用标准值，error.data.code 为业务码 */
export interface RpcRequest { jsonrpc?: '2.0'; id?: string | number | null; method: string; params?: unknown }
export interface RpcResponse { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } }

const CODES: Record<string, number> = { not_found: -32001, conflict: -32002, permission_denied: -32003, model_unavailable: -32004, offline: -32006, invalid_source: -32007, busy: -32008, invalid_params: -32602 };

export class Dispatcher {
  private methods: MethodMap = {};
  constructor(private readonly makeCtx: (req: RpcRequest) => Ctx) {}

  add(map: MethodMap) {
    for (const [name, def] of Object.entries(map)) {
      if (this.methods[name]) throw new Error(`方法重复注册：${name}`);
      this.methods[name] = def;
    }
    return this;
  }

  has(name: string) { return !!this.methods[name]; }
  list() { return Object.keys(this.methods).sort(); }

  /** 直接调用（内部互调、测试） */
  async call<T = unknown>(method: string, params: unknown, ctx: Ctx): Promise<T> {
    const def = this.methods[method];
    if (!def) throw new TibiError('not_found', `没有这个方法：${method}`);
    const p = validateParams(def.params, params);
    return def.handler(p, ctx) as Promise<T>;
  }

  async handle(req: RpcRequest): Promise<RpcResponse> {
    const id = req.id ?? null;
    try {
      const ctx = this.makeCtx(req);
      const result = await this.call(req.method, req.params, ctx);
      return { jsonrpc: '2.0', id, result: result ?? null };
    } catch (e) {
      if (e instanceof TibiError) {
        return { jsonrpc: '2.0', id, error: { code: CODES[e.code] ?? -32000, message: e.message, data: { code: e.code, ...(e.data ? { detail: e.data } : {}) } } };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { jsonrpc: '2.0', id, error: { code: -32603, message: msg, data: { code: 'internal', stack: e instanceof Error ? e.stack : undefined } } };
    }
  }
}
