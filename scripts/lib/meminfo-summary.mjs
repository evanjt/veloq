#!/usr/bin/env node
// The graphics an app holds, read out of `dumpsys meminfo <pkg>`, and a verdict
// on the median of several readings against a ceiling.
//
//   meminfo-summary.mjs BOUND_MB FILE...
//
// Each FILE is one `dumpsys meminfo` capture named `<run>-shown.txt`,
// `<run>-hidden.txt` or `<run>-baseline.txt`. It prints one row per file, then
// the median of the hidden readings' Graphics, and exits 1 when that median is
// over BOUND_MB, 2 when there are fewer than three hidden readings or a file is
// not a meminfo capture. With three baselines, cold readings of the hiding
// screen that never opened the map, it also prints the map's own share: the
// hidden median less the baseline median. The share is a record, not the
// verdict. A megabyte here is 1024 KB, as `dumpsys` counts in KB.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIN_READINGS = 3;

/** The first whole number after `label` on the line that starts with it. */
function figure(text, label) {
  const match = new RegExp(`^\\s*${label}\\s+(\\d+)`, 'm').exec(text);
  return match ? Number(match[1]) : null;
}

/**
 * Graphics, EGL mtrack, GL mtrack and TOTAL PSS in KB. Graphics and TOTAL PSS
 * come from the App Summary, the two mtrack rows from the category table, which
 * a device without a GPU driver that reports them leaves out.
 */
export function meminfoSummary(text) {
  const graphicsKb = figure(text, 'Graphics:');
  const totalPssKb = figure(text, 'TOTAL PSS:');
  if (graphicsKb === null || totalPssKb === null) {
    throw new Error('meminfo-summary: no App Summary with Graphics and TOTAL PSS');
  }
  return {
    graphicsKb,
    eglMtrackKb: figure(text, 'EGL mtrack') ?? 0,
    glMtrackKb: figure(text, 'GL mtrack') ?? 0,
    totalPssKb,
  };
}

function median(readingsMb) {
  if (readingsMb.length < MIN_READINGS) {
    throw new Error(
      `meminfo-summary: ${readingsMb.length} readings, a median needs at least ${MIN_READINGS}`
    );
  }
  if (!readingsMb.every(Number.isFinite)) {
    throw new Error('meminfo-summary: a reading is not a number');
  }
  const sorted = [...readingsMb].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The median of readings in MB and whether it is over `boundMb`. */
export function medianVerdict(readingsMb, boundMb) {
  if (!Number.isFinite(boundMb)) {
    throw new Error('meminfo-summary: the bound is not a number');
  }
  const m = median(readingsMb);
  return { median: m, bound: boundMb, over: m > boundMb };
}

/** The hidden and baseline medians in MB and what the map adds over the baseline. */
export function mapShare(hiddenMb, baselineMb) {
  const hidden = median(hiddenMb);
  const baseline = median(baselineMb);
  return { hidden, baseline, share: hidden - baseline };
}

const mb = (kb) => kb / 1024;

function main(argv) {
  const [bound, ...files] = argv;
  const boundMb = Number(bound);
  if (!Number.isFinite(boundMb) || files.length === 0) {
    console.error('usage: meminfo-summary.mjs BOUND_MB FILE...');
    return 2;
  }
  const hidden = [];
  const baseline = [];
  console.log('reading\tgraphics_mb\tegl_mtrack_mb\tgl_mtrack_mb\ttotal_pss_mb');
  for (const file of files) {
    let s;
    try {
      s = meminfoSummary(readFileSync(file, 'utf8'));
    } catch (error) {
      console.error(`${file}: ${error.message}`);
      return 2;
    }
    const label = basename(file).replace(/\.txt$/, '');
    if (label.endsWith('-hidden')) hidden.push(mb(s.graphicsKb));
    if (label.endsWith('-baseline')) baseline.push(mb(s.graphicsKb));
    console.log(
      [label, s.graphicsKb, s.eglMtrackKb, s.glMtrackKb, s.totalPssKb]
        .map((v, i) => (i === 0 ? v : mb(v).toFixed(1)))
        .join('\t')
    );
  }
  let verdict;
  try {
    verdict = medianVerdict(hidden, boundMb);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  console.log(
    `hidden graphics median ${verdict.median.toFixed(1)} MB against ${boundMb} MB: ${verdict.over ? 'over' : 'within'}`
  );
  if (baseline.length >= MIN_READINGS) {
    const s = mapShare(hidden, baseline);
    console.log(
      `map share ${s.share.toFixed(1)} MB, hidden ${s.hidden.toFixed(1)} MB less baseline ${s.baseline.toFixed(1)} MB`
    );
  }
  return verdict.over ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
