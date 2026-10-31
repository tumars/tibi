import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { j, now, type Database, type SqlValue } from '../db/driver.js';
import { uuidv7 } from '../ids.js';
import { loadParams, schedule, type CardRow } from '../domain/review/fsrs.js';
import type { Rating } from '../types.js';
import { SyncError, type SyncBackend } from './backend.js';
import { dropTriggers, ensureTriggers, syncedColumns } from './capture.js';
import { Clock, hlcFromMs } from './hlc.js';
import { REFS, SPEC, TABLES, type TableSpec } from './spec.js';

/**
 * 同步引擎（08）：把 sync_outbox 打成批次写进共享文件夹，读别的设备的批次按规则合并。
 *
 *   Tibi Sync/library.json            { library_id, format, created_at, created_by }
 *   Tibi Sync/devices/<id>.json       { device_id, name, platform, app_version, format, head, last_seen_at, acks }
 *   Tibi Sync/changes/<id>/<seq>.jsonl.gz   第一行批次头，后面每行一条改动
 *
 * 一条 put 的字段共用一个时钟 c（08 §3 的写法是每个字段一个时钟；读的时候两种都认）。
 * 设备文件里的 head 是已经完整写好的最后一批：先写批次、再更新 head，所以只写了一半的批次别人不会读。
 */
export const FORMAT = 1;
const BATCH_MAX = 2000;
const pad = (n: number) => String(n).padStart(10, '0');

export type Change =
  | { op: 'put'; t: string; id: string; f: Record<string, unknown>; c: string | Record<string, string>; src?: Record<string, string> }
  | { op: 'add'; t: string; row: Record<string, unknown> }
  | { op: 'del'; t: string; id: string; c: string };

export interface DeviceFile { device_id: string; name: string; platform: string; app_version: string; format: number; head: number; last_seen_at: number; acks: Record<string, number> }
export interface LibraryFile { library_id: string; format: number; created_at: number; created_by: string }
export interface SyncRunResult { pushed: number; pulled: number; tables: string[]; errors: number }

const enc = (o: unknown) => strToU8(JSON.stringify(o));
const dec = <T>(d: Uint8Array | undefined): T | undefined => { if (!d) return undefined; try { return JSON.parse(strFromU8(d)) as T; } catch { return undefined; } };

export class SyncEngine {
  private colsCache = new Map<string, string[]>();
  constructor(private db: Database, private backend: SyncBackend, private info: { platform: string; app_version: string }, private wall: () => number = Date.now) {}

