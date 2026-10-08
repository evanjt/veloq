#!/usr/bin/env node
// Summarise the captures `scripts/measure-gestures.sh` writes: one line per file.
//
// From the summary histogram: frames, janky frames and per cent, the 50th,
// 90th, 95th and 99th percentile frame, frames that missed their deadline and
// slow UI-thread frames. From the merged framestats rows of the main window:
// the longest frame, intended vsync to completion, and the longest stretch of
// UI-thread work in one frame, intended vsync to the sync being queued.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

function framestats(text) {
  const rows = new Map();
  let header = null;
  let window = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '=== SUMMARY') break;
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
    if (!row.IntendedVsync || row.Flags !== 0) continue;
    if (window && !/MainActivity/.test(window)) continue;
    rows.set(row.IntendedVsync, row);
  }
  return [...rows.values()];
}

function summary(text) {
  const tail = text.split('=== SUMMARY')[1] ?? '';
  const num = (re) => {
    const m = tail.match(re);
    return m ? Number(m[1]) : NaN;
  };
  const hist = (tail.match(/^HISTOGRAM: (.*)$/m)?.[1] ?? '')
    .split(' ')
    .map((cell) => cell.match(/^(\d+)ms=(\d+)$/))
    .filter(Boolean)
    .map((m) => [Number(m[1]), Number(m[2])]);
  const top = hist.filter(([, n]) => n > 0).pop();
  return {
    frames: num(/^Total frames rendered: (\d+)/m),
    janky: num(/^Janky frames: (\d+)/m),
    jankyPct: num(/^Janky frames: \d+ \(([\d.]+)%\)/m),
    p50: num(/^50th percentile: (\d+)ms/m),
    p90: num(/^90th percentile: (\d+)ms/m),
    p95: num(/^95th percentile: (\d+)ms/m),
    p99: num(/^99th percentile: (\d+)ms/m),
    deadline: num(/^Number Frame deadline missed: (\d+)/m),
    slowUi: num(/^Number Slow UI thread: (\d+)/m),
    histTop: top ? top[0] : NaN,
  };
}

const ms = (ns) => (ns / 1e6).toFixed(1);
for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8');
  const s = summary(text);
  const rows = framestats(text);
  let longest = 0;
  let longestUi = 0;
  for (const r of rows) {
    if (r.FrameCompleted > r.IntendedVsync)
      longest = Math.max(longest, r.FrameCompleted - r.IntendedVsync);
    if (r.SyncQueued > r.IntendedVsync)
      longestUi = Math.max(longestUi, r.SyncQueued - r.IntendedVsync);
  }
  console.log(
    [
      basename(file, '.txt').padEnd(22),
      `frames=${s.frames}`,
      `janky=${s.janky} (${s.jankyPct}%)`,
      `p50=${s.p50} p90=${s.p90} p95=${s.p95} p99=${s.p99}`,
      `deadline=${s.deadline} slowUI=${s.slowUi}`,
      `hist_max=${s.histTop}`,
      `longest=${ms(longest)} longestUI=${ms(longestUi)} rows=${rows.length}`,
    ].join('  ')
  );
}
