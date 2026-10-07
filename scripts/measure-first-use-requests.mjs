#!/usr/bin/env node
// Times the requests a fresh library's first-use step makes against the real
// intervals.icu API, in the order the engine makes them: the census, the newest
// five by count, then each of the five's detail body, streams and intervals,
// one after another. The total is the network floor under "the newest five are
// ready offline"; device time adds storage, track ingest and rendering on top.
//
// Each request waits for the slot the engine's governor would give it, one
// dispatch per 1/MAX_DISPATCH_PER_SEC seconds, read from its source, so the
// figure includes the pace the device pays as well as the round trips.
//
// Usage: node scripts/measure-first-use-requests.mjs <path to .env> [runs]
// The .env holds EXPO_PUBLIC_API_KEY and EXPO_PUBLIC_ATHLETE_ID. Prints one line
// per request (milliseconds and bytes, no ids) and a total per run.
import { readFileSync } from 'node:fs';

const [envPath, runsArg] = process.argv.slice(2);
if (!envPath) {
  console.error('usage: measure-first-use-requests.mjs <.env> [runs]');
  process.exit(2);
}
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => [
      line.slice(0, line.indexOf('=')).trim(),
      line.slice(line.indexOf('=') + 1).trim(),
    ])
);
const key = env.EXPO_PUBLIC_API_KEY;
const athlete = env.EXPO_PUBLIC_ATHLETE_ID;
const runs = Number(runsArg ?? 2);

// The field lists and stream types the engine asks for, read from its source so
// the request matches what ships.
const types = readFileSync(
  new URL('../modules/veloqrs/rust/veloqrs/src/net/types.rs', import.meta.url),
  'utf8'
);
const sync = readFileSync(
  new URL('../modules/veloqrs/rust/veloqrs/src/objects/sync.rs', import.meta.url),
  'utf8'
);
const fields = [
  types.match(/pub const ACTIVITY_FIELDS: &str = "([^"]+)"/)[1],
  types.match(/pub const ACTIVITY_STATS_EXTRA: &str = "([^"]+)"/s)[1].replace(/\\\s*/g, ''),
].join(',');
const streamTypes = sync
  .match(/const DETAIL_STREAM_TYPES_KEY: &str = "([^"]+)"/s)[1]
  .replace(/\\\s*/g, '');

const perSec = Number(
  readFileSync(
    new URL('../modules/veloqrs/rust/veloqrs/src/governor.rs', import.meta.url),
    'utf8'
  ).match(/const MAX_DISPATCH_PER_SEC: u32 = (\d+);/)[1]
);
const minIntervalMs = 1000 / perSec;
let nextAt = 0;

const base = 'https://intervals.icu/api/v1';
const auth = 'Basic ' + Buffer.from(`API_KEY:${key}`).toString('base64');
const today = new Date().toISOString().slice(0, 10);

async function get(label, path, params) {
  const wait = nextAt - performance.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  nextAt = Math.max(performance.now(), nextAt) + minIntervalMs;
  const url = `${base}${path}?${new URLSearchParams(params ?? {})}`;
  const started = performance.now();
  const res = await fetch(url, { headers: { Authorization: auth, 'Accept-Encoding': 'gzip' } });
  const body = await res.arrayBuffer();
  const ms = Math.round(performance.now() - started);
  console.log(
    `  ${label.padEnd(22)} ${String(res.status).padStart(3)} ${String(ms).padStart(6)} ms ${String(body.byteLength).padStart(9)} B`
  );
  if (!res.ok) throw new Error(`${label} answered ${res.status}`);
  return { ms, body: Buffer.from(body).toString('utf8') };
}

for (let run = 1; run <= runs; run++) {
  console.log(`run ${run}`);
  const runStarted = performance.now();
  const census = await get('census', `/athlete/${athlete}/activities`, {
    oldest: '2000-01-01',
    newest: today,
    fields: 'id,start_date_local,created,icu_sync_date,stream_types',
  });
  const count = JSON.parse(census.body).length;
  const listed = await get('newest five', `/athlete/${athlete}/activities`, {
    oldest: '2000-01-01',
    newest: today,
    fields,
    limit: '5',
  });
  const firstCardMs = Math.round(performance.now() - runStarted);
  const ids = JSON.parse(listed.body).map((a) => a.id);
  for (const [i, id] of ids.entries()) {
    await get(`#${i + 1} detail`, `/activity/${id}`);
    await get(`#${i + 1} streams`, `/activity/${id}/streams.json`, { types: streamTypes });
    await get(`#${i + 1} intervals`, `/activity/${id}/intervals`);
  }
  const total = Math.round(performance.now() - runStarted);
  console.log(
    `  library ${count} activities; rows of five after ${firstCardMs} ms; five ready after ${total} ms`
  );
}
