#!/usr/bin/env node
/**
 * Derive muscle hit-test polygons from react-native-body-highlighter's own SVG paths.
 *
 * The app renders the body from that package, so hit regions must come from the same
 * geometry or taps drift off the drawing. Run with --check in CI to fail when the
 * package changes shape.
 *
 *   node scripts/generate-muscle-polygons.mjs          # write
 *   node scripts/generate-muscle-polygons.mjs --check  # verify committed output
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src/features/strength/lib/polygons');

// Two halves of one 1448-wide sheet: front at the origin, back offset by one width.
const VIEW_W = 724;
const VIEW_H = 1448;
const DP = 4;
// Chord tolerance in normalised units. The diagram draws at ~200x400px, so this is
// well under half a pixel.
const TOLERANCE = 0.0015;

// Muscles the app can attribute work to. The package also ships head, hair, hands,
// feet, ankles, knees, neck and tibialis, which are drawn but never tappable.
const MUSCLE_SLUGS = new Set([
  'abs', 'adductors', 'biceps', 'calves', 'chest', 'deltoids', 'forearm', 'gluteal',
  'hamstring', 'lower-back', 'obliques', 'quadriceps', 'trapezius', 'triceps', 'upper-back',
]);

// ---------------------------------------------------------------- path parsing

const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/**
 * Scan a `d` string into [command, ...numbers] tokens.
 *
 * Arc flags may be written unseparated, so `a5 5 0 0114 0` packs laf=0, sf=1, x=14.
 * A plain number-first scan reads that as 114 and bends the arc into the next suburb,
 * so arc arguments 4 and 5 are consumed one character at a time.
 */
function tokenise(d) {
  const out = [];
  const num = /-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/y;
  const sep = /[\s,]*/y;
  let i = 0;
  let cmd = null;
  const eatSep = () => { sep.lastIndex = i; sep.exec(d); i = sep.lastIndex; };
  const eatNum = () => {
    eatSep();
    num.lastIndex = i;
    const m = num.exec(d);
    if (!m) return null;
    i = num.lastIndex;
    return parseFloat(m[0]);
  };

  while (i < d.length) {
    eatSep();
    if (i >= d.length) break;
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(d[i])) {
      cmd = d[i];
      i += 1;
      out.push(cmd);
      if (cmd === 'Z' || cmd === 'z') { cmd = null; continue; }
    } else if (cmd === null) {
      i += 1;
      continue;
    } else {
      // An implicit repeat of the previous command. M repeats as L.
      const rep = cmd === 'M' ? 'L' : cmd === 'm' ? 'l' : cmd;
      out.push(rep);
      cmd = rep;
    }
    const up = cmd.toUpperCase();
    for (let k = 0; k < ARITY[up]; k += 1) {
      if (up === 'A' && (k === 3 || k === 4)) {
        eatSep();
        out.push(Number(d[i]));
        i += 1;
      } else {
        const v = eatNum();
        if (v === null) break;
        out.push(v);
      }
    }
  }
  return out;
}

