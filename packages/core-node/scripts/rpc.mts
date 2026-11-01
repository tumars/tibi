// 开发：直接调开发桥上的一个方法。用法：pnpm --filter @tibi/core-node rpc <method> '<json params>'
// 例：pnpm --filter @tibi/core-node rpc system.status
const [method, raw] = [process.argv[2], process.argv[3]];
if (!method) { console.error('用法：rpc <method> [json]'); process.exit(1); }
const ws = new WebSocket(process.env.TIBI_WS ?? 'ws://127.0.0.1:3456');
ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: JSON.parse(raw ?? '{}') }));
ws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.id === 1) { console.log(JSON.stringify(m.result ?? m.error, null, 2)); ws.close(); } };
ws.onerror = () => { console.error('连不上开发桥，先运行 pnpm core:dev'); process.exit(1); };
