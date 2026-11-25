import { useCallback, useEffect, useState } from 'react';
import { Switch } from '../components/Switch';
import { SettingItem } from '../components/ui';
import { errorInfo, isTauri, rpc } from '../rpc';
import { useCore } from '../store/core';
import { toast } from '../store/ui';
import { tl } from '../lib/i18n';

/**
 * 设置 → 高级 → 其他 AI 工具（06 §6，A6，默认关）：允许 Codex / Claude Code 这类工具通过 MCP 使用 Tibi。
 * 读能力默认全开；写能力逐项打开，打开后仍按权限模式请你确认。下面给出可复制的接入配置。
 */
type Cfg = { enabled: boolean; write_tools: string[]; tools: { name: string; description: string; write: boolean }[] };

export function McpItems() {
  const [cfg, setCfg] = useState<Cfg>();
  const [cmd, setCmd] = useState<{ program: string; data_dir: string }>();
  const dbPath = useCore(s => s.status?.db_path);
  const load = useCallback(() => { rpc.call('mcp.config', {}).then(setCfg, () => undefined); }, []);
  useEffect(() => {
    load();
    if (isTauri()) void import('@tauri-apps/api/core').then(({ invoke }) => invoke<{ program: string; data_dir: string }>('mcp_command').then(setCmd, () => undefined));
  }, [load]);
  const save = async (p: { enabled?: boolean; write_tools?: string[] }) => { try { await rpc.call('mcp.configure', p); load(); } catch (e) { toast(errorInfo(e).message, { kind: 'err' }); } };
  if (!cfg) return null;
  const dataDir = cmd?.data_dir ?? (dbPath ? dbPath.replace(/[\\/][^\\/]+$/, '') : tl('<Tibi 数据目录>'));
  const program = cmd?.program ?? 'pnpm --filter @tibi/core-node exec tsx src/bin.ts';
  const claude = `claude mcp add tibi -- "${program}" --mcp --data-dir "${dataDir}"`;
  const codex = `[mcp_servers.tibi]\ncommand = "${program}"\nargs = ["--mcp", "--data-dir", "${dataDir.replace(/\\/g, '\\\\')}"]`;
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast(tl('已复制')), () => toast(tl('复制失败'), { kind: 'err' }));
  const writes = cfg.tools.filter(t => t.write);
  return <>
    <SettingItem
      title={tl('允许其他 AI 工具使用 Tibi（MCP）')}
      tip={tl('开启后，Codex、Claude Code 等工具可在 Tibi 运行时读取生词、文章与学习数据。')}
      control={<Switch label={tl('允许其他 AI 工具使用 Tibi')} checked={cfg.enabled} onChange={v => void save({ enabled: v })} />}
    />
    {cfg.enabled && <>
      <SettingItem
        stacked
        title={tl('它们可以写入的')}
        tip={tl('读取权限默认开启；写入权限需逐项启用，执行前仍按权限模式弹出审批。')}
      >
        <div className="mcpw">{writes.map(t => <label key={t.name} className="mcpt"><Switch label={t.name} checked={cfg.write_tools.includes(t.name)} onChange={v => void save({ write_tools: v ? [...cfg.write_tools, t.name] : cfg.write_tools.filter(x => x !== t.name) })} /><code>{t.name}</code><span className="lbl">{t.description.replace(/（写入.*$/, '')}</span></label>)}</div>
      </SettingItem>
      <SettingItem
        stacked
        title={tl('接入配置')}
        tip={!isTauri() ? tl('开发模式下请在仓库根目录执行命令。') : undefined}
      >
        <div className="d">Claude Code</div>
        <div className="snip"><pre>{claude}</pre><button className="btn sm" onClick={() => void copy(claude)}>{tl('复制')}</button></div>
        <div className="d">Codex (~/.codex/config.toml)</div>
        <div className="snip"><pre>{codex}</pre><button className="btn sm" onClick={() => void copy(codex)}>{tl('复制')}</button></div>
      </SettingItem>
    </>}
  </>;
}