/** Split a `d` string into subpaths of absolute drawing commands. */
function parsePath(d) {
  const t = tokenise(d);
  const subpaths = [];
  let cur = null;
  let cmd = null;
  let x = 0, y = 0, sx = 0, sy = 0;
  let px = 0, py = 0; // previous control point, for S/T
  let i = 0;

  const push = (c) => {
    if (!cur) cur = { start: [x, y], cmds: [] };
    cur.cmds.push(c);
  };

  while (i < t.length) {
    if (typeof t[i] === 'string') {
      cmd = t[i];
      i += 1;
      if (cmd === 'Z' || cmd === 'z') {
        if (cur) { cur.closed = true; subpaths.push(cur); cur = null; }
        x = sx; y = sy;
        continue;
      }
    }
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    const n = ARITY[up];
    const a = t.slice(i, i + n);
    i += n;

    if (up === 'M') {
      if (cur) { subpaths.push(cur); cur = null; }
      x = rel ? x + a[0] : a[0];
      y = rel ? y + a[1] : a[1];
      sx = x; sy = y;
      cur = { start: [x, y], cmds: [] };
      // A repeated M parameter pair is an implicit L.
      cmd = rel ? 'l' : 'L';
      px = x; py = y;
      continue;
    }

    if (up === 'L' || up === 'H' || up === 'V') {
      const nx = up === 'V' ? x : rel ? x + a[0] : a[0];
      const ny = up === 'H' ? y : rel ? y + (up === 'V' ? a[0] : a[1]) : up === 'V' ? a[0] : a[1];
      push({ t: 'L', p: [nx, ny] });
      x = nx; y = ny; px = x; py = y;
      continue;
    }

    if (up === 'C' || up === 'S') {
      let c1x, c1y, c2x, c2y, nx, ny;
      if (up === 'C') {
        [c1x, c1y, c2x, c2y, nx, ny] = rel
          ? [x + a[0], y + a[1], x + a[2], y + a[3], x + a[4], y + a[5]]
          : a;
      } else {
        c1x = 2 * x - px; c1y = 2 * y - py;
        [c2x, c2y, nx, ny] = rel ? [x + a[0], y + a[1], x + a[2], y + a[3]] : a;
      }
      push({ t: 'C', p: [c1x, c1y, c2x, c2y, nx, ny] });
      px = c2x; py = c2y; x = nx; y = ny;
      continue;
    }

    if (up === 'Q' || up === 'T') {
      let cx, cy, nx, ny;
      if (up === 'Q') {
        [cx, cy, nx, ny] = rel ? [x + a[0], y + a[1], x + a[2], y + a[3]] : a;
      } else {
        cx = 2 * x - px; cy = 2 * y - py;
        [nx, ny] = rel ? [x + a[0], y + a[1]] : a;
      }
      push({ t: 'Q', p: [cx, cy, nx, ny] });
      px = cx; py = cy; x = nx; y = ny;
      continue;
    }

    if (up === 'A') {
      const [rx, ry, rot, laf, sf] = a;
      const nx = rel ? x + a[5] : a[5];
      const ny = rel ? y + a[6] : a[6];
      push({ t: 'A', p: [rx, ry, rot, laf, sf, nx, ny], from: [x, y] });
      x = nx; y = ny; px = x; py = y;
      continue;
    }
  }
  if (cur) subpaths.push(cur);
  return subpaths;
}

// ---------------------------------------------------------------- flattening

const lerp = (a, b, t) => a + (b - a) * t;

function cubicAt(x0, y0, p, t) {
  const [c1x, c1y, c2x, c2y, x1, y1] = p;
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * x0 + b * c1x + c * c2x + d * x1, a * y0 + b * c1y + c * c2y + d * y1];
}

function quadAt(x0, y0, p, t) {
  const [cx, cy, x1, y1] = p;
  const u = 1 - t;
  return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
}

/** Endpoint parameterisation to centre form, per the SVG implementation notes. */
function arcAt(x0, y0, p, t) {
  let [rx, ry, rotDeg, laf, sf, x1, y1] = p;
  if (rx === 0 || ry === 0) return [lerp(x0, x1, t), lerp(y0, y1, t)];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const rot = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const dx2 = (x0 - x1) / 2, dy2 = (y0 - y1) / 2;
  const x1p = cos * dx2 + sin * dy2;
  const y1p = -sin * dx2 + cos * dy2;

  // Scale radii up if they cannot span the endpoints.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }

  const sign = laf === sf ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x0 + x1) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y1) / 2;

  const ang = (ux, uy, vx, vy) => {
    const d = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let c = (ux * vx + uy * vy) / d;
    c = Math.min(1, Math.max(-1, c));
    const a = Math.acos(c);
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const theta = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (sf === 0 && delta > 0) delta -= 2 * Math.PI;
  if (sf === 1 && delta < 0) delta += 2 * Math.PI;

  const a = theta + delta * t;
  return [
    cos * rx * Math.cos(a) - sin * ry * Math.sin(a) + cx,
    sin * rx * Math.cos(a) + cos * ry * Math.sin(a) + cy,
  ];
}

function sampler(c, x0, y0) {
  if (c.t === 'L') return (t) => [lerp(x0, c.p[0], t), lerp(y0, c.p[1], t)];
  if (c.t === 'C') return (t) => cubicAt(x0, y0, c.p, t);
  if (c.t === 'Q') return (t) => quadAt(x0, y0, c.p, t);
  return (t) => arcAt(x0, y0, c.p, t);
}

