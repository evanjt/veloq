#!/usr/bin/env node
// Replays the elevation backfill's fetch against the real intervals.icu API, in
// the shape the engine walks its queue: batches of BATCH activities, at most
// FETCH_CONCURRENCY in flight, every request waiting for the slot the governor
// would give it at MAX_DISPATCH_PER_SEC, and each batch finishing before the
// next starts. The constants and the stream types are read from the engine's
// source so the run matches what ships.
//
// The queue is every activity in the library whose stream types include
// latlng, since only a stored track can be owed elevation. Records wire bytes
// (gzip, as the transport asks for it), decoded bytes and points per request,
// and the wall clock per batch and in total. The figure is the network half
// only: the device adds the per-batch store and the final re-cut on top.
//
// With a compare step N > 0, every Nth activity is also fetched with the bulk
// track's stream types, to set the elevation-only ask against the whole track.
//
// Usage: node scripts/measure-elevation-backfill.mjs <path to .env> [limit] [compare step]
// The .env holds EXPO_PUBLIC_API_KEY and EXPO_PUBLIC_ATHLETE_ID. Prints totals
// and distributions only, no ids or names.
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { gunzipSync } from 'node:zlib';

const [envPath, limitArg, compareArg] = process.argv.slice(2);
if (!envPath) {
  console.error('usage: measure-elevation-backfill.mjs <.env> [limit] [compare step]');
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
const limit = limitArg ? Number(limitArg) : Infinity;
const compareStep = Number(compareArg ?? 0);

const source = (path) =>
  readFileSync(new URL(`../modules/veloqrs/rust/veloqrs/src/${path}`, import.meta.url), 'utf8');
const endpoints = source('net/endpoints.rs');
const backfill = source('net/elevation_backfill.rs');
const elevationTypes = endpoints.match(/pub const ELEVATION_STREAM_TYPES: &str = "([^"]+)"/)[1];
const trackTypes = endpoints.match(/pub const TRACK_STREAM_TYPES: &str = "([^"]+)"/)[1];
const batchSize = Number(backfill.match(/const BATCH: usize = (\d+);/)[1]);
const concurrency = Number(backfill.match(/const FETCH_CONCURRENCY: usize = (\d+);/)[1]);
const perSec = Number(source('governor.rs').match(/const MAX_DISPATCH_PER_SEC: u32 = (\d+);/)[1]);
const minIntervalMs = 1000 / perSec;
let nextAt = 0;

const auth = 'Basic ' + Buffer.from(`API_KEY:${key}`).toString('base64');
const headers = {
  Authorization: auth,
  'Accept-Encoding': 'gzip',
  Accept: 'application/json',
  'User-Agent': 'veloq-measure',
};

