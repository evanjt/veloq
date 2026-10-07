#!/usr/bin/env node
// How much of each ride's route the smart-mode 3D snapshot camera hides
// behind terrain, against the alternatives a different bearing would give.
//
// Reads the account in the root `.env`, takes the production camera from
// `calculateTerrainCamera`, places it the way the bundled renderer does for
// the snapshot viewport, and ray-casts every sampled route point against the
// same terrarium DEM the renderer drapes, at the same exaggeration.
//
//   node scripts/measure-terrain-occlusion.mjs [cacheDir]
//
// Streams and DEM tiles are cached under cacheDir (default a tmp directory),
// never in the repository, since the streams are an athlete's own tracks.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { calculateTerrainCamera } from '../src/features/maps/lib/cameraAngle.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = process.argv[2] ?? '/tmp/terrain-occlusion-cache';
mkdirSync(join(cacheDir, 'streams'), { recursive: true });
mkdirSync(join(cacheDir, 'dem'), { recursive: true });

const SPORTS = new Set((process.env.SPORTS ?? 'Ride,GravelRide').split(','));
const EXAGGERATION = 1.5; // TERRAIN_3D_CONFIG.defaultExaggeration
const VIEW_W = 384; // a 1080 px wide handset at density 2.8125
const VIEW_H = 240; // SNAPSHOT_HEIGHT
const FOV = (36.87 * Math.PI) / 180; // the renderer's default vertical field of view
const ROUTE_SAMPLES = 400;
const RAY_STEPS = 96;
const CLEARANCE_M = 2;
const DEM_TEMPLATE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const R = 6378137;

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

// The production rule: the latlng mask governs every series, and corrected
// altitude wins over raw.
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