  /* ---------- 状态 ---------- */
  static async get(db: Database, key: string): Promise<string | undefined> { return (await db.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [key]))?.value ?? undefined; }
  static async set(db: Database, key: string, value: string | number | null) { await db.run('INSERT INTO sync_state(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value === null ? null : String(value)]); }
  private get = (k: string) => SyncEngine.get(this.db, k);
  private set = (k: string, v: string | number | null) => SyncEngine.set(this.db, k, v);
  private async device(): Promise<{ id: string; node: string; name: string }> {
    const id = await this.get('device_id'); if (!id) throw new SyncError('other', '同步还没有开启');
    return { id, node: (await this.get('node'))!, name: (await this.get('device_name')) ?? '' };
  }
  private async cols(t: string) { let c = this.colsCache.get(t); if (!c) { c = await syncedColumns(this.db, SPEC.get(t)!); this.colsCache.set(t, c); } return c; }

  /** 看文件夹里有没有资料库（08 §10 开启流程） */
  async probe(): Promise<{ library?: LibraryFile & { devices: number; updated_at: number } }> {
    const lib = dec<LibraryFile>(await this.backend.read('library.json'));
    if (!lib) return {};
    if (lib.format > FORMAT) throw new SyncError('format_newer', '另一台设备的 Tibi 版本更新。升级后才能继续同步。');
    const devs = await this.readDevices();
    return { library: { ...lib, devices: devs.length, updated_at: Math.max(lib.created_at, ...devs.map(d => d.last_seen_at)) } };
  }

  private async readDevices(): Promise<DeviceFile[]> {
    const out: DeviceFile[] = [];
    for (const name of await this.backend.list('devices')) {
      if (!name.endsWith('.json')) continue;
      const d = dec<DeviceFile>(await this.backend.read(`devices/${name}`)); if (d?.device_id) out.push(d);
    }
    return out;
  }

  /** 开启：没有资料库就新建；本机已有的数据作为第一批改动推送（字段时钟取各行的 updated_at），再拉一次 */
  async enable(o: { device_name: string; sync_files?: boolean }): Promise<SyncRunResult> {
    let lib = dec<LibraryFile>(await this.backend.read('library.json'));
    if (lib && lib.format > FORMAT) throw new SyncError('format_newer', '另一台设备的 Tibi 版本更新。升级后才能继续同步。');
    let id = await this.get('device_id');
    if (!id || (await this.get('library_id')) !== lib?.library_id) {
      id = uuidv7(this.wall());
      await this.db.run('DELETE FROM sync_clocks'); await this.db.run('DELETE FROM sync_peers'); await this.db.run('DELETE FROM sync_outbox');
      await this.set('push_seq', 0); await this.set('hlc', null);
    }
    if (!lib) { lib = { library_id: uuidv7(this.wall()), format: FORMAT, created_at: this.wall(), created_by: id }; await this.backend.write('library.json', enc(lib)); }
    await this.set('device_id', id); await this.set('node', id.replace(/-/g, '').slice(-6));
    await this.set('device_name', o.device_name); await this.set('library_id', lib.library_id);
    await this.set('sync_files', o.sync_files === false ? '0' : '1');
    await ensureTriggers(this.db);
    await this.set('enabled', '1'); await this.set('capture', '1');
    if ((await this.get('exported')) !== lib.library_id) { await this.exportAll(); await this.set('exported', lib.library_id); }
    return this.sync();
  }

  /** 停止同步：本机数据保留，云端文件不删 */
  async disable() {
    await dropTriggers(this.db);
    await this.set('enabled', '0'); await this.set('capture', '0');
    await this.db.run('DELETE FROM sync_outbox');
  }

  /** 启动时：同步开着就按当前表结构重建触发器（迁移加了列也能记上） */
  static async resume(db: Database) {
    if ((await SyncEngine.get(db, 'enabled')) === '1') { await ensureTriggers(db); await SyncEngine.set(db, 'capture', '1'); }
  }

  /* ---------- 推送 ---------- */
  private async exportAll() {
    const me = await this.device();
    const clock = new Clock(me.node, await this.get('hlc'), this.wall);
    let batch: Change[] = []; const clocks: [string, string, string][] = [];
    const flush = async () => {
      if (!batch.length) return;
      await this.writeBatch(batch);
      await this.db.transaction(async tx => { for (const [t, id, c] of clocks) await tx.run("INSERT OR REPLACE INTO sync_clocks(t, id, f, c) VALUES (?, ?, '*', ?)", [t, id, c]); });
      batch = []; clocks.length = 0;
    };
    for (const spec of TABLES) {
      const cols = await this.cols(spec.t);
      const local = (spec.localGlobs ?? []).map(g => `key NOT GLOB '${g}'`).join(' AND ');
      const has = new Set((await this.db.all<{ name: string }>(`PRAGMA table_info(${spec.t})`)).map(c => c.name));
      const ts = has.has('updated_at') ? 'updated_at' : has.has('created_at') ? 'created_at' : '0';
      const rows = await this.db.all<Record<string, SqlValue>>(`SELECT ${spec.pk.join(" || '|' || ")} AS __id, ${ts} AS __ts, ${cols.join(', ')} FROM ${spec.t}${local ? ` WHERE ${local}` : ''}`);
      for (const r of rows) {
        const { __id, __ts, ...f } = r;
        if (spec.kind === 'add') batch.push({ op: 'add', t: spec.t, row: f });
        else { const c = hlcFromMs(Number(__ts ?? 0), me.node); clock.observe(c); batch.push({ op: 'put', t: spec.t, id: String(__id), f, c, ...(spec.t === 'terms' ? { src: { status: String(f.status_source ?? '') } } : {}) }); clocks.push([spec.t, String(__id), c]); }
        if (batch.length >= BATCH_MAX) await flush();
      }
    }
    await flush();
    await this.set('hlc', clock.value);
  }

  private async writeBatch(changes: Change[]) {
    const me = await this.device();
    const seq = Number(await this.get('push_seq') ?? 0) + 1;
    const cs = changes.flatMap(c => (c.op === 'add' ? [] : typeof c.c === 'string' ? [c.c] : Object.values(c.c)));
    const head = { v: FORMAT, enc: null, device: me.id, seq, from: cs.length ? cs.reduce((a, b) => (a < b ? a : b)) : null, to: cs.length ? cs.reduce((a, b) => (a > b ? a : b)) : null, n: changes.length };
    const text = [head, ...changes].map(x => JSON.stringify(x)).join('\n') + '\n';
    await this.backend.write(`changes/${me.id}/${pad(seq)}.jsonl.gz`, gzipSync(strToU8(text)));
    await this.set('push_seq', seq);
    await this.writeDeviceFile();
  }

  private async writeDeviceFile() {
    const me = await this.device();
    const acks: Record<string, number> = {};
    for (const p of await this.db.all<{ device_id: string; last_read_seq: number }>('SELECT device_id, last_read_seq FROM sync_peers')) acks[p.device_id] = Number(p.last_read_seq);
    const d: DeviceFile = { device_id: me.id, name: me.name, platform: this.info.platform, app_version: this.info.app_version, format: FORMAT, head: Number(await this.get('push_seq') ?? 0), last_seen_at: this.wall(), acks };
    await this.backend.write(`devices/${me.id}.json`, enc(d));
  }

  /** outbox → 批次文件；返回推出去的条数 */
  async push(): Promise<number> {
    const me = await this.device();
    let total = 0;
    for (;;) {
      const rows = await this.db.all<{ seq: number; t: string; id: string; op: string; f: string | null; chg: string | null; ms: number }>('SELECT * FROM sync_outbox ORDER BY seq LIMIT ?', [BATCH_MAX]);
      if (!rows.length) break;
      const clock = new Clock(me.node, await this.get('hlc'), this.wall);
      const changes: Change[] = []; const clockOps: { t: string; id: string; f: string[] | null; c: string }[] = [];
      for (const r of rows) {
        if (r.op === 'add') { changes.push({ op: 'add', t: r.t, row: j.parse(r.f, {}) }); continue; }
        const c = clock.tick(Number(r.ms));
        if (r.op === 'del') { changes.push({ op: 'del', t: r.t, id: r.id, c }); clockOps.push({ t: r.t, id: r.id, f: null, c }); continue; }
        const full = j.parse<Record<string, unknown>>(r.f, {});
        const chg = r.chg ? j.parse<(string | null)[]>(r.chg, []).filter((x): x is string => !!x) : null;
        if (chg && !chg.length) continue;
        const f = chg ? Object.fromEntries(chg.map(k => [k, full[k]])) : full;
        changes.push({ op: 'put', t: r.t, id: r.id, f, c, ...(r.t === 'terms' && 'status' in f ? { src: { status: String(full.status_source ?? '') } } : {}) });
        clockOps.push({ t: r.t, id: r.id, f: chg, c });
      }
      if (changes.length) await this.writeBatch(changes);
      const last = rows[rows.length - 1]!.seq;
      await this.db.transaction(async tx => {
        for (const o of clockOps) {
          if (o.f) for (const k of o.f) await tx.run('INSERT OR REPLACE INTO sync_clocks(t, id, f, c) VALUES (?, ?, ?, ?)', [o.t, o.id, k, o.c]);
          else { await tx.run('DELETE FROM sync_clocks WHERE t = ? AND id = ?', [o.t, o.id]); await tx.run("INSERT INTO sync_clocks(t, id, f, c) VALUES (?, ?, '*', ?)", [o.t, o.id, o.c]); }
        }
        await tx.run('DELETE FROM sync_outbox WHERE seq <= ?', [last]);
        await SyncEngine.set(tx, 'hlc', clock.value);
      });
      total += changes.length;
    }
    return total;
  }

  /* ---------- 拉取与合并 ---------- */
  async pull(): Promise<{ pulled: number; tables: Set<string>; errors: number }> {
    const me = await this.device();
    const tables = new Set<string>(); let pulled = 0; let errors = 0;
    for (const d of await this.readDevices()) {
      if (d.device_id === me.id) continue;
      if (d.format > FORMAT) throw new SyncError('format_newer', '另一台设备的 Tibi 版本更新。升级后才能继续同步。');
      await this.db.run(`INSERT INTO sync_peers(device_id, name, platform, app_version, last_seen_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET name = excluded.name, platform = excluded.platform, app_version = excluded.app_version, last_seen_at = excluded.last_seen_at`, [d.device_id, d.name, d.platform, d.app_version, d.last_seen_at]);
      const peer = await this.db.get<{ last_read_seq: number; removed: number }>('SELECT last_read_seq, removed FROM sync_peers WHERE device_id = ?', [d.device_id]);
      if (peer?.removed) continue;
      let last = Number(peer?.last_read_seq ?? 0);
      // 对方压缩过（08 §6）：比它的 base 还旧，就先读 base 再接着读后面的批次（新设备、久未上线回来的设备都走这里）
      const base = baseOf(await this.backend.list(`changes/${d.device_id}`));
      if (base > last) {
        const data = await this.backend.read(`changes/${d.device_id}/base-${pad(base)}.jsonl.gz`);
        if (data) {
          const r = await this.applyFile(data);
          r.tables.forEach(t => tables.add(t)); pulled += r.applied; errors += r.errors;
          last = base; await this.db.run('UPDATE sync_peers SET last_read_seq = ? WHERE device_id = ?', [base, d.device_id]);
        }
      }
      for (let seq = last + 1; seq <= d.head; seq++) {
        const data = await this.backend.read(`changes/${d.device_id}/${pad(seq)}.jsonl.gz`);
        if (!data) break;   // 还没传完，下次再读
        const r = await this.applyFile(data);
        r.tables.forEach(t => tables.add(t)); pulled += r.applied; errors += r.errors;
        await this.db.run('UPDATE sync_peers SET last_read_seq = ? WHERE device_id = ?', [seq, d.device_id]);
      }
    }
    await this.writeDeviceFile();
    return { pulled, tables, errors };
  }

  private async applyFile(data: Uint8Array) {
    const lines = strFromU8(gunzipSync(data)).split('\n').filter(Boolean);
    const head = JSON.parse(lines[0]!) as { v: number };
    if (head.v > FORMAT) throw new SyncError('format_newer', '另一台设备的 Tibi 版本更新。升级后才能继续同步。');
    return this.applyBatch(lines.slice(1).map(l => JSON.parse(l) as Change));
  }

  /** 攒够多少批才压缩（测试里调小） */
  compactAfter = 20;

  /**
   * 压缩（08 §6）：每台设备只压缩自己的文件夹。所有算数的设备（没被移除、90 天内上线过）都读过第 N 批后，
   * 把 base 和第 N 批之前的批次合成 base-N：每个字段只留最后的值，删掉的行只留墓碑；然后删旧文件。
   * 返回新的 N；没到时候返回 undefined。
   */
  async compact(): Promise<number | undefined> {
    const me = await this.device();
    const head = Number(await this.get('push_seq') ?? 0);
    const files = await this.backend.list(`changes/${me.id}`);
    const base = baseOf(files);
    const removed = new Set((await this.db.all<{ device_id: string }>('SELECT device_id FROM sync_peers WHERE removed = 1')).map(r => r.device_id));
    const cutoff = this.wall() - 90 * 86_400_000;
    const counted = (await this.readDevices()).filter(d => d.device_id !== me.id && !removed.has(d.device_id) && d.last_seen_at >= cutoff);
    const n = Math.min(head, counted.length ? Math.min(...counted.map(d => Number(d.acks?.[me.id] ?? 0))) : head);
    if (n - base < this.compactAfter) return undefined;
    const fold = new Fold();
    const read = async (name: string) => { const d = await this.backend.read(`changes/${me.id}/${name}`); if (!d) throw new Error(`缺 ${name}`); for (const l of strFromU8(gunzipSync(d)).split('\n').filter(Boolean).slice(1)) fold.add(JSON.parse(l) as Change); };
    try {
      if (base) await read(`base-${pad(base)}.jsonl.gz`);
      for (let seq = base + 1; seq <= n; seq++) await read(`${pad(seq)}.jsonl.gz`);
    } catch { return undefined; }   // 有批次缺失：这次不压缩
    const out = fold.changes();
    const text = [{ v: FORMAT, enc: null, device: me.id, base: n, n: out.length }, ...out].map(x => JSON.stringify(x)).join('\n') + '\n';
    await this.backend.write(`changes/${me.id}/base-${pad(n)}.jsonl.gz`, gzipSync(strToU8(text)));
    for (const f of files) {
      const m = /^(?:base-)?(\d+)\.jsonl\.gz$/.exec(f);
      if (m && Number(m[1]) <= n && f !== `base-${pad(n)}.jsonl.gz`) await this.backend.remove(`changes/${me.id}/${f}`);
    }
    return n;
  }

  /** 推送 + 拉取 + 再推一次（拉取时合并重复可能产生本机改动） */
  async sync(): Promise<SyncRunResult> {
    let pushed = await this.push();
    const r = await this.pull();
    pushed += await this.push();
    try { await this.compact(); } catch (e) { console.error('[sync] 压缩失败', e); }   // 压缩失败不影响这次同步
    await this.set('last_synced_at', this.wall());
    return { pushed, pulled: r.pulled, tables: [...r.tables], errors: r.errors };
  }

  private async applyBatch(changes: Change[]): Promise<{ applied: number; tables: Set<string>; errors: number }> {
    const me = await this.device();
    const clock = new Clock(me.node, await this.get('hlc'), this.wall);
    const tables = new Set<string>(); const cards = new Set<string>(); let applied = 0; let errors = 0;
    await this.db.transaction(async tx => {
      await tx.exec('PRAGMA defer_foreign_keys = ON');
      await SyncEngine.set(tx, 'capture', '0');
      const m = new Merger(tx, this, cards);
      for (const ch of changes) {
        if (!SPEC.has(ch.t)) continue;   // 新版本才有的表
        try {
          if (ch.op !== 'add') clock.observe(typeof ch.c === 'string' ? ch.c : Object.values(ch.c).sort().pop() ?? '');
          if (await m.apply(ch)) { applied++; tables.add(ch.t); }
        } catch (e) { errors++; console.error('[sync] 应用失败', ch.t, e instanceof Error ? e.message : e); }
      }
      await SyncEngine.set(tx, 'capture', (await SyncEngine.get(tx, 'enabled')) === '1' ? '1' : '0');
      await SyncEngine.set(tx, 'hlc', clock.value);
    });
    if (cards.size) await recomputeCards(this.db, [...cards]);
    return { applied, tables, errors };
  }

  /** 给 Merger 用 */
  columns(t: string) { return this.cols(t); }

  /* ---------- 设备 ---------- */
  async removeDevice(device_id: string) { await this.db.run('UPDATE sync_peers SET removed = 1 WHERE device_id = ?', [device_id]); }
  async outboxCount() { return Number((await this.db.get<{ n: number }>('SELECT count(*) AS n FROM sync_outbox'))?.n ?? 0); }
}

const baseOf = (files: string[]) => Math.max(0, ...files.map(f => /^base-(\d+)\.jsonl\.gz$/.exec(f)).filter((m): m is RegExpExecArray => !!m).map(m => Number(m[1])));

/** 压缩时把一串改动折叠成"每个字段最后的值 + 墓碑 + 全部追加行"（08 §6） */
class Fold {
  private puts = new Map<string, { t: string; id: string; f: Record<string, unknown>; c: Record<string, string>; src?: Record<string, string> }>();
  private dels = new Map<string, { t: string; id: string; c: string }>();
  private adds = new Map<string, Change>();
  add(ch: Change) {
    if (ch.op === 'add') { this.adds.set(`${ch.t}|${String(ch.row.id ?? JSON.stringify(ch.row))}`, ch); return; }
    const key = `${ch.t}|${ch.id}`;
    if (ch.op === 'del') {
      const prev = this.dels.get(key); if (!prev || ch.c > prev.c) this.dels.set(key, { t: ch.t, id: ch.id, c: ch.c });
      const p = this.puts.get(key);
      if (p) { for (const k of Object.keys(p.f)) if (p.c[k]! <= ch.c) { delete p.f[k]; delete p.c[k]; } if (!Object.keys(p.f).length) this.puts.delete(key); }
      return;
    }
    const tomb = this.dels.get(key)?.c ?? '';
    let p = this.puts.get(key);
    if (!p) { p = { t: ch.t, id: ch.id, f: {}, c: {} }; this.puts.set(key, p); }
    for (const [k, v] of Object.entries(ch.f)) {
      const c = typeof ch.c === 'string' ? ch.c : ch.c[k] ?? '';
      if (c <= tomb || (p.c[k] && p.c[k]! >= c)) continue;
      p.f[k] = v; p.c[k] = c;
    }
    if (ch.src) p.src = { ...p.src, ...ch.src };
    if (!Object.keys(p.f).length) this.puts.delete(key);
  }
  /** 新建的行在前（保持原来先父后子的顺序），然后追加行，最后墓碑 */
  changes(): Change[] {
    const puts: Change[] = [...this.puts.values()].map(p => { const cs = [...new Set(Object.values(p.c))]; return { op: 'put', t: p.t, id: p.id, f: p.f, c: cs.length === 1 ? cs[0]! : p.c, ...(p.src ? { src: p.src } : {}) }; });
    return [...puts, ...this.adds.values(), ...[...this.dels.values()].map(d => ({ op: 'del' as const, ...d }))];
  }
}

/** 一批改动的合并（08 §4），在拉取的事务里跑 */
class Merger {
  constructor(private db: Database, private eng: SyncEngine, private touchedCards: Set<string>) {}

  private async alias(t: string, id: string): Promise<string> {
    let cur = id;
    for (let i = 0; i < 4; i++) { const r = await this.db.get<{ to_id: string }>('SELECT to_id FROM sync_aliases WHERE t = ? AND from_id = ?', [t, cur]); if (!r) break; cur = r.to_id; }
    return cur;
  }
  /** 外键列按 sync_aliases 转到留下的那条 */
  private async mapRefs(t: string, obj: Record<string, unknown>) {
    for (const [target, refs] of Object.entries(REFS)) for (const r of refs) if (r.t === t && typeof obj[r.col] === 'string') obj[r.col] = await this.alias(target, obj[r.col] as string);
  }
  private where(spec: TableSpec, id: string) { const parts = spec.pk.length > 1 ? id.split('|') : [id]; return { sql: spec.pk.map(k => `${k} = ?`).join(' AND '), params: parts }; }
  private async clockOf(t: string, id: string, f: string): Promise<string> {
    return (await this.db.get<{ c: string }>("SELECT c FROM sync_clocks WHERE t = ? AND id = ? AND f IN (?, '*') ORDER BY f = '*' LIMIT 1", [t, id, f]))?.c ?? '';
  }
  /** 本机还没推出去的改动：这些字段本机的更新（它们推送时分配的时钟一定更大） */
  private async pending(t: string, id: string): Promise<Set<string> | 'all'> {
    const rows = await this.db.all<{ chg: string | null; op: string }>('SELECT chg, op FROM sync_outbox WHERE t = ? AND id = ?', [t, id]);
    const s = new Set<string>();
    for (const r of rows) { if (!r.chg || r.op !== 'put') return 'all'; for (const k of j.parse<(string | null)[]>(r.chg, [])) if (k) s.add(k); }
    return s;
  }

  async apply(ch: Change): Promise<boolean> {
    const spec = SPEC.get(ch.t)!;
    if (ch.op === 'add') {
      const row = { ...ch.row }; await this.mapRefs(ch.t, row);
      const cols = (await this.eng.columns(ch.t)).filter(c => c in row);
      const r = await this.db.run(`INSERT OR IGNORE INTO ${ch.t}(${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(c => row[c] as SqlValue));
      if (ch.t === 'review_logs' && typeof row.card_id === 'string') this.touchedCards.add(row.card_id);
      return r.changes > 0;
    }
    if (ch.op === 'del') {
      const id = spec.pk.length === 1 ? await this.alias(ch.t, ch.id) : ch.id;
      const max = (await this.db.get<{ c: string | null }>('SELECT max(c) AS c FROM sync_clocks WHERE t = ? AND id = ?', [ch.t, id]))?.c ?? '';
      if (max && max >= ch.c) return false;
      const w = this.where(spec, id);
      await this.db.run(`DELETE FROM ${ch.t} WHERE ${w.sql}`, w.params);
      await this.db.run('DELETE FROM sync_clocks WHERE t = ? AND id = ?', [ch.t, id]);
      await this.db.run("INSERT INTO sync_clocks(t, id, f, c) VALUES (?, ?, '*', ?)", [ch.t, id, ch.c]);
      return true;
    }
    // put
    const f: Record<string, unknown> = { ...ch.f };
    // 重复文章里输掉的那份：它的章节、句子不要（留下的那份有自己的），记成"丢弃"（to_id = ''）
    if (ch.t === 'sections' && (await this.alias('sections', ch.id) === '' || (typeof f.document_id === 'string' && await this.alias('documents', f.document_id) !== f.document_id))) { await this.drop('sections', ch.id); return false; }
    if (ch.t === 'sentences' && (await this.alias('sentences', ch.id) === '' || (typeof f.section_id === 'string' && await this.alias('sections', f.section_id) === ''))) { await this.drop('sentences', ch.id); return false; }
    if (ch.t === 'term_contexts' && typeof f.sentence_id === 'string' && await this.alias('sentences', f.sentence_id) === '') f.sentence_id = null;
    await this.mapRefs(ch.t, f);
    const avail = await this.eng.columns(ch.t);
    for (const k of Object.keys(f)) if (!avail.includes(k)) delete f[k];
    const clockFor = (k: string) => (typeof ch.c === 'string' ? ch.c : ch.c[k] ?? '');
    let id = spec.pk.length === 1 ? await this.alias(ch.t, ch.id) : spec.pk.every(k => k in f) ? spec.pk.map(k => String(f[k])).join('|') : ch.id;
    let w = this.where(spec, id);
    let exists = !!(await this.db.get(`SELECT 1 AS x FROM ${ch.t} WHERE ${w.sql}`, w.params));

    // 两台设备各建了"同一个"：按自然键认作一条，ID 小（更早建）的留下（08 §4）
    if (!exists && spec.natural && spec.natural.cols.every(c => c in f)) {
      const nk = spec.natural;
      const local = await this.db.get<{ id: string }>(`SELECT id FROM ${ch.t} WHERE ${nk.cols.map(c => `${c} IS ?`).join(' AND ')}${nk.where ? ` AND ${nk.where}` : ''} AND id != ?`, [...nk.cols.map(c => f[c] as SqlValue), id]);
      if (local) {
        if (local.id < id) { await this.db.run('INSERT OR REPLACE INTO sync_aliases(t, from_id, to_id) VALUES (?, ?, ?)', [ch.t, id, local.id]); id = local.id; }
        else await this.rename(ch.t, local.id, id);
        exists = true; w = this.where(spec, id);
      }
    }
    if (ch.t === 'cards') this.touchedCards.add(id);

    if (!exists) {
      const row: Record<string, unknown> = { ...f };
      if (spec.pk.length === 1) row[spec.pk[0]!] = id;
      const all = new Set((await this.db.all<{ name: string }>(`PRAGMA table_info(${ch.t})`)).map(c => c.name));
      if (all.has('updated_at')) row.updated_at = now();
      if (ch.t === 'cards' && row.due === undefined) row.due = row.created_at ?? now();
      const cols = Object.keys(row);
      const ins = (r: Record<string, unknown>) => this.db.run(`INSERT INTO ${ch.t}(${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(c => r[c] as SqlValue));
      try { await ins(row); }
      catch (e) {
        // 每个词只能有一条主语境：对方也有时，这条降为普通语境
        if (ch.t === 'term_contexts' && row.is_primary) { row.is_primary = 0; await ins(row); } else throw e;
      }
      const whole = avail.every(c => c in f);
      if (whole && typeof ch.c === 'string') await this.db.run("INSERT OR REPLACE INTO sync_clocks(t, id, f, c) VALUES (?, ?, '*', ?)", [ch.t, id, ch.c]);
      else for (const k of Object.keys(f)) await this.db.run('INSERT OR REPLACE INTO sync_clocks(t, id, f, c) VALUES (?, ?, ?, ?)', [ch.t, id, k, clockFor(k)]);
      return true;
    }

    // 已有：按字段比较时钟，大的赢；本机还没推出去的字段本机赢
    const pend = await this.pending(ch.t, id);
    if (pend === 'all') return false;
    const local = ch.t === 'terms' ? await this.db.get<{ status_source: string }>('SELECT status_source FROM terms WHERE id = ?', [id]) : undefined;
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) {
      if (spec.pk.includes(k) || pend.has(k)) continue;
      const c = clockFor(k);
      // 熟练度：系统自动推断的改动不覆盖用户亲手做的，用户亲手做的总覆盖自动推断的（08 §4）；两边同类才比时钟
      if (ch.t === 'terms' && (k === 'status' || k === 'status_source') && local) {
        const remoteAuto = String(ch.src?.status ?? f.status_source ?? '').startsWith('auto'), localAuto = local.status_source.startsWith('auto');
        if (remoteAuto && !localAuto) continue;
        if (!remoteAuto && localAuto) { set[k] = v; continue; }
      }
      if (c <= await this.clockOf(ch.t, id, k)) continue;
      set[k] = v;
    }
    const keys = Object.keys(set); if (!keys.length) return false;
    const all = new Set((await this.db.all<{ name: string }>(`PRAGMA table_info(${ch.t})`)).map(c => c.name));
    await this.db.run(`UPDATE ${ch.t} SET ${keys.map(k => `${k} = ?`).join(', ')}${all.has('updated_at') ? ', updated_at = ?' : ''} WHERE ${w.sql}`, [...keys.map(k => set[k] as SqlValue), ...(all.has('updated_at') ? [now()] : []), ...w.params]);
    for (const k of keys) { const c = clockFor(k), lc = await this.clockOf(ch.t, id, k); await this.db.run('INSERT OR REPLACE INTO sync_clocks(t, id, f, c) VALUES (?, ?, ?, ?)', [ch.t, id, k, c > lc ? c : lc]); }
    return true;
  }

  private async drop(t: string, id: string) { await this.db.run("INSERT OR REPLACE INTO sync_aliases(t, from_id, to_id) VALUES (?, ?, '')", [t, id]); }

  /** 本机那条比对方的新：改成对方的 ID，引用它的记录跟着改，旧 ID 记进 sync_aliases */
  private async rename(t: string, from: string, to: string) {
    if (t === 'documents') {
      // 重复的文章：本机这份的章节和句子删掉，等对方那份的章节进来；用户数据（语境、阅读记录）改指过去
      const secs = await this.db.all<{ id: string }>('SELECT id FROM sections WHERE document_id = ?', [from]);
      for (const sec of secs) {
        const sents = await this.db.all<{ id: string }>('SELECT id FROM sentences WHERE section_id = ?', [sec.id]);
        for (const st of sents) { await this.db.run('UPDATE term_contexts SET sentence_id = NULL WHERE sentence_id = ?', [st.id]); await this.drop('sentences', st.id); }
        await this.db.run('DELETE FROM sentences WHERE section_id = ?', [sec.id]);
        await this.drop('sections', sec.id);
      }
      await this.db.run('DELETE FROM sections WHERE document_id = ?', [from]);
      await this.db.run('UPDATE documents SET last_section_id = NULL WHERE id = ?', [from]);
    }
    for (const r of REFS[t] ?? []) await this.db.run(`UPDATE ${r.t} SET ${r.col} = ? WHERE ${r.col} = ?`, [to, from]);
    await this.db.run(`UPDATE ${t} SET id = ? WHERE id = ?`, [to, from]);
    await this.db.run('UPDATE sync_clocks SET id = ? WHERE t = ? AND id = ?', [to, t, from]);
    await this.db.run('UPDATE sync_outbox SET id = ? WHERE t = ? AND id = ?', [to, t, from]);
    await this.db.run('INSERT OR REPLACE INTO sync_aliases(t, from_id, to_id) VALUES (?, ?, ?)', [t, from, to]);
    if (t === 'cards') this.touchedCards.add(to);
  }
}

/** 复习卡片不比较两端状态：按全部有效复习记录的时间顺序用 FSRS 从头重算（08 §4、S5） */
export async function recomputeCards(db: Database, ids: string[]) {
  const params = await loadParams(db);
  for (const id of ids) {
    const card = await db.get<CardRow>('SELECT * FROM cards WHERE id = ?', [id]); if (!card) continue;
    const logs = await db.all<{ rating: number; reviewed_at: number }>('SELECT rating, reviewed_at FROM review_logs_valid WHERE card_id = ? AND rating BETWEEN 1 AND 4 ORDER BY reviewed_at, id', [id]);
    let row: CardRow = { ...card, due: Number(card.created_at), stability: 0, stability_fast: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null };
    for (const l of logs) { const r = await schedule(params, row, l.rating as Rating, Number(l.reviewed_at)); row = { ...row, ...r.patch }; }
    if (!logs.length && card.reps === 0) continue;
    await db.run('UPDATE cards SET due = ?, stability = ?, stability_fast = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?, state = ?, last_review = ? WHERE id = ?',
      [row.due, row.stability, row.stability_fast, row.difficulty, row.elapsed_days, row.scheduled_days, row.learning_steps, row.reps, row.lapses, row.state, row.last_review, id]);
  }
}