/** Subdivide until the chord sits within tolerance of the curve, in view units. */
function flattenCommand(c, x0, y0, tolView) {
  const f = sampler(c, x0, y0);
  const pts = [];
  const rec = (t0, t1, p0, p1, depth) => {
    const tm = (t0 + t1) / 2;
    const pm = f(tm);
    const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
    const err = Math.hypot(pm[0] - mx, pm[1] - my);
    if (depth >= 10 || err <= tolView) { pts.push(p1); return; }
    rec(t0, tm, p0, pm, depth + 1);
    rec(tm, t1, pm, p1, depth + 1);
  };
  rec(0, 1, [x0, y0], f(1), 0);
  return pts;
}

function flattenSubpath(sp, tolView) {
  const ring = [sp.start];
  let [x, y] = sp.start;
  for (const c of sp.cmds) {
    for (const p of flattenCommand(c, x, y, tolView)) ring.push(p);
    const last = ring[ring.length - 1];
    x = last[0]; y = last[1];
  }
  return ring;
}

// ---------------------------------------------------------------- generation

const round = (v) => Number(v.toFixed(DP));

function buildSide(parts, side) {
  const originX = side === 'front' ? 0 : VIEW_W;
  const tolView = TOLERANCE * VIEW_W;
  const out = {};
  for (const part of parts) {
    if (!part.slug || !MUSCLE_SLUGS.has(part.slug)) continue;
    const rings = [];
    for (const group of ['left', 'right', 'common']) {
      for (const d of part.path?.[group] ?? []) {
        for (const sp of parsePath(d)) {
          const ring = flattenSubpath(sp, tolView).map(([x, y]) => [
            round((x - originX) / VIEW_W),
            round(y / VIEW_H),
          ]);
          if (ring.length >= 3) rings.push(ring);
        }
      }
    }
    if (rings.length) out[part.slug] = rings;
  }
  return out;
}

function emit(gender, front, back) {
  const body = (name, data) => {
    const slugs = Object.keys(data).sort();
    const entries = slugs.map((slug) => {
      const rings = data[slug]
        .map((r) => `    [${r.map(([x, y]) => `[${x}, ${y}]`).join(', ')}],`)
        .join('\n');
      return `  '${slug}': [\n${rings}\n  ],`;
    });
    return `export const ${name}: MusclePolygons = {\n${entries.join('\n')}\n};\n`;
  };
  return `// GENERATED by scripts/generate-muscle-polygons.mjs. Do not edit.
// Derived from react-native-body-highlighter so hit regions match the drawn body.
import type { MusclePolygons } from './hitTest';

${body(`FRONT_${gender.toUpperCase()}`, front)}
${body(`BACK_${gender.toUpperCase()}`, back)}`;
}

// Format exactly as the pre-commit hook would, so --check never trips on whitespace.
const prettier = require('prettier');
const prettierConfig = {
  ...JSON.parse(readFileSync(join(ROOT, 'config/.prettierrc'), 'utf8')),
  parser: 'typescript',
};
const format = (text) => prettier.format(text, prettierConfig);

const check = process.argv.includes('--check');
let failed = false;
let totalPts = 0;

for (const gender of ['male', 'female']) {
  const f = require(`react-native-body-highlighter/dist/assets/${gender === 'male' ? 'bodyFront' : 'bodyFemaleFront'}.js`);
  const b = require(`react-native-body-highlighter/dist/assets/${gender === 'male' ? 'bodyBack' : 'bodyFemaleBack'}.js`);
  const front = buildSide(Object.values(f)[0], 'front');
  const back = buildSide(Object.values(b)[0], 'back');

  for (const d of [front, back]) for (const r of Object.values(d)) for (const p of r) totalPts += p.length;

  const text = await format(emit(gender, front, back));
  const path = join(OUT_DIR, `${gender}.generated.ts`);
  if (check) {
    let existing = '';
    try { existing = readFileSync(path, 'utf8'); } catch { /* missing counts as drift */ }
    if (existing !== text) {
      console.error(`muscle polygons: ${gender}.generated.ts is stale, re-run scripts/generate-muscle-polygons.mjs`);
      failed = true;
    }
  } else {
    writeFileSync(path, text);
    console.log(`wrote ${path}`);
  }
}

console.log(`muscle polygons: ${totalPts} points across both genders`);
if (failed) process.exit(1);
