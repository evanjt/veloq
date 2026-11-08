#!/usr/bin/env node
// How much of the feed card's picture a ride's route fills under the snapshot
// camera, and how much it would fill under a camera fitted to the card's
// frame at the same bearing and pitch.
//
// Reads the account in the root `.env`, takes the production camera from
// `calculateTerrainCamera` (or `calculateFlatCamera` with FLAT=1), places it
// the way the bundled renderer does for the snapshot viewport and projects
// the route into the frame. The fit is worked out on flat ground, which is
// all a pure function can know, and then measured against the terrarium DEM
// at the drape's exaggeration, so the error terrain adds is in the numbers.
//
//   VIEW_W=360 INSET=12 node scripts/measure-terrain-fill.mjs [cacheDir]
//
// Streams and DEM tiles are cached under cacheDir, never in the repository.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  calculateTerrainCamera,
  calculateFlatCamera,
} from '../src/features/maps/lib/cameraAngle.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = process.argv[2] ?? '/tmp/terrain-fill-cache';
mkdirSync(join(cacheDir, 'streams'), { recursive: true });
mkdirSync(join(cacheDir, 'dem'), { recursive: true });

const SPORTS = new Set((process.env.SPORTS ?? 'Ride,GravelRide,VirtualRide').split(','));
const FLAT = process.env.FLAT === '1';
const EXAGGERATION = 1.5;
const VIEW_W = Number(process.env.VIEW_W ?? 360);
const VIEW_H = 240;
const INSET = Number(process.env.INSET ?? 12);
const FOV = (36.87 * Math.PI) / 180;
const ROUTE_SAMPLES = 400;
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
  const fx = px - 0.5,
    fy = py - 0.5;
  const x0 = Math.floor(fx),
    y0 = Math.floor(fy);
  const sample = (x, y) => {
    const t = tiles.get(`${z}/${Math.floor(x / 256)}/${Math.floor(y / 256)}`);
    if (!t) return 0;
    return t[(((y % 256) + 256) % 256) * 256 + (((x % 256) + 256) % 256)];
  };
  const tx = fx - x0,
    ty = fy - y0;
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

// The renderer's camera: the centre under the middle of the frame, the eye half
// the frame height over tan(fov / 2) pixels back along the view.
function placeCamera(cam, centreHeight) {
  const [clng, clat] = cam.center;
  const mpp = (2 * Math.PI * R * Math.cos((clat * Math.PI) / 180)) / (512 * 2 ** cam.zoom);
  const focal = (0.5 * VIEW_H) / Math.tan(FOV / 2);
  const dist = focal * mpp;
  const b = (cam.bearing * Math.PI) / 180;
  const p = (cam.pitch * Math.PI) / 180;
  const f = [Math.sin(b) * Math.sin(p), Math.cos(b) * Math.sin(p), -Math.cos(p)];
  const r = [Math.cos(b), -Math.sin(b), 0];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const eye = [-f[0] * dist, -f[1] * dist, centreHeight - f[2] * dist];
  return { origin: [clng, clat], eye, f, r, u, focal, mpp };
}

// Screen pixels of a point given in metres about the camera's origin.
function project(g, e, n, h) {
  const v = [e - g.eye[0], n - g.eye[1], h - g.eye[2]];
  const depth = v[0] * g.f[0] + v[1] * g.f[1] + v[2] * g.f[2];
  if (depth <= 0) return null;
  const x = v[0] * g.r[0] + v[1] * g.r[1];
  const y = v[0] * g.u[0] + v[1] * g.u[1] + v[2] * g.u[2];
  return [VIEW_W / 2 + (x / depth) * g.focal, VIEW_H / 2 - (y / depth) * g.focal];
}

// The ground point under a pixel, on the plane at the centre's height.
function unproject(g, sx, sy, centreHeight) {
  const dx = (sx - VIEW_W / 2) / g.focal;
  const dy = -(sy - VIEW_H / 2) / g.focal;
  const dir = [0, 1, 2].map((i) => g.f[i] + g.r[i] * dx + g.u[i] * dy);
  if (dir[2] >= 0) return null;
  const t = (centreHeight - g.eye[2]) / dir[2];
  return lngLat(g.origin, g.eye[0] + dir[0] * t, g.eye[1] + dir[1] * t);
}

