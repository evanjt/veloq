#!/usr/bin/env node
// Read the frames of one tab tap out of `dumpsys gfxinfo <pkg> framestats`.
//
// `tab-visit-framestats.mjs RUN.txt...` prints one line per run, the frames
// over a vsync and a half after the tap, and a summary. Each file holds every
// framestats dump taken during one run, from a `reset` just before the tap to
// a few seconds after it, merged on their intended vsync because a dump holds
// only the last 120 frames.
//
// Every number is on the handset's CLOCK_MONOTONIC. The tap is the
// input-handling start of the last frame that carried an input event (the
// release, which fires `onPress`). A tab switch has no push animation: the
// fast frames after the release are the button's opacity fade on the UI
// thread, and the new screen arrives in the first long frame, where the UI
// thread applies its views. A second visit to a tab that is kept mounted has
// no such frame, which is what tells the two apart. Reported, in milliseconds
// from the tap:
//
//   next      to the completion of the first frame after the release
//   first     to the completion of the first frame over LONG_MS, the frame
//             that presents the screen on a first visit: the press frames
//             before it run on the UI thread and took up to 36 ms on the test handset
//   lastLong  to the completion of the last frame over LATE_MS, where content
//             that loads after the mount re-renders it
//   slow      frames after the tap that took over two vsyncs
import { readFileSync } from 'node:fs';

const LONG_MS = Number(process.env.LONG_MS ?? 50);
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
    if (window && !/MainActivity/.test(window)) continue;
    rows.set(row.IntendedVsync, row);
  }
  return [...rows.values()].sort((a, b) => a.IntendedVsync - b.IntendedVsync);
}

function measure(frames) {
  frames = frames.filter((f) => f.Flags === 0 && f.FrameCompleted > f.IntendedVsync);
  const inputs = frames.filter((f) => (f.InputEventId ?? 0) !== 0);
  if (inputs.length === 0) return { error: 'no input frame' };
  const first = inputs[0];
  const release = inputs.filter((f) => f.IntendedVsync - first.IntendedVsync < 300 * NS).pop();
  const tap = release.HandleInputStart;
  const after = frames.filter((f) => f.IntendedVsync > release.IntendedVsync);
  if (after.length === 0) return { error: 'no frame after the tap' };
  const took = (f) => f.FrameCompleted - f.IntendedVsync;
  const gaps = after.slice(1).map((f, i) => f.IntendedVsync - after[i].IntendedVsync);
  const vsync = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 4)] || 8.33 * NS;
  const long = after.find((f) => took(f) >= LONG_MS * NS);
  const late = after.filter((f) => took(f) >= LATE_MS * NS).pop();
  const at = (f) => (f.FrameCompleted - tap) / NS;
  return {
    next: at(after[0]),
    first: long ? at(long) : NaN,
    lastLong: late ? at(late) : NaN,
    slow: after.filter((f) => took(f) > 2 * vsync).length,
    frames: after.length,
    vsync: vsync / NS,
    timeline: after
      .filter((f) => took(f) > 1.5 * vsync)
      .map((f) => `${at(f).toFixed(0)}:${(took(f) / NS).toFixed(0)}`)
      .join(' '),
  };
}

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
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
    `${file}  next=${m.next.toFixed(1)}  first=${m.first.toFixed(1)}  lastLong=${m.lastLong.toFixed(1)}  slow=${m.slow}  frames=${m.frames}  vsync=${m.vsync.toFixed(2)}`
  );
  console.log(`  frames over 1.5 vsyncs, completed:took ms  ${m.timeline}`);
}
if (results.length > 0) {
  for (const key of ['next', 'first', 'lastLong', 'slow']) {
    const values = results.map((r) => r[key]).filter(Number.isFinite);
    console.log(
      `${key.padEnd(8)} n=${values.length}  median=${quantile(values, 0.5).toFixed(1)}  min=${Math.min(...values).toFixed(1)}  max=${Math.max(...values).toFixed(1)}`
    );
  }
}
