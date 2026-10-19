// Times a cold tile miss two ways from inside the app's own map page: through
// the Rust store, which fetches on a miss, at the URLs the page's own style
// names for the source (the loopback listener's shards on Android), and through
// the page's own fetch() of the same host. Each round waits for
// both connection pools to go idle, then times one cold burst per arm and one
// warm burst per arm, every burst on tiles neither arm has asked for before.
//
// node scripts/measure/cold-tile-miss.mjs <devtools ws url> <source> <upstream template> <ext> <rounds> <idle s> [first round] [cities]
//
// cities is "lat,lon;lat,lon;...", one a round. A second run on the same build
// needs ground the first did not leave in the store, or its misses are hits.
const [ws, source, upstream, ext, roundsArg, idleArg, firstArg, citiesArg] = process.argv.slice(2);
const rounds = Number(roundsArg ?? 5);
const idleMs = Number(idleArg ?? 120) * 1000;
const first = Number(firstArg ?? 0);
const Z = 14;
const W = 6;
const H = 4;

// Built-up land far from any library the phone holds, one city a round.
const CITIES = {
  openmaptiles: [
    [-23.55, -46.63],
    [-1.29, 36.82],
    [21.03, 105.85],
    [-31.95, 115.86],
    [45.5, -73.6],
  ],
  'satellite-eox': [
    [-12.05, -77.04],
    [30.04, 31.24],
    [-6.2, 106.82],
    [39.74, -104.99],
    [59.91, 10.75],
  ],
};

const cities = citiesArg
  ? citiesArg.split(';').map((pair) => pair.split(',').map(Number))
  : CITIES[source];
if (cities.some((c) => c.length !== 2 || c.some(Number.isNaN))) {
  throw new Error(`cities must read "lat,lon;lat,lon", got ${citiesArg}`);
}
if (first + rounds > cities.length) {
  throw new Error(
    `${rounds} rounds from round ${first + 1} need ${first + rounds} cities, have ${cities.length}`
  );
}

function tileOf(lat, lon) {
  const n = 2 ** Z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [x, y];
}

function block(x0, y0) {
  const out = [];
  for (let dy = 0; dy < H; dy++) for (let dx = 0; dx < W; dx++) out.push([x0 + dx, y0 + dy]);
  return out;
}

const socket = new WebSocket(ws);
let nextId = 1;
const pending = new Map();
socket.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
};
const opened = new Promise((r) => (socket.onopen = r));

function evaluate(expression) {
  const id = nextId++;
  socket.send(
    JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    })
  );
  return new Promise((resolve, reject) =>
    pending.set(id, (d) => {
      const v = d.result?.result?.value;
      if (d.result?.exceptionDetails || v === undefined) reject(new Error(JSON.stringify(d)));
      else resolve(v);
    })
  );
}

// One burst, every request in flight at once as a pan issues them.
function burstExpression(urls) {
  return `(async () => {
    const urls = ${JSON.stringify(urls)};
    const t0 = performance.now();
    const tiles = await Promise.all(urls.map(async (url) => {
      const s = performance.now();
      try {
        const r = await fetch(url, { cache: 'no-store' });
        const b = await r.arrayBuffer();
        const e = performance.getEntriesByName(url).pop();
        return { ms: performance.now() - s, status: r.status, bytes: b.byteLength, proto: e ? e.nextHopProtocol : '' };
      } catch (err) {
        return { ms: performance.now() - s, status: 0, bytes: 0, proto: String(err) };
      }
    }));
    performance.clearResourceTimings();
    return { wall: performance.now() - t0, tiles };
  })()`;
}

function fill(template, x, y) {
  return template.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
}

// The store's templates for the source, read off the live style, spread over
// them by (x + y) % n as MapLibre spreads a source's tiles. The interceptor's
// own path when the style names none, which is a build from before the
// listener.
let storeTemplates = [`https://veloq.fit/veloq-tile/${source}/{z}/{x}/{y}.${ext}`];

const urlsFor = {
  intercept: (tiles) =>
    tiles.map(([x, y]) => fill(storeTemplates[(x + y) % storeTemplates.length], x, y)),
  page: (tiles) => tiles.map(([x, y]) => fill(upstream, x, y)),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await opened;
const styled = await evaluate(
  `(() => { try { return window.map.getStyle().sources[${JSON.stringify(source)}].tiles || []; } catch (e) { return []; } })()`
).catch(() => []);
if (styled.length > 0) storeTemplates = styled;
process.stderr.write(
  `store arm: ${storeTemplates.map((t) => new URL(t.replace(/[{}]/g, '')).origin).join(', ')}\n`
);
const results = [];
for (let round = first; round < first + rounds; round++) {
  const [lat, lon] = cities[round];
  const [cx, cy] = tileOf(lat, lon);
  const blocks = [block(cx - W, cy - H), block(cx, cy - H), block(cx - W, cy), block(cx, cy)];
  // Alternate which arm goes first and which ground it gets.
  const order = round % 2 === 0 ? ['intercept', 'page'] : ['page', 'intercept'];
  if (round % 2 === 1) blocks.reverse();
  process.stderr.write(
    `round ${round + 1}: idle ${idleMs / 1000} s, then ${order.join(' before ')} at ${lat},${lon}\n`
  );
  await sleep(idleMs);
  let b = 0;
  for (const pool of ['cold', 'warm']) {
    for (const arm of order) {
      const tiles = blocks[b++];
      const burst = await evaluate(burstExpression(urlsFor[arm](tiles)));
      results.push({ source, round: round + 1, pool, arm, coords: tiles, ...burst });
      const ms = burst.tiles.map((t) => t.ms).sort((p, q) => p - q);
      const ok = burst.tiles.filter((t) => t.status === 200).length;
      process.stderr.write(
        `  ${pool} ${arm}: wall ${burst.wall.toFixed(0)} ms, p50 ${ms[11].toFixed(0)}, ok ${ok}/24, ${[...new Set(burst.tiles.map((t) => t.proto))].join(',')}\n`
      );
      await sleep(500);
    }
  }
}
console.log(JSON.stringify(results));
socket.close();