function frameOf(cam, pts, heights, centreHeight) {
  const g = placeCamera(cam, centreHeight);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    behind = 0,
    outside = 0;
  pts.forEach(([lng, lat], i) => {
    const [e, n] = enu(g.origin, lng, lat);
    const s = project(g, e, n, heights ? heights[i] : centreHeight);
    if (!s) {
      behind++;
      return;
    }
    if (s[0] < 0 || s[0] > VIEW_W || s[1] < 0 || s[1] > VIEW_H) outside++;
    minX = Math.min(minX, s[0]);
    maxX = Math.max(maxX, s[0]);
    minY = Math.min(minY, s[1]);
    maxY = Math.max(maxY, s[1]);
  });
  return {
    w: (maxX - minX) / VIEW_W,
    h: (maxY - minY) / VIEW_H,
    minX,
    maxX,
    minY,
    maxY,
    outside: (outside + behind) / pts.length,
    g,
  };
}

// Fit the camera to the frame less the inset at its bearing and pitch, on
// flat ground: recentre on the ground under the route's frame middle, then
// scale the zoom by the tighter axis, until both settle.
function fitToFrame(cam, pts, inset) {
  let fitted = { ...cam, center: [...cam.center] };
  for (let i = 0; i < 12; i++) {
    const fr = frameOf(fitted, pts, null, 0);
    const mid = unproject(fr.g, (fr.minX + fr.maxX) / 2, (fr.minY + fr.maxY) / 2, 0);
    if (mid) fitted = { ...fitted, center: mid };
    const fr2 = frameOf(fitted, pts, null, 0);
    const s = Math.min(
      (VIEW_W - 2 * inset) / (fr2.maxX - fr2.minX),
      (VIEW_H - 2 * inset) / (fr2.maxY - fr2.minY)
    );
    fitted = { ...fitted, zoom: fitted.zoom + Math.log2(s) };
    if (Math.abs(Math.log2(s)) < 0.002) break;
  }
  return fitted;
}

// The same fit with a height per point and a centre height, as the renderer
// will place them. Flat ground is heights null and centre 0.
function fitToFrameAt(cam, pts, heights, centreHeight, inset) {
  let fitted = { ...cam, center: [...cam.center] };
  for (let i = 0; i < 12; i++) {
    const fr = frameOf(fitted, pts, heights, centreHeight);
    const mid = unproject(fr.g, (fr.minX + fr.maxX) / 2, (fr.minY + fr.maxY) / 2, centreHeight);
    if (mid) fitted = { ...fitted, center: mid };
    const fr2 = frameOf(fitted, pts, heights, centreHeight);
    const s = Math.min(
      (VIEW_W - 2 * inset) / (fr2.maxX - fr2.minX),
      (VIEW_H - 2 * inset) / (fr2.maxY - fr2.minY)
    );
    fitted = { ...fitted, zoom: fitted.zoom + Math.log2(s) };
    if (Math.abs(Math.log2(s)) < 0.002) break;
  }
  return fitted;
}

// The altitude gradient in metres (east, north), the production rule with the
// longitude scaled by cos(latitude).
function gradientOf(coords, altitude) {
  let sum = 0,
    n = 0;
  for (const a of altitude)
    if (isFinite(a)) {
      sum += a;
      n++;
    }
  const mean = sum / n;
  let clng = 0,
    clat = 0;
  for (const [lng, lat] of coords) {
    clng += lng;
    clat += lat;
  }
  const origin = [clng / coords.length, clat / coords.length];
  let ge = 0,
    gn = 0;
  coords.forEach(([lng, lat], i) => {
    if (!isFinite(altitude[i])) return;
    const [e, nn] = enu(origin, lng, lat);
    ge += e * (altitude[i] - mean);
    gn += nn * (altitude[i] - mean);
  });
  return [ge, gn];
}

// The bearing across the route's long axis, on the side that looks toward the
// high ground, from the principal axis of the points.
function acrossBearing(coords, altitude) {
  let clng = 0,
    clat = 0;
  for (const [lng, lat] of coords) {
    clng += lng;
    clat += lat;
  }
  const origin = [clng / coords.length, clat / coords.length];
  let see = 0,
    snn = 0,
    sen = 0;
  for (const [lng, lat] of coords) {
    const [e, n] = enu(origin, lng, lat);
    see += e * e;
    snn += n * n;
    sen += e * n;
  }
  const theta = 0.5 * Math.atan2(2 * sen, see - snn); // major axis angle from east
  const axisBearing = (90 - (theta * 180) / Math.PI + 360) % 360;
  const [ge, gn] = gradientOf(coords, altitude);
  const options = [(axisBearing + 90) % 360, (axisBearing + 270) % 360];
  const toward = (b) => Math.sin((b * Math.PI) / 180) * ge + Math.cos((b * Math.PI) / 180) * gn;
  return toward(options[0]) >= toward(options[1]) ? options[0] : options[1];
}

