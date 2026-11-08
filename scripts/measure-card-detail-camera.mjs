#!/usr/bin/env node
// How far the feed card's 3D camera sits from the detail's for the same ride.
//
// The detail computes its camera from the full altitude stream. The card
// computes it from the preview line, a Douglas-Peucker signature of at most
// 100 points that carries no elevation, so it takes the no-altitude fallback.
// This reproduces both from the account in the root `.env` and reports the
// bearing and pitch gap, and how often the two smart-mode verdicts disagree.
//
//   node scripts/measure-card-detail-camera.mjs [cacheDir]
//
// Streams are cached under cacheDir, never in the repository.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateTerrainCamera, resolveTerrain3D } from '../src/features/maps/lib/cameraAngle.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = process.argv[2] ?? '/tmp/terrain-occlusion-cache';
mkdirSync(join(cacheDir, 'streams'), { recursive: true });

const SPORTS = new Set((process.env.SPORTS ?? 'Ride,GravelRide').split(','));
const OLDEST = process.env.OLDEST ?? '2024-11-01';
const LIMIT = Number(process.env.LIMIT ?? 400);
// tracematch's signature defaults
const TOLERANCE_DEG = 0.0001;
const MAX_POINTS = 100;

function readEnv() {
  const env = {};
  for (const line of readFileSync(join(here, '../../.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}
const env = readEnv();
const auth = 'Basic ' + Buffer.from(`API_KEY:${env.EXPO_PUBLIC_API_KEY}`).toString('base64');
const headers = { Authorization: auth, 'User-Agent': 'Veloq research' };

async function api(path) {
  const res = await fetch(`https://intervals.icu/api/v1${path}`, { headers });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function streamsFor(id) {
  const file = join(cacheDir, 'streams', `${id}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const body = await api(`/activity/${id}/streams.json?types=latlng,altitude,fixed_altitude`);
  writeFileSync(file, JSON.stringify(body));
  return body;
}

function parse(raw) {
  const ll = raw.find((s) => s.type === 'latlng');
  if (!ll?.data || !ll?.data2) return null;
  const alt =
    raw.find((s) => s.type === 'fixed_altitude') ?? raw.find((s) => s.type === 'altitude');
  const coords = [];
  const altitude = [];
  for (let i = 0; i < Math.min(ll.data.length, ll.data2.length); i++) {
    const lat = ll.data[i];
    const lng = ll.data2[i];
    if (lat == null || lng == null || !isFinite(lat) || !isFinite(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) continue;
    coords.push([lng, lat]);
    altitude.push(alt?.data?.[i] ?? NaN);
  }
  return { coords, altitude };
}

// Douglas-Peucker on raw degrees, as geo's `simplify` does, returning indices.
function simplifyIdx(coords, tol) {
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = coords[a];
    const [bx, by] = coords[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = coords[i];
      let d;
      if (len2 === 0) d = Math.hypot(px - ax, py - ay);
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const idx = [];
  for (let i = 0; i < coords.length; i++) if (keep[i]) idx.push(i);
  if (idx.length > MAX_POINTS) {
    const last = idx.length - 1;
    const step = last / (MAX_POINTS - 1);
    return Array.from({ length: MAX_POINTS }, (_, i) => idx[Math.min(last, Math.round(i * step))]);
  }
  return idx;
}

const angle = (a, b) => {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
};
const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const list = await api(`/athlete/0/activities?oldest=${OLDEST}&newest=${today}`);
  const rides = list
    .filter((a) => SPORTS.has(a.type) && (a.stream_types ?? []).includes('latlng'))
    .slice(0, LIMIT);
  process.stderr.write(`${rides.length} rides with a track\n`);
  const rows = [];
  for (const a of rides) {
    let parsed;
    try {
      parsed = parse(await streamsFor(a.id));
    } catch (e) {
      process.stderr.write(`${a.id}: ${e.message}\n`);
      continue;
    }
    if (!parsed || parsed.coords.length < 2) continue;
    const idx = simplifyIdx(parsed.coords, TOLERANCE_DEG);
    const sig = idx.map((i) => parsed.coords[i]);
    const sigAlt = idx.map((i) => parsed.altitude[i]);
    const common = {
      mode: 'smart',
      gain: a.total_elevation_gain ?? NaN,
      distance: a.distance ?? NaN,
      override: null,
    };
    const detail = resolveTerrain3D({
      ...common,
      coordinates: parsed.coords,
      altitude: parsed.altitude,
    });
    const cardToday = resolveTerrain3D({ ...common, coordinates: sig, altitude: undefined });
    const cardWithEle = resolveTerrain3D({ ...common, coordinates: sig, altitude: sigAlt });
    const full = calculateTerrainCamera(parsed.coords, parsed.altitude);
    rows.push({
      id: a.id,
      points: parsed.coords.length,
      sigPoints: sig.length,
      range: full.elevationRange ?? 0,
      detail,
      cardToday,
      cardWithEle,
    });
  }

  const both3D = rows.filter((r) => r.detail.show3D && r.cardToday.show3D);
  const dToday = both3D.map((r) => angle(r.cardToday.camera.bearing, r.detail.camera.bearing));
  const dEle = rows
    .filter((r) => r.detail.show3D && r.cardWithEle.show3D)
    .map((r) => angle(r.cardWithEle.camera.bearing, r.detail.camera.bearing));
  const pitchToday = both3D.filter(
    (r) => r.cardToday.camera.pitch !== r.detail.camera.pitch
  ).length;
  const pitchEle = rows.filter(
    (r) =>
      r.detail.show3D &&
      r.cardWithEle.show3D &&
      r.cardWithEle.camera.pitch !== r.detail.camera.pitch
  ).length;
  const out = {
    rides: rows.length,
    detail3D: rows.filter((r) => r.detail.show3D).length,
    cardToday3D: rows.filter((r) => r.cardToday.show3D).length,
    cardWithEle3D: rows.filter((r) => r.cardWithEle.show3D).length,
    verdictDisagreeToday: {
      cardOnly: rows.filter((r) => r.cardToday.show3D && !r.detail.show3D).length,
      detailOnly: rows.filter((r) => !r.cardToday.show3D && r.detail.show3D).length,
    },
    verdictDisagreeWithEle: {
      cardOnly: rows.filter((r) => r.cardWithEle.show3D && !r.detail.show3D).length,
      detailOnly: rows.filter((r) => !r.cardWithEle.show3D && r.detail.show3D).length,
    },
    bearingGapToday: {
      n: dToday.length,
      median: q(dToday, 0.5),
      p90: q(dToday, 0.9),
      over30: dToday.filter((d) => d > 30).length,
      over90: dToday.filter((d) => d > 90).length,
      pitchDiffers: pitchToday,
    },
    bearingGapWithEle: {
      n: dEle.length,
      median: q(dEle, 0.5),
      p90: q(dEle, 0.9),
      over30: dEle.filter((d) => d > 30).length,
      over90: dEle.filter((d) => d > 90).length,
      pitchDiffers: pitchEle,
    },
  };
  writeFileSync(
    join(cacheDir, 'card-detail-camera.json'),
    JSON.stringify({ summary: out, rows }, null, 1)
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
