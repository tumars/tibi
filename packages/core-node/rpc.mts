const [method, params] = [process.argv[2]!, JSON.parse(process.argv[3] ?? '{}')];
const ws = new WebSocket('ws://127.0.0.1:3456');
ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
ws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.id === 1) { console.log(JSON.stringify(m.result ?? m.error).slice(0, 400)); ws.close(); } };