// The share of sampled points the terrain hides from the camera's eye, the
// ray walked from the eye to each point against the exaggerated DEM.
const RAY_STEPS = 96,
  CLEARANCE_M = 2;
async function hiddenOf(cam, pts, heights, z) {
  const centreHeight = heightAt(z, cam.center[0], cam.center[1]) * EXAGGERATION;
  const g = placeCamera(cam, centreHeight);
  const eyeLL = lngLat(g.origin, g.eye[0], g.eye[1]);
  const ground = [];
  for (const [lng, lat] of pts)
    for (let s = 0; s <= 8; s++) {
      const t = s / 8;
      ground.push([eyeLL[0] + (lng - eyeLL[0]) * t, eyeLL[1] + (lat - eyeLL[1]) * t]);
    }
  await preload(z, ground);
  let hidden = 0;
  pts.forEach(([lng, lat], i) => {
    const [e, n] = enu(g.origin, lng, lat);
    const v = [e - g.eye[0], n - g.eye[1], heights[i] - g.eye[2]];
    for (let s = 1; s < RAY_STEPS - 1; s++) {
      const t = s / RAY_STEPS;
      const [slng, slat] = lngLat(g.origin, g.eye[0] + v[0] * t, g.eye[1] + v[1] * t);
      if (
        heightAt(z, slng, slat) * EXAGGERATION >
        g.eye[2] + v[2] * t + CLEARANCE_M * EXAGGERATION
      ) {
        hidden++;
        break;
      }
    }
  });
  return hidden / pts.length;
}

