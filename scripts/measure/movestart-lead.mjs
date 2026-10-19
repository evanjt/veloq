// Times how long a real pan gives between the map's movestart and its first
// tile request, from inside the app's own map page. Each round jumps to new
// ground, waits for the map to go idle, then drives one swipe with `adb shell
// input swipe` and reads when movestart fired and when the source was first
// asked for a tile after it.
//
// ANDROID_SERIAL=<serial> node scripts/measure/movestart-lead.mjs <devtools ws url> <source> [cities] [swipe]
//
// cities is "lat,lon;lat,lon;...", one a round. swipe is "x1,y1,x2,y2,ms" in
// device pixels.
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The swipes drive the handset, so another session's measurement would read
// them. Re-exec through the lock unless it is already held.
if (!process.env.VELOQ_DEVICE_LOCK_HELD) {
  const lock = join(dirname(fileURLToPath(import.meta.url)), '..', 'with-device-lock.sh');
  const relock = spawnSync(
    lock,
    [process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' }
  );
  if (relock.error) {
    console.error(`movestart-lead: could not run ${lock}: ${relock.error.message}`);
    process.exit(1);
  }
  process.exit(relock.status ?? 1);
}

const [ws, source, citiesArg, swipeArg] = process.argv.slice(2);
const Z = 14;
const cities = (citiesArg ?? '48.85,2.35;52.52,13.4;41.9,12.5;40.42,-3.7;50.85,4.35')
  .split(';')
  .map((pair) => pair.split(',').map(Number));
const swipe = (swipeArg ?? '1000,800,80,800,300').split(',');

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await opened;
// Wraps the source's loadTile once, so every tile the map asks for is noted
// with the time it was asked for.
await evaluate(`(() => {
  const src = window.map.style.tileManagers[${JSON.stringify(source)}]._source;
  if (!src.__leadWrapped) {
    const load = src.loadTile.bind(src);
    window.__tileAsks = [];
    src.loadTile = (tile) => { window.__tileAsks.push(performance.now()); return load(tile); };
    src.__leadWrapped = true;
    window.map.on('movestart', () => { window.__moveStart = performance.now(); });
  }
  return true;
})()`);

const results = [];
for (const [lat, lon] of cities) {
  await evaluate(`new Promise((resolve) => {
    window.map.once('idle', () => resolve(true));
    window.map.jumpTo({ center: [${lon}, ${lat}], zoom: ${Z} });
  })`);
  await sleep(1500);
  await evaluate(`(() => { window.__tileAsks = []; window.__moveStart = null; return true; })()`);
  execFileSync('adb', ['shell', 'input', 'swipe', ...swipe]);
  await sleep(3000);
  const r = await evaluate(`(() => {
    const t0 = window.__moveStart;
    const after = t0 == null ? [] : window.__tileAsks.filter((t) => t >= t0);
    return { moveStart: t0, asks: after.length, leadMs: after.length ? after[0] - t0 : null };
  })()`);
  results.push({ lat, lon, ...r });
  process.stderr.write(
    `${lat},${lon}: movestart ${r.moveStart == null ? 'none' : 'fired'}, ${r.asks} tiles asked, lead ${r.leadMs == null ? '-' : r.leadMs.toFixed(0) + ' ms'}\n`
  );
}
console.log(JSON.stringify(results));
socket.close();
