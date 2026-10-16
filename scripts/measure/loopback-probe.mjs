// From inside the app's map page, through devtools: report the page's origin,
// fetch one loopback URL with and without the token, then time 24 concurrent
// loopback fetches spread over the given ports, printing each one's finish
// time so a six-wide wave shows. Console and log entries are echoed.
//
// node scripts/measure/loopback-probe.mjs <devtools ws url> <token> <port>...
const [ws, token, ...ports] = process.argv.slice(2);
const socket = new WebSocket(ws);
let nextId = 1;
const pending = new Map();
socket.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.method === 'Log.entryAdded')
    console.error('log:', d.params.entry.level, d.params.entry.text);
  if (d.method === 'Runtime.consoleAPICalled')
    console.error('console:', d.params.type, JSON.stringify(d.params.args.map((a) => a.value)));
  if (pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
};
await new Promise((r) => (socket.onopen = r));
const call = (method, params = {}) => {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((r) => pending.set(id, r));
};
const evaluate = async (expression) => {
  const d = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return d.result?.result?.value ?? d;
};
await call('Log.enable');
await call('Runtime.enable');

const one = (url) => `(async () => {
  const s = performance.now();
  try {
    const r = await fetch(${JSON.stringify(url)}, { cache: 'no-store' });
    const b = await r.arrayBuffer();
    return { ms: Math.round(performance.now() - s), status: r.status, bytes: b.byteLength };
  } catch (e) { return { ms: Math.round(performance.now() - s), error: String(e) }; }
})()`;

console.log(
  'origin',
  await evaluate(
    'location.origin + " " + location.href.slice(0, 40) + " secure=" + isSecureContext'
  )
);
const p = ports[0];
console.log('with token', await evaluate(one(`http://127.0.0.1:${p}/${token}/probe/0/0/0.pbf`)));
console.log('without token', await evaluate(one(`http://127.0.0.1:${p}/wrong/probe/0/0/0.pbf`)));
console.log(
  'localhost name',
  await evaluate(one(`http://localhost:${p}/${token}/probe/0/0/1.pbf`))
);

for (const spread of [1, ports.length]) {
  const urls = Array.from(
    { length: 24 },
    (_, i) => `http://127.0.0.1:${ports[i % spread]}/${token}/burst${spread}/${Date.now()}/${i}.pbf`
  );
  const r = await evaluate(`(async () => {
    const t0 = performance.now();
    const done = await Promise.all(${JSON.stringify(urls)}.map(async (u) => {
      try { const r = await fetch(u, { cache: 'no-store' }); await r.arrayBuffer(); return Math.round(performance.now() - t0); }
      catch (e) { return String(e); }
    }));
    return { wall: Math.round(performance.now() - t0), done: done.sort((a, b) => a - b) };
  })()`);
  console.log(`24 over ${spread} port(s)`, JSON.stringify(r));
}
socket.close();
