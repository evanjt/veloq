#!/usr/bin/env node
// Read a cold launch out of an `am start -W` report followed by framestats
// dumps, as `measure-launch-and-open.sh` writes them.
//
// `cold-launch-framestats.mjs RUN.txt...` prints one line per run and a
// summary. `am start -W` reports TotalTime, from the start request to the
// first frame of the activity window, on the system's clock. The frames that
// follow are on the handset's CLOCK_MONOTONIC and are anchored on the earliest
// frame of the main window, which is that first frame. Reported, in
// milliseconds from the start request:
//
//   window    TotalTime, the activity's first frame
//   mount     the completion of the longest frame after that one, which is
//             the frame that applies the JavaScript tree and shows the screen
//   drawn     the completion of the run of frames that follows the mount, up
//             to the first gap of IDLE_MS, which is the screen at rest
//   lastLong  the completion of the last frame over LATE_MS in the capture
import { readFileSync } from 'node:fs';

const LONG_MS = 50;
const LATE_MS = 30;
const IDLE_MS = 250;
const NS = 1e6;

function parse(text) {
  const rows = new Map();
  let header = null;
  let window = '';
  let total = NaN;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const t = /^TotalTime:\s*(\d+)/.exec(line);
    if (t) {
      total = Number(t[1]);
      continue;
    }
    if (/^(Window: |com\.|[a-z][\w.]+\/[\w.]+\/android\.view\.ViewRootImpl@)/.test(line)) {
      window = line;
      continue;
    }
    if (line.startsWith('Flags,')) {
      header = line.split(',').filter(Boolean);
      continue;
    }
    if (line === '---PROFILEDATA---') {
      header = null;
      continue;
    }
    if (!header || !/^\d/.test(line)) continue;
    const cells = line.split(',');
    const row = Object.fromEntries(header.map((name, i) => [name, Number(cells[i])]));
    if (!Number.isFinite(row.IntendedVsync) || row.IntendedVsync === 0) continue;
    if (window && !/MainActivity/.test(window)) continue;
    rows.set(row.IntendedVsync, row);
  }
  return { total, frames: [...rows.values()].sort((a, b) => a.IntendedVsync - b.IntendedVsync) };
}

function measure({ total, frames }) {
  if (!Number.isFinite(total)) return { error: 'no TotalTime' };
  frames = frames.filter((f) => f.Flags === 0 && f.FrameCompleted > f.IntendedVsync);
  if (frames.length === 0) return { error: 'no frames' };
  const base = frames[0].FrameCompleted;
  const at = (f) => total + (f.FrameCompleted - base) / NS;
  const took = (f) => f.FrameCompleted - f.IntendedVsync;
  const mount = frames.slice(1).reduce((m, f) => (!m || took(f) > took(m) ? f : m), null);
  if (!mount || took(mount) < LONG_MS * NS) return { error: 'no screen mount' };
  let drawn = frames[frames.length - 1];
  for (let i = frames.indexOf(mount); i + 1 < frames.length; i++) {
    if (frames[i + 1].IntendedVsync - frames[i].IntendedVsync >= IDLE_MS * NS) {
      drawn = frames[i];
      break;
    }
  }
  const late = frames.filter((f) => took(f) >= LATE_MS * NS).pop();
  return {
    window: total,
    mount: at(mount),
    drawn: at(drawn),
    lastLong: at(late),
    frames: frames.length,
  };
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

const results = [];
for (const file of process.argv.slice(2)) {
  const m = measure(parse(readFileSync(file, 'utf8')));
  if (m.error) {
    console.log(`${file}  discarded: ${m.error}`);
    continue;
  }
  results.push(m);
  console.log(
    `${file}  window=${m.window}  mount=${m.mount.toFixed(1)}  drawn=${m.drawn.toFixed(1)}  lastLong=${m.lastLong.toFixed(1)}  frames=${m.frames}`
  );
}
if (results.length > 0) {
  for (const key of ['window', 'mount', 'drawn', 'lastLong']) {
    const values = results.map((r) => r[key]);
    console.log(
      `${key.padEnd(8)} n=${values.length}  median=${quantile(values, 0.5).toFixed(1)}  p90=${quantile(values, 0.9).toFixed(1)}  min=${Math.min(...values).toFixed(1)}  max=${Math.max(...values).toFixed(1)}`
    );
  }
}