const tiles = new Map();
async function loadTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tiles.has(key)) return tiles.get(key);
  const file = join(cacheDir, 'dem', `${z}-${x}-${y}.png`);
  let buf;
  if (existsSync(file)) buf = readFileSync(file);
  else {
    const res = await fetch(DEM_TEMPLATE.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    if (!res.ok) throw new Error(`dem ${key}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(file, buf);
  }
  const png = PNG.sync.read(buf);
  const h = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) {
    const d = png.data;
    h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  }
  tiles.set(key, h);
  return h;
}

function worldPx(lng, lat, z) {
  const s = 256 * 2 ** z;
  const x = ((lng + 180) / 360) * s;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s;
  return [x, y];
}

async function preload(z, lngLats) {
  const need = new Set();
  for (const [lng, lat] of lngLats) {
    const [x, y] = worldPx(lng, lat, z);
    need.add(`${Math.floor(x / 256)}/${Math.floor(y / 256)}`);
  }
  await Promise.all([...need].map((k) => loadTile(z, ...k.split('/').map(Number))));
}

function heightAt(z, lng, lat) {
  const [px, py] = worldPx(lng, lat, z);
  const fx = px - 0.5;
  const fy = py - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const sample = (x, y) => {
    const t = tiles.get(`${z}/${Math.floor(x / 256)}/${Math.floor(y / 256)}`);
    if (!t) return NaN;
    return t[(((y % 256) + 256) % 256) * 256 + (((x % 256) + 256) % 256)];
  };
  const tx = fx - x0;
  const ty = fy - y0;
  return (
    sample(x0, y0) * (1 - tx) * (1 - ty) +
    sample(x0 + 1, y0) * tx * (1 - ty) +
    sample(x0, y0 + 1) * (1 - tx) * ty +
    sample(x0 + 1, y0 + 1) * tx * ty
  );
}

// Local east-north metres about an origin, flat over a ride's extent.
function enu(origin, lng, lat) {
  const k = Math.cos((origin[1] * Math.PI) / 180);
  return [(((lng - origin[0]) * Math.PI) / 180) * R * k, (((lat - origin[1]) * Math.PI) / 180) * R];
}
function lngLat(origin, e, n) {
  const k = Math.cos((origin[1] * Math.PI) / 180);
  return [origin[0] + ((e / (R * k)) * 180) / Math.PI, origin[1] + ((n / R) * 180) / Math.PI];
}

// The camera the renderer builds: the centre sits on the terrain, and the eye
// is half the viewport height over tan(fov / 2) pixels back along the view.
function placeCamera(cam) {
  const [clng, clat] = cam.center;
  const mpp = (2 * Math.PI * R * Math.cos((clat * Math.PI) / 180)) / (512 * 2 ** cam.zoom);
  const dist = ((0.5 * VIEW_H) / Math.tan(FOV / 2)) * mpp;
  const b = (cam.bearing * Math.PI) / 180;
  const p = (cam.pitch * Math.PI) / 180;
  const f = [Math.sin(b) * Math.sin(p), Math.cos(b) * Math.sin(p), -Math.cos(p)];
  const r = [Math.cos(b), -Math.sin(b), 0];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { clng, clat, dist, f, r, u, mpp };
}

function cameraFor(base, bearing, coords) {
  // The production rule: centre on the bounds, shifted 8% of the span toward the eye.
  let minLng = Infinity,
    maxLng = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const br = (bearing * Math.PI) / 180;
  return {
    ...base,
    bearing,
    center: [
      (minLng + maxLng) / 2 - Math.sin(br) * (maxLng - minLng) * 0.08,
      (minLat + maxLat) / 2 - Math.cos(br) * (maxLat - minLat) * 0.08,
    ],
  };
}

async function measure(cam, coords) {
  const z = Math.max(9, Math.min(13, Math.floor(cam.zoom) + 1));
  const g = placeCamera(cam);
  const origin = [g.clng, g.clat];
  const step = Math.max(1, Math.floor(coords.length / ROUTE_SAMPLES));
  const pts = coords.filter((_, i) => i % step === 0);
  const eye2 = [
    -g.f[0] / Math.sin((cam.pitch * Math.PI) / 180),
    -g.f[1] / Math.sin((cam.pitch * Math.PI) / 180),
  ];
  const back = g.dist * Math.sin((cam.pitch * Math.PI) / 180);
  const eyeLL = lngLat(origin, eye2[0] * back, eye2[1] * back);
  await preload(z, [origin, eyeLL]);
  const ground = [];
  for (const [lng, lat] of pts) {
    for (let s = 0; s <= 8; s++) {
      const t = s / 8;
      ground.push([eyeLL[0] + (lng - eyeLL[0]) * t, eyeLL[1] + (lat - eyeLL[1]) * t]);
    }
  }
  await preload(z, ground);
  const centreH = heightAt(z, g.clng, g.clat) * EXAGGERATION;
  const eye = [-g.f[0] * g.dist, -g.f[1] * g.dist, centreH - g.f[2] * g.dist];
  const tanV = Math.tan(FOV / 2);
  const tanH = tanV * (VIEW_W / VIEW_H);
  let hidden = 0,
    outside = 0,
    visible = 0;
  for (const [lng, lat] of pts) {
    const [e, n] = enu(origin, lng, lat);
    const h = heightAt(z, lng, lat) * EXAGGERATION;
    const v = [e - eye[0], n - eye[1], h - eye[2]];
    const depth = v[0] * g.f[0] + v[1] * g.f[1] + v[2] * g.f[2];
    const x = v[0] * g.r[0] + v[1] * g.r[1];
    const y = v[0] * g.u[0] + v[1] * g.u[1] + v[2] * g.u[2];
    if (depth <= 0 || Math.abs(x / depth) > tanH || Math.abs(y / depth) > tanV) {
      outside++;
      continue;
    }
    let blocked = false;
    for (let s = 1; s < RAY_STEPS - 1 && !blocked; s++) {
      const t = s / RAY_STEPS;
      const pe = eye[0] + v[0] * t,
        pn = eye[1] + v[1] * t,
        pz = eye[2] + v[2] * t;
      const [slng, slat] = lngLat(origin, pe, pn);
      const th = heightAt(z, slng, slat) * EXAGGERATION;
      if (th > pz + CLEARANCE_M * EXAGGERATION) blocked = true;
    }
    if (blocked) hidden++;
    else visible++;
  }
  const n = pts.length;
  let demMin = Infinity,
    demMax = -Infinity;
  for (const [lng, lat] of pts) {
    const h = heightAt(z, lng, lat);
    if (h < demMin) demMin = h;
    if (h > demMax) demMax = h;
  }
  return {
    hidden: hidden / n,
    outside: outside / n,
    visible: visible / n,
    z,
    demRange: demMax - demMin,
  };
}

// What the app could score before rendering, holding no DEM: the route's own
// altitude stands in for the terrain, each ray sample taking the highest route
// point within NEAR_M of it.
const NEAR_M = 150;
function selfHidden(cam, coords, altitude) {
  const g = placeCamera(cam);
  const origin = [g.clng, g.clat];
  const cell = NEAR_M;
  const grid = new Map();
  const local = [];
  let altSum = 0,
    altN = 0;
  coords.forEach(([lng, lat], i) => {
    const a = altitude[i];
    if (!isFinite(a)) return;
    const [e, n] = enu(origin, lng, lat);
    local.push([e, n, a * EXAGGERATION]);
    altSum += a;
    altN++;
    const key = `${Math.floor(e / cell)},${Math.floor(n / cell)}`;
    const prev = grid.get(key);
    if (prev === undefined || prev < a * EXAGGERATION) grid.set(key, a * EXAGGERATION);
  });
  if (local.length < 2) return 0;
  const near = (e, n) => {
    const cx = Math.floor(e / cell),
      cy = Math.floor(n / cell);
    let best = -Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const h = grid.get(`${cx + dx},${cy + dy}`);
        if (h !== undefined && h > best) best = h;
      }
    return best;
  };
  const centreH = (altSum / altN) * EXAGGERATION;
  const eye = [-g.f[0] * g.dist, -g.f[1] * g.dist, centreH - g.f[2] * g.dist];
  const step = Math.max(1, Math.floor(local.length / ROUTE_SAMPLES));
  let hidden = 0,
    n = 0;
  for (let i = 0; i < local.length; i += step) {
    const [e, nn, h] = local[i];
    n++;
    const v = [e - eye[0], nn - eye[1], h - eye[2]];
    for (let s = 1; s < RAY_STEPS - 4; s++) {
      const t = s / RAY_STEPS;
      if (
        near(eye[0] + v[0] * t, eye[1] + v[1] * t) >
        eye[2] + v[2] * t + CLEARANCE_M * EXAGGERATION
      ) {
        hidden++;
        break;
      }
    }
  }
  return hidden / n;
}

const pct = (x) => (100 * x).toFixed(1);

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const list = await api(
    `/athlete/${env.EXPO_PUBLIC_ATHLETE_ID}/activities?oldest=1900-01-01&newest=${today}`
  );
  const rides = list.filter((a) => SPORTS.has(a.type) && (a.stream_types ?? []).includes('latlng'));
  const rows = [];
  for (const a of rides) {
    const parsed = parse(await streamsFor(a.id));
    if (!parsed || parsed.coords.length < 2) continue;
    const result = calculateTerrainCamera(parsed.coords, parsed.altitude);
    if (!result.hasInterestingTerrain) continue;
    const base = result.camera;
    const variants = {};
    for (const [name, delta] of [
      ['prod', 0],
      ['flip', 180],
      ['left', 90],
      ['right', 270],
    ]) {
      const cam = delta === 0 ? base : cameraFor(base, (base.bearing + delta) % 360, parsed.coords);
      variants[name] = await measure(cam, parsed.coords);
      variants[name].self = selfHidden(cam, parsed.coords, parsed.altitude);
    }
    // Keep the production bearing unless another scores clearly better on the route alone.
    let pick = 'prod';
    for (const name of ['flip', 'left', 'right']) {
      if (variants[name].self < variants[pick].self - 0.02) pick = name;
    }
    variants.picked = { ...variants[pick], name: pick };
    for (const pitch of [45, 40]) {
      variants[`p${pitch}`] = await measure(
        { ...base, pitch: Math.min(base.pitch, pitch) },
        parsed.coords
      );
    }
    rows.push({
      id: a.id,
      type: a.type,
      range: result.elevationRange,
      pitch: base.pitch,
      zoom: base.zoom,
      ...variants,
    });
    process.stderr.write(
      `${a.id} range ${result.elevationRange.toFixed(0)} hidden ${pct(variants.prod.hidden)}% out ${pct(variants.prod.outside)}%\n`
    );
  }
  writeFileSync(
    join(cacheDir, `results-${[...SPORTS].join('-')}.json`),
    JSON.stringify(rows, null, 1)
  );

  const summarise = (key) => {
    const hidden = rows.map((r) => r[key].hidden).sort((a, b) => a - b);
    const outside = rows.map((r) => r[key].outside).sort((a, b) => a - b);
    const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
    const over = (xs, t) => xs.filter((x) => x > t).length;
    return `${key.padEnd(6)} hidden median ${pct(q(hidden, 0.5))}% p90 ${pct(q(hidden, 0.9))}% max ${pct(hidden.at(-1))}%, rides >5% ${over(hidden, 0.05)}, >10% ${over(hidden, 0.1)}, >25% ${over(hidden, 0.25)} | outside frame median ${pct(q(outside, 0.5))}% p90 ${pct(q(outside, 0.9))}%, rides >5% ${over(outside, 0.05)}`;
  };
  console.log(`rides measured: ${rows.length}`);
  for (const key of ['prod', 'flip', 'left', 'right', 'p45', 'p40', 'picked'])
    console.log(summarise(key));
  console.log(
    `picker moved off the production bearing on ${rows.filter((r) => r.picked.name !== 'prod').length} rides`
  );
  const best = rows.map((r) =>
    Math.min(r.prod.hidden, r.flip.hidden, r.left.hidden, r.right.hidden)
  );
  console.log(
    `best of four bearings: rides >5% ${best.filter((x) => x > 0.05).length}, >10% ${best.filter((x) => x > 0.1).length}`
  );
  for (const band of [
    [30, 100, 62],
    [100, 400, 58],
    [400, Infinity, 52],
  ]) {
    const inBand = rows.filter((r) => r.range >= band[0] && r.range < band[1]);
    const bad = inBand.filter((r) => r.prod.hidden > 0.05).length;
    console.log(
      `pitch ${band[2]} (range ${band[0]}-${band[1]} m): ${inBand.length} rides, ${bad} hide >5%`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
