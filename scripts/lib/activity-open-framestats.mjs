#!/usr/bin/env node
// Read the frames of one activity open out of `dumpsys gfxinfo <pkg> framestats`.
//
// `activity-open-framestats.mjs RUN.txt...` prints one line per run and a
// summary. Each file holds every framestats dump taken during one run, from a
// `reset` just before the tap to a few seconds after it. A dump holds only the
// last 120 frames, so a run is read several times and the rows are merged on
// their intended vsync.
//
// Every number is on the handset's CLOCK_MONOTONIC, so no host timestamp is
// involved. The tap is the input-handling start of the last frame that carried
// an input event (the release, which is what fires `onPress`). Fast frames
// straight after it are the press ripple, which runs on the UI thread while
// the JS thread handles the press, so they say nothing about the open. The
// detail screen arrives as the first long frame after the tap, when the UI
// thread applies its views, and the push animation is the continuous run of
// frames that follows. Reported, in milliseconds from the tap:
//
//   mount     to the completion of the first frame over LONG_MS
//   settled   to the completion of the run that follows it
//   lastLong  to the completion of the last frame over LATE_MS, which is
//             where a read deferred past the animation re-renders the screen
//   slow      frames after the tap that took over two vsyncs
import { readFileSync } from 'node:fs';

const MIN_RUN = 15;
const LONG_MS = 50;
const LATE_MS = 30;
const NS = 1e6;

function parse(text) {
  const rows = new Map();
  let header = null;
  let window = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
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
    // The main window of the activity is the one the tap and the push land on.
    if (window && !/MainActivity/.test(window)) continue;
    rows.set(row.IntendedVsync, row);
  }
  return [...rows.values()].sort((a, b) => a.IntendedVsync - b.IntendedVsync);
}

function measure(frames) {
  // Rows with a non-zero flag are frames the platform marks as not comparable.
  frames = frames.filter((f) => f.Flags === 0 && f.FrameCompleted > f.IntendedVsync);
  const inputs = frames.filter((f) => (f.InputEventId ?? 0) !== 0);
  if (inputs.length === 0) return { error: 'no input frame' };
  const first = inputs[0];
  const release = inputs.filter((f) => f.IntendedVsync - first.IntendedVsync < 300 * NS).pop();
  const tap = release.HandleInputStart;
  const after = frames.filter((f) => f.IntendedVsync > release.IntendedVsync);
  const took = (f) => f.FrameCompleted - f.IntendedVsync;
  const mountAt = after.findIndex((f) => took(f) >= LONG_MS * NS);
  if (mountAt < 0) return { error: 'no screen mount' };
  const gaps = after.slice(1).map((f, i) => f.IntendedVsync - after[i].IntendedVsync);
  const vsync = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 4)] || 8.33 * NS;
  let settled = -1;
  for (let i = mountAt; i < after.length; i++) {
    let j = i;
    while (j + 1 < after.length && after[j + 1].IntendedVsync - after[j].IntendedVsync <= 3 * vsync) j++;
    if (j - i + 1 >= MIN_RUN) {
      settled = j;
      break;
    }
    i = j;
  }
  if (settled < 0) return { error: 'no push run' };
  const late = after.filter((f) => took(f) >= LATE_MS * NS).pop();
  return {
    mount: (after[mountAt].FrameCompleted - tap) / NS,
    settled: (after[settled].FrameCompleted - tap) / NS,
    lastLong: (late.FrameCompleted - tap) / NS,
    slow: after.filter((f) => took(f) > 2 * vsync).length,
    frames: after.length,
    vsync: vsync / NS,
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
    `${file}  mount=${m.mount.toFixed(1)}  settled=${m.settled.toFixed(1)}  lastLong=${m.lastLong.toFixed(1)}  slow=${m.slow}  frames=${m.frames}  vsync=${m.vsync.toFixed(2)}`
  );
}
if (results.length > 0) {
  for (const key of ['mount', 'settled', 'lastLong', 'slow']) {
    const values = results.map((r) => r[key]);
    console.log(
      `${key.padEnd(8)} n=${values.length}  median=${quantile(values, 0.5).toFixed(1)}  p90=${quantile(values, 0.9).toFixed(1)}  min=${Math.min(...values).toFixed(1)}  max=${Math.max(...values).toFixed(1)}`
    );
  }
}