function cornersOf(pts) {
  let a = Infinity,
    b = -Infinity,
    c = Infinity,
    d = -Infinity;
  for (const [lng, lat] of pts) {
    a = Math.min(a, lng);
    b = Math.max(b, lng);
    c = Math.min(c, lat);
    d = Math.max(d, lat);
  }
  return [
    [a, c],
    [a, d],
    [b, c],
    [b, d],
  ];
}
const pct = (x) => (100 * x).toFixed(0);

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const list = await api(
    `/athlete/${env.EXPO_PUBLIC_ATHLETE_ID}/activities?oldest=1900-01-01&newest=${today}`
  );
  const rides = list.filter((a) => SPORTS.has(a.type) && (a.stream_types ?? []).includes('latlng'));
  const rows = [];
  let fitMicros = 0;
  for (const a of rides) {
    const parsed = parse(await streamsFor(a.id));
    if (!parsed || parsed.coords.length < 2) continue;
    let cam;
    let range = NaN;
    if (FLAT) {
      cam = calculateFlatCamera(parsed.coords);
    } else {
      const result = calculateTerrainCamera(parsed.coords, parsed.altitude);
      if (!result.hasInterestingTerrain) continue;
      cam = result.camera;
      range = result.elevationRange;
    }
    const step = Math.max(1, Math.floor(parsed.coords.length / ROUTE_SAMPLES));
    const pts = parsed.coords.filter((_, i) => i % step === 0);
    const z = Math.max(9, Math.min(13, Math.floor(cam.zoom) + 1));
    await preload(z, [cam.center, ...pts]);
    const heights = pts.map(([lng, lat]) => heightAt(z, lng, lat) * EXAGGERATION);
    const centreH = (c) => heightAt(z, c[0], c[1]) * EXAGGERATION;

    const altSample = parsed.altitude.filter((_, i) => i % step === 0);
    let altSum = 0,
      altN = 0;
    for (const a of altSample)
      if (isFinite(a)) {
        altSum += a;
        altN++;
      }
    const altMean = altN ? altSum / altN : 0;
    // What a pure function knows: the route's own altitude about its mean, exaggerated.
    const ownHeights = altSample.map((a) => (isFinite(a) ? (a - altMean) * EXAGGERATION : 0));

    const score = async (name, c) => {
      const dem = frameOf(c, pts, heights, centreH(c.center));
      const hidden = await hiddenOf(c, pts, heights, z);
      return {
        name,
        w: dem.w,
        h: dem.h,
        area: dem.w * dem.h,
        outside: dem.outside,
        hidden,
        zoom: c.zoom,
        bearing: c.bearing,
        pitch: c.pitch,
      };
    };
    const t0 = process.hrtime.bigint();
    const fitGround = fitToFrame(cam, pts, INSET);
    const fitOwn = fitToFrameAt(cam, pts, ownHeights, 0, INSET);
    fitMicros += Number(process.hrtime.bigint() - t0) / 1000 / 2;
    const across = FLAT ? 0 : acrossBearing(pts, altSample);
    const fitAcross = fitToFrameAt({ ...cam, bearing: across }, pts, ownHeights, 0, INSET);
    const turned = [90, 180, 270].map((d) =>
      fitToFrameAt({ ...cam, bearing: (cam.bearing + d) % 360 }, pts, ownHeights, 0, INSET)
    );
    const turnedScores = [];
    for (const t of turned) turnedScores.push(await score('turn', t));
    let bestTurn = await score('fitProdOwn', fitOwn);
    for (const t of turnedScores) if (t.area > bestTurn.area) bestTurn = t;
    const acrossTurned90 = { ...fitAcross, bearing: (fitAcross.bearing + 90) % 360 };
    const row = {
      id: a.id,
      type: a.type,
      range,
      pitch: cam.pitch,
      zoom: cam.zoom,
      prod: await score('prod', cam),
      // What the card draws while its preview line carries no altitude: the fallback bearing at pitch 60.
      cardToday: await score(
        'cardToday',
        FLAT ? cam : calculateTerrainCamera(parsed.coords, undefined).camera
      ),
      cardTodayFit: await score(
        'cardTodayFit',
        FLAT
          ? fitGround
          : fitToFrameAt(
              calculateTerrainCamera(parsed.coords, undefined).camera,
              pts,
              ownHeights,
              0,
              INSET
            )
      ),
      fitGround: await score('fitGround', fitGround),
      // The same fit from the four corners of the route's bounds, as a bounds-only fit would see it.
      fitCorners: await score('fitCorners', fitToFrame(cam, cornersOf(pts), INSET)),
      fitOwn: await score('fitOwn', fitOwn),
      fitAcross: await score('fitAcross', fitAcross),
      bestArea: { ...bestTurn, name: 'bestArea' },
      acrossTurned90: await score('acrossTurned90', acrossTurned90),
    };
    rows.push(row);
    process.stderr.write(
      `${a.id} pitch ${cam.pitch} prod ${pct(row.prod.w)}x${pct(row.prod.h)}% hid ${pct(row.prod.hidden)} | fitOwn ${pct(row.fitOwn.w)}x${pct(row.fitOwn.h)}% off ${pct(row.fitOwn.outside)} hid ${pct(row.fitOwn.hidden)} | across ${pct(row.fitAcross.w)}x${pct(row.fitAcross.h)}% off ${pct(row.fitAcross.outside)} hid ${pct(row.fitAcross.hidden)} z+${(row.fitAcross.zoom - cam.zoom).toFixed(2)}\n`
    );
  }
  writeFileSync(
    join(cacheDir, `fill-${FLAT ? 'flat' : '3d'}-${VIEW_W}.json`),
    JSON.stringify(rows, null, 1)
  );
  const q = (xs, p) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  const summarise = (key) => {
    const w = rows.map((r) => r[key].w),
      h = rows.map((r) => r[key].h);
    const area = rows.map((r) => r[key].area),
      out = rows.map((r) => r[key].outside);
    const hid = rows.map((r) => r[key].hidden);
    const longest = rows.map((r) => Math.max(r[key].w, r[key].h));
    console.log(
      `${key.padEnd(15)} width med ${pct(q(w, 0.5))}% p10 ${pct(q(w, 0.1))}% | height med ${pct(q(h, 0.5))}% p10 ${pct(q(h, 0.1))}% | longer axis med ${pct(q(longest, 0.5))}% min ${pct(q(longest, 0))}% | box area med ${pct(q(area, 0.5))}% p10 ${pct(q(area, 0.1))}% | off frame: rides any ${out.filter((x) => x > 0).length}, >2% ${out.filter((x) => x > 0.02).length}, worst ${pct(q(out, 1))}% | hidden: rides >5% ${hid.filter((x) => x > 0.05).length}, >10% ${hid.filter((x) => x > 0.1).length}, worst ${pct(q(hid, 1))}%`
    );
  };
  console.log(
    `rides measured: ${rows.length} (${FLAT ? 'flat' : '3D'} camera, frame ${VIEW_W}x${VIEW_H}, inset ${INSET})`
  );
  for (const key of [
    'cardToday',
    'cardTodayFit',
    'prod',
    'fitGround',
    'fitCorners',
    'fitOwn',
    'fitAcross',
    'bestArea',
    'acrossTurned90',
  ])
    summarise(key);
  const dz = rows.map((r) => r.fitOwn.zoom - r.zoom);
  console.log(
    `fitted zoom minus production (own bearing): median +${q(dz, 0.5).toFixed(2)} p10 +${q(dz, 0.1).toFixed(2)} p90 +${q(dz, 0.9).toFixed(2)}`
  );
  const dza = rows.map((r) => r.fitAcross.zoom - r.zoom);
  console.log(
    `fitted zoom minus production (across bearing): median +${q(dza, 0.5).toFixed(2)} p10 +${q(dza, 0.1).toFixed(2)} p90 +${q(dza, 0.9).toFixed(2)}`
  );
  console.log(
    `fit cost: ${(fitMicros / rows.length).toFixed(0)} us per fit on ${ROUTE_SAMPLES} points, this machine`
  );
  if (!FLAT) {
    for (const band of [
      [30, 100, 62],
      [100, 400, 58],
      [400, Infinity, 52],
    ]) {
      const inBand = rows.filter((r) => r.range >= band[0] && r.range < band[1]);
      if (!inBand.length) continue;
      console.log(
        `pitch ${band[2]}: ${inBand.length} rides | off-frame rides, fitGround ${inBand.filter((r) => r.fitGround.outside > 0).length}, fitOwn ${inBand.filter((r) => r.fitOwn.outside > 0).length}, fitAcross ${inBand.filter((r) => r.fitAcross.outside > 0).length} | across hidden >5%: ${inBand.filter((r) => r.fitAcross.hidden > 0.05).length}`
      );
    }
    const worse = rows.filter((r) => r.fitAcross.hidden > 0.05 && r.prod.hidden <= 0.05);
    console.log(
      `across bearing newly hides >5% on ${worse.length} rides: ${worse.map((r) => `${r.id} ${pct(r.fitAcross.hidden)}%`).join(', ')}`
    );
    const better = rows.filter((r) => r.fitAcross.hidden <= 0.05 && r.prod.hidden > 0.05);
    console.log(`across bearing clears >5% on ${better.length} rides that production hid`);
  }
}

