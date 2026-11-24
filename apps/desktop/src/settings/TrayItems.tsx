import { useEffect, useState } from 'react';
import { Switch } from '../components/Switch';
import { tl } from '../lib/i18n';
import { isMacDesktop } from '../lib/macNative';
import { errorInfo, isTauri, rpc } from '../rpc';
import { toast } from '../store/ui';
import { DEFAULT_TRAY_HOTKEY, TRAY_HOTKEYS, type TrayHotkeyPreset } from '../tray/classify';

/** 桌面端菜单栏 / 托盘设置（通用分组）：关闭窗口留在菜单栏、macOS 快速查词全局快捷键 */
export function TrayItems() {
  const [keep, setKeep] = useState(isMacDesktop);
  const [hotkey, setHotkey] = useState<TrayHotkeyPreset>(DEFAULT_TRAY_HOTKEY);
  const [busyHk, setBusyHk] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    rpc.call('settings.get', { keys: ['tray.keep_running', 'tray.hotkey'] }).then(r => {
      if (typeof r['tray.keep_running'] === 'boolean') setKeep(r['tray.keep_running']);
      if (typeof r['tray.hotkey'] === 'string') setHotkey(r['tray.hotkey'] as TrayHotkeyPreset);
    }, () => undefined);
  }, []);

  if (!isTauri()) return null;

  const toggleKeep = async (v: boolean) => {
    setKeep(v);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('window_set_tray_mode', { keepRunning: v });
      await rpc.call('settings.set', { patch: { 'tray.keep_running': v } });
    } catch (e) {
      setKeep(!v);
      toast(errorInfo(e).message, { kind: 'err' });
    }
  };

  const pickHotkey = async (next: TrayHotkeyPreset) => {
    if (busyHk || next === hotkey) return;
    const prev = hotkey;
    setBusyHk(true);
    setHotkey(next);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('tray_set_hotkey', { preset: next });
      await rpc.call('settings.set', { patch: { 'tray.hotkey': next } });
    } catch (e) {
      setHotkey(prev);
      toast(errorInfo(e).message, { kind: 'err' });
    } finally {
      setBusyHk(false);
    }
  };

  return (
    <>
      <div className="item">
        <div>
          <div className="t">{isMacDesktop ? tl('关闭窗口时留在菜单栏') : tl('关闭窗口时留在托盘')}</div>
          <div className="d">{isMacDesktop ? tl('关闭主窗口后 Tibi 仍在顶部菜单栏运行，可随时快速查词或接收每日提醒') : tl('关闭主窗口后 Tibi 仍在托盘运行，可接收每日提醒')}</div>
        </div>
        <div className="ctl">
          <Switch label={isMacDesktop ? tl('关闭窗口时留在菜单栏') : tl('关闭窗口时留在托盘')} checked={keep} onChange={v => void toggleKeep(v)} />
        </div>
      </div>
      {isMacDesktop && (
        <div className="item">
          <div>
            <div className="t">{tl('快速查词快捷键')}</div>
            <div className="d">{tl('在任意应用里按快捷键打开顶部菜单栏查词面板')}</div>
          </div>
          <div className="ctl">
            <div className="seg">
              {TRAY_HOTKEYS.map(h => (
                <button key={h.id} disabled={busyHk} className={hotkey === h.id ? 'on' : ''} onClick={() => void pickHotkey(h.id)}>
                  {h.id === 'off' ? tl('关闭') : h.keys}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
