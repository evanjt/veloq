#!/usr/bin/env node
// Read the frames of one tab tap out of `dumpsys gfxinfo <pkg> framestats`.
//
// `tab-visit-framestats.mjs RUN.txt[=MS]...` prints one line per run, the
// frames over a vsync and a half after the tap, and a summary. Each file holds
// every framestats dump taken during one run, from a `reset` just before the
// tap to a few seconds after it, merged on their intended vsync because a dump
// holds only the last 120 frames. MS is the screen's own `tab.*` figure for
// that tap, read off the Developer Dashboard: press in JavaScript to the
// animation frame after the screen's first commit.
//
// Every number is on the handset's CLOCK_MONOTONIC. The tap is the
// input-handling start of the last frame that carried an input event (the
// release, which fires `onPress`). Framestats does not say what a frame shows,
// and a staged mount takes no longer than the button's fade, so the mount
// cannot be told by its length. The mount is taken as the first UI-thread
// frame (`Flags=0`; render-thread animation frames are `Flags=2`) whose vsync
// falls at or after the tap plus MS. That is a pairing rule, not an
// identification: a mount frame that completes before the JavaScript frame
// recording MS is passed over for the next one, so `timeline` is worth reading
// beside it, and MS alone is a floor under tap to present. Reported, in
// milliseconds from the tap:
//
//   next      to the completion of the first frame after the release
//   first     to the completion of the mount frame; NaN with no MS
//   lastLong  to the completion of the last frame over LATE_MS, where content
//             that loads after the mount re-renders it
//   slow      frames after the tap that took over two vsyncs
import { readFileSync } from 'node:fs';

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

function measure(frames, metricMs) {
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
  const mountAfter = tap + metricMs * NS;
  const mount = Number.isFinite(metricMs)
    ? after.find((f) => f.IntendedVsync >= mountAfter)
    : undefined;
  const late = after.filter((f) => took(f) >= LATE_MS * NS).pop();
  const at = (f) => (f.FrameCompleted - tap) / NS;
  return {
    next: at(after[0]),
    first: mount ? at(mount) : NaN,
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
for (const arg of process.argv.slice(2)) {
  const split = arg.match(/^(.*)=(\d+(?:\.\d+)?)$/);
  const file = split ? split[1] : arg;
  const metricMs = split ? Number(split[2]) : NaN;
  const m = measure(parse(readFileSync(file, 'utf8')), metricMs);
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
