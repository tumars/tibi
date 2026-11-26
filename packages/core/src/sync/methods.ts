import { Type } from '@sinclair/typebox';
import { j } from '../db/driver.js';
import { method, type Ctx, type MethodMap } from '../rpc/define.js';
import { TibiError, type SyncBackendCfg, type SyncStatus } from '../types.js';
import { SyncError, webdavBackend, type SyncBackend } from './backend.js';
import { SyncEngine } from './engine.js';

/**
 * 同步的方法（06 sync 组，08 §10）。后端配置存在 sync_state.backend（不含密码；WebDAV 密码在壳的密钥存储，password_ref 指向它）。
 * 同一时间只跑一轮；自动同步（启动、每 5 分钟、改动后）走 sync.auto，没开时什么都不做。
 */
export type BackendCfg = SyncBackendCfg;
export type { SyncStatus };

let syncQueue: Promise<unknown> = Promise.resolve();
let activeCount = 0;

function enqueueSync<T>(fn: () => Promise<T>): Promise<T> {
  activeCount++;
  const next = syncQueue.catch(() => undefined).then(fn);
  syncQueue = next.catch(() => undefined);
  return next.finally(() => { activeCount = Math.max(0, activeCount - 1); });
}

async function backendFor(ctx: Ctx, cfg: BackendCfg): Promise<SyncBackend> {
  if (cfg.kind === 'webdav') {
    if (!/^https:\/\//i.test(cfg.url) && !/^http:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(cfg.url)) throw new TibiError('invalid_params', 'WebDAV 地址要用 https://（局域网地址可以用 http://）');
    const password = await ctx.platform.getSecret(cfg.password_ref);
    if (!password) throw new SyncError('auth', 'WebDAV 登录失败。检查账号和应用密码。');
    return webdavBackend({ url: cfg.url, user: cfg.user, password });
  }
  if (!ctx.platform.syncFolder) throw new TibiError('conflict', '这个版本不支持文件夹同步，可以用 WebDAV');
  return ctx.platform.syncFolder(cfg);
}
const engine = async (ctx: Ctx, cfg?: BackendCfg) => {
  const c = cfg ?? j.parse<BackendCfg | null>(await SyncEngine.get(ctx.db, 'backend'), null);
  if (!c) throw new TibiError('conflict', '同步还没有开启');
  const info = ctx.platform.info();
  return new SyncEngine(ctx.db, await backendFor(ctx, c), { platform: info.platform, app_version: info.app_version });
};
const errInfo = (e: unknown) => ({ code: e instanceof SyncError ? e.code : (e as { code?: string }).code ?? 'other', message: e instanceof Error ? e.message : String(e) });

export async function syncStatus(ctx: Ctx): Promise<SyncStatus> {
  const g = (k: string) => SyncEngine.get(ctx.db, k);
  const enabled = (await g('enabled')) === '1';
  const err = await g('last_error');
  const peers = await ctx.db.all<{ device_id: string; name: string; platform: string; last_seen_at: number | null; removed: number }>('SELECT device_id, name, platform, last_seen_at, removed FROM sync_peers ORDER BY last_seen_at DESC');
  const id = await g('device_id');
  return {
    enabled, backend: j.parse<BackendCfg | undefined>(await g('backend'), undefined) ?? undefined,
    state: !enabled ? 'off' : activeCount > 0 ? 'syncing' : err ? 'error' : 'idle',
    last_synced_at: Number(await g('last_synced_at')) || undefined,
    pending: await SyncEngine.outboxCount(ctx.db),
    sync_files: (await g('sync_files')) !== '0',
    device: id ? { id, name: (await g('device_name')) ?? '' } : undefined,
    peers: peers.map(p => ({ id: p.device_id, name: p.name, platform: p.platform, last_seen_at: p.last_seen_at ?? undefined, removed: !!p.removed })),
    error: err ? j.parse<{ code: string; message: string } | undefined>(err, undefined) : undefined,
  };
}

/** 跑一轮（严格串行）；发 sync.update，拉到改动时发 data.changed */
function runSync(
  ctx: Ctx,
  fn: (e: SyncEngine) => Promise<{ pushed: number; pulled: number; tables: string[] }>,
  cfg?: BackendCfg,
  opts?: { requireEnabled?: boolean },
) {
  return enqueueSync(async () => {
    // 排队期间可能已调用 sync.disable：拿到执行权后必须先检查 enabled，再初始化后端
    if (opts?.requireEnabled && (await SyncEngine.get(ctx.db, 'enabled')) !== '1') {
      throw new TibiError('conflict', '同步还没有开启');
    }
    ctx.events.emit('sync.update', { state: 'syncing' });
    try {
      const r = await fn(await engine(ctx, cfg));
      await SyncEngine.set(ctx.db, 'last_error', null);
      for (const t of r.tables) ctx.events.emit('data.changed', { table: t, ids: [], source: 'sync' });
      ctx.events.emit('sync.update', { state: 'idle', pushed: r.pushed, pulled: r.pulled, last_synced_at: Date.now() });
      return r;
    } catch (e) {
      const info = errInfo(e);
      await SyncEngine.set(ctx.db, 'last_error', JSON.stringify(info));
      ctx.events.emit('sync.update', { state: 'error', error: info });
      throw e;
    }
  });
}

const S = {
  backend: Type.Union([
    Type.Object({ kind: Type.Literal('icloud') }),
    Type.Object({ kind: Type.Literal('folder'), path: Type.String({ minLength: 1 }) }),
    Type.Object({ kind: Type.Literal('webdav'), url: Type.String({ minLength: 1 }), user: Type.String(), password_ref: Type.String({ minLength: 1 }) }),
  ]),
};

export const syncMethods: MethodMap = {
  'sync.status': method(Type.Object({}), async (_p, ctx) => syncStatus(ctx)),

  'sync.probe': method(Type.Object({ backend: S.backend }), async (p, ctx) => {
    try {
      const eng = await engine(ctx, p.backend as BackendCfg);
      const r = await eng.probe();
      return { ok: true, library: r.library ? { library_id: r.library.library_id, devices: r.library.devices, updated_at: r.library.updated_at } : undefined };
    } catch (e) { return { ok: false, error: errInfo(e) }; }
  }, '测试连接并看文件夹里有没有已有的资料库'),

  'sync.enable': method(Type.Object({ backend: S.backend, device_name: Type.Optional(Type.String()), sync_files: Type.Optional(Type.Boolean()) }), async (p, ctx) => {
    const name = p.device_name?.trim() || ctx.platform.deviceName?.() || ctx.platform.info().platform;
    await runSync(ctx, async e => {
      const r = await e.enable({ device_name: name, sync_files: p.sync_files });
      await SyncEngine.set(ctx.db, 'backend', JSON.stringify(p.backend));
      return r;
    }, p.backend as BackendCfg);
    return syncStatus(ctx);
  }, '新建或加入资料库；本机已有数据作为第一批改动推送，再拉一次'),

  'sync.now': method(Type.Object({}), async (_p, ctx) => {
    if ((await SyncEngine.get(ctx.db, 'enabled')) !== '1') throw new TibiError('conflict', '同步还没有开启');
    await runSync(ctx, e => e.sync(), undefined, { requireEnabled: true }).catch(() => undefined);   // 失败原因记在状态里
    return syncStatus(ctx);
  }, '立即推送 + 拉取'),

  'sync.auto': method(Type.Object({}), async (_p, ctx) => {
    if ((await SyncEngine.get(ctx.db, 'enabled')) !== '1' || activeCount > 0) return { ran: false };
    let ran = false;
    await runSync(ctx, async e => {
      ran = true;
      return e.sync();
    }, undefined, { requireEnabled: true }).catch(() => undefined);
    return { ran };
  }, '自动同步的时机（启动、每 5 分钟、改动后）调用；没开或正在同步时直接返回'),

  'sync.setOptions': method(Type.Object({ sync_files: Type.Optional(Type.Boolean()), device_name: Type.Optional(Type.String({ minLength: 1 })) }), async (p, ctx) => {
    if (p.sync_files !== undefined) await SyncEngine.set(ctx.db, 'sync_files', p.sync_files ? '1' : '0');
    if (p.device_name) await SyncEngine.set(ctx.db, 'device_name', p.device_name);
    return syncStatus(ctx);
  }),

  'sync.removeDevice': method(Type.Object({ device_id: Type.String() }), async (p, ctx) => {
    await SyncEngine.removeDevice(ctx.db, p.device_id);
    return syncStatus(ctx);
  }, '不再读这台设备的改动；它的文件夹保留'),

  'sync.disable': method(Type.Object({}), async (_p, ctx) => {
    await enqueueSync(async () => {
      await SyncEngine.disableLocal(ctx.db);
      ctx.events.emit('sync.update', { state: 'idle', pushed: 0, pulled: 0 });
    });
    return { ok: true as const };
  }, '停止同步；本机数据保留，云端文件不删'),
};
