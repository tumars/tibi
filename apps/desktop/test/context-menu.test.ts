import { describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => {
  const item = { setText: vi.fn(async (_: string) => {}), setEnabled: vi.fn(async (_: boolean) => {}), setChecked: vi.fn(async (_: boolean) => {}), close: vi.fn(async () => {}) };
  const make = (rid = 1) => ({ rid, close: vi.fn(async () => {}), get: vi.fn(async (_: string) => item) });
  return { item, make, create: vi.fn(async (_: unknown) => make()), invoke: vi.fn(async (_command: string, _args: unknown) => {}) };
});
vi.mock('@tauri-apps/api/menu', () => ({ Menu: { new: native.create } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('../src/rpc', () => ({ isTauri: () => false }));
vi.mock('../src/store/ui', () => ({ useUi: {} }));

import { popupNativeMenu } from '../src/lib/macNative';

describe('原生阅读菜单的资源与命令', () => {
  it('经壳弹出原生菜单并保留命令资源，支持分隔、勾选、子菜单与异步更新', async () => {
    const first = native.make(101), second = native.make(102);
    native.create.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const a = await popupNativeMenu([
      { label: '查词', run: vi.fn() }, null,
      { id: 'known', label: '已知', checked: true, run: vi.fn() },
      { label: '所在句子', items: [{ label: '复制', run: vi.fn() }] },
    ], { x: 123, y: 234 });
    const options = native.create.mock.calls[0]![0] as { items: { id?: string; checked?: boolean; item?: string; items?: unknown[] }[] };
    expect(options.items[1]).toEqual({ item: 'Separator' });
    expect(options.items[2]).toMatchObject({ id: 'known', checked: true });
    expect(options.items[3]!.items).toHaveLength(1);
    const [command, args] = native.invoke.mock.calls[0]!;
    expect(command).toBe('popup_context_menu');
    expect(JSON.parse(JSON.stringify(args))).toEqual({ rid: first.rid, at: { Logical: { x: 123, y: 234 } } });
    expect(first.close).not.toHaveBeenCalled();
    await a.update('known', { label: '已掌握', enabled: false, checked: true });
    expect(native.item.setText).toHaveBeenCalledWith('已掌握');
    expect(native.item.setEnabled).toHaveBeenCalledWith(false);
    expect(native.item.setChecked).toHaveBeenCalledWith(true);
    expect(native.item.close).toHaveBeenCalledOnce();
    const b = await popupNativeMenu([{ label: '下一次', run: vi.fn() }]);
    expect(first.close).toHaveBeenCalledOnce();
    expect(native.invoke).toHaveBeenNthCalledWith(2, 'popup_context_menu', { rid: second.rid, at: undefined });
    expect(second.close).not.toHaveBeenCalled();
    await b.close(); await b.close();
    expect(second.close).toHaveBeenCalledOnce();
  });
});