// SELFTEST=1 projects a 10 km square at latitude 46 instead of the account's rides.
if (process.env.SELFTEST) {
  const lat0 = 46,
    lng0 = 7;
  const dLat = 10000 / 111320,
    dLng = 10000 / (111320 * Math.cos((lat0 * Math.PI) / 180));
  const coords = [],
    alt = [];
  for (let i = 0; i <= 400; i++) {
    const t = i / 400;
    let x, y;
    if (t < 0.25) {
      x = t * 4;
      y = 0;
    } else if (t < 0.5) {
      x = 1;
      y = (t - 0.25) * 4;
    } else if (t < 0.75) {
      x = 1 - (t - 0.5) * 4;
      y = 1;
    } else {
      x = 0;
      y = 1 - (t - 0.75) * 4;
    }
    coords.push([lng0 + x * dLng, lat0 + y * dLat]);
    alt.push(400 + y * 200);
  }
  const cam = calculateTerrainCamera(coords, alt).camera;
  for (const pitch of [0, 58]) {
    const fr = frameOf({ ...cam, pitch }, coords, null, 0);
    console.log(
      `pitch ${pitch}: x ${fr.minX.toFixed(0)}..${fr.maxX.toFixed(0)} y ${fr.minY.toFixed(0)}..${fr.maxY.toFixed(0)} fill ${pct(fr.w)}x${pct(fr.h)}%`
    );
  }
  const fitted = fitToFrame(cam, coords, INSET);
  const fr = frameOf(fitted, coords, null, 0);
  console.log(
    `fitted zoom ${fitted.zoom.toFixed(2)} (from ${cam.zoom.toFixed(2)}): x ${fr.minX.toFixed(0)}..${fr.maxX.toFixed(0)} y ${fr.minY.toFixed(0)}..${fr.maxY.toFixed(0)}`
  );
} else {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