function get(path, params, paced) {
  return new Promise(async (resolve, reject) => {
    if (paced) {
      const wait = nextAt - performance.now();
      nextAt = Math.max(performance.now(), nextAt) + minIntervalMs;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    const started = performance.now();
    const url = new URL(`https://intervals.icu/api/v1${path}`);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    const req = request(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const wire = Buffer.concat(chunks);
        const gz = res.headers['content-encoding'] === 'gzip';
        const body = gz ? gunzipSync(wire) : wire;
        resolve({
          status: res.statusCode,
          gzip: gz,
          wire: wire.length,
          decoded: body.length,
          ms: performance.now() - started,
          body,
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

function points(body) {
  try {
    const streams = JSON.parse(body.toString('utf8'));
    if (!Array.isArray(streams)) return 0;
    return Math.max(0, ...streams.map((s) => (Array.isArray(s.data) ? s.data.length : 0)));
  } catch {
    return 0;
  }
}

const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

const list = await get(`/athlete/${athlete}/activities`, {
  oldest: '2000-01-01',
  newest: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
});
const activities = JSON.parse(list.body.toString('utf8'));
const queue = activities
  .filter((a) => (a.stream_types ?? []).includes('latlng'))
  .map((a) => a.id)
  .slice(0, limit);
console.log(
  `library ${activities.length} activities, queue ${queue.length} with latlng; ` +
    `types=${elevationTypes} batch=${batchSize} in-flight=${concurrency} pace=${perSec}/s`
);

const rows = [];
const batchMs = [];
const started = performance.now();
for (let i = 0; i < queue.length; i += batchSize) {
  const batch = queue.slice(i, i + batchSize);
  const batchStarted = performance.now();
  let next = 0;
  const worker = async () => {
    while (next < batch.length) {
      const id = batch[next++];
      const r = await get(`/activity/${id}/streams.json`, { types: elevationTypes }, true);
      rows.push({
        status: r.status,
        gzip: r.gzip,
        wire: r.wire,
        decoded: r.decoded,
        ms: r.ms,
        pts: points(r.body),
      });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  batchMs.push(performance.now() - batchStarted);
}
const totalMs = performance.now() - started;

const ok = rows.filter((r) => r.status === 200);
const withPts = ok.filter((r) => r.pts > 0);
const statuses = rows.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
console.log(
  `statuses ${JSON.stringify(statuses)}, gzip on ${ok.filter((r) => r.gzip).length}/${ok.length}`
);
console.log(`empty bodies (no altitude series) ${ok.length - withPts.length}`);
console.log(
  `wire total ${(sum(ok.map((r) => r.wire)) / 1e6).toFixed(2)} MB, decoded total ${(sum(ok.map((r) => r.decoded)) / 1e6).toFixed(2)} MB`
);
console.log(
  `wire per activity: median ${(
    q(
      ok.map((r) => r.wire),
      0.5
    ) / 1e3
  ).toFixed(1)} KB, ` +
    `mean ${(sum(ok.map((r) => r.wire)) / ok.length / 1e3).toFixed(1)} KB, ` +
    `p95 ${(
      q(
        ok.map((r) => r.wire),
        0.95
      ) / 1e3
    ).toFixed(1)} KB, max ${(Math.max(...ok.map((r) => r.wire)) / 1e3).toFixed(1)} KB`
);
console.log(
  `wire bytes per point (median) ${q(
    withPts.map((r) => r.wire / r.pts),
    0.5
  ).toFixed(2)} B, ` +
    `compression ${(sum(ok.map((r) => r.decoded)) / sum(ok.map((r) => r.wire))).toFixed(1)}x`
);
console.log(
  `latency ms: p50 ${q(
    rows.map((r) => r.ms),
    0.5
  ).toFixed(0)}, p95 ${q(
    rows.map((r) => r.ms),
    0.95
  ).toFixed(0)}, max ${Math.max(...rows.map((r) => r.ms)).toFixed(0)}`
);
console.log(
  `batch ms: p50 ${q(batchMs, 0.5).toFixed(0)}, p95 ${q(batchMs, 0.95).toFixed(0)}, floor ${((batchSize / perSec) * 1000).toFixed(0)}`
);
console.log(
  `wall clock ${(totalMs / 1000).toFixed(1)} s for ${rows.length} requests, ` +
    `${(rows.length / (totalMs / 1000)).toFixed(2)} req/s, ${(((totalMs / rows.length) * 1000) / 1000).toFixed(0)} ms per activity`
);

if (compareStep > 0) {
  const sample = queue.filter((_, i) => i % compareStep === 0);
  const pairs = [];
  for (const id of sample) {
    const e = await get(`/activity/${id}/streams.json`, { types: elevationTypes }, true);
    const t = await get(`/activity/${id}/streams.json`, { types: trackTypes }, true);
    if (e.status === 200 && t.status === 200 && points(t.body) > 0)
      pairs.push({ e: e.wire, t: t.wire });
  }
  console.log(
    `compare on ${pairs.length}: elevation-only ${(sum(pairs.map((p) => p.e)) / 1e3).toFixed(0)} KB, ` +
      `whole track ${(sum(pairs.map((p) => p.t)) / 1e3).toFixed(0)} KB, ratio ${(sum(pairs.map((p) => p.e)) / sum(pairs.map((p) => p.t))).toFixed(3)}`
  );
}
