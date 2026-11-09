#!/usr/bin/env node
// An engine date is read through `src/shared/time/startDate.ts` or `src/shared/format/format.ts`.
//
// The engine stores the athlete's wall clock stamped as UTC. `new Date(seconds * 1000)` read in
// local time shows the neighbouring day wherever the device is not on UTC, and a zoneless
// `start_date_local` parsed with `new Date` and turned into epoch seconds stamps the device's
// zone instead of the athlete's clock. The two owner files hold the reads that are right.
//
// A moment that really is an instant (a recorded run time, a request-budget reset) says so with
// `// true-instant: <reason>` on the same line, and the reason cannot be blank.
//
// Sites that open work still owns are recorded by file and count in
// `engine-date-reads-baseline.json`. A file above its count fails, and a file below it fails
// too, so the list only shrinks.

import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { refuseEmptyListing, treeSources } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const ROOT = resolve(flag('--root') ?? join(HERE, '..'));
const BASELINE_FILE = resolve(flag('--baseline') ?? join(HERE, 'engine-date-reads-baseline.json'));

const OWNERS = new Set(['src/shared/time/startDate.ts', 'src/shared/format/format.ts']);
const SECONDS_READ = /new Date\([^)]*\*\s*1000\s*\)/;
const WALL_CLOCK_PARSE = /new Date\([^)]*start_date_local[^)]*\)\.getTime\(\)\s*\/\s*1000/;
const MARKER = /\/\/\s*true-instant:\s*(\S.*)?$/;

const sources = treeSources(ROOT, ['src']);
refuseEmptyListing(sources, 'engine date read guard');

const counts = new Map();
const sites = new Map();
const blank = [];

for (const [rel, bytes] of sources) {
  if (!/\.(ts|tsx)$/.test(rel) || OWNERS.has(rel) || rel.startsWith('src/__tests__/')) continue;
  const lines = bytes.toString('utf8').split('\n');
  lines.forEach((text, i) => {
    if (!SECONDS_READ.test(text) && !WALL_CLOCK_PARSE.test(text)) return;
    const marker = MARKER.exec(text);
    if (marker?.[1]) return;
    if (marker) {
      blank.push(`${rel}:${i + 1}`);
      return;
    }
    counts.set(rel, (counts.get(rel) ?? 0) + 1);
    sites.set(rel, [...(sites.get(rel) ?? []), `${rel}:${i + 1}  ${text.trim()}`]);
  });
}

let baseline = {};
try {
  baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
} catch {
  baseline = {};
}

const problems = blank.map((at) => `${at}: a true-instant marker needs a reason`);
for (const [rel, n] of counts) {
  const allowed = baseline[rel] ?? 0;
  if (n > allowed) {
    problems.push(
      `${rel}: ${n} raw engine date reads, ${allowed} recorded\n      ${sites.get(rel).join('\n      ')}`
    );
  }
}
for (const [rel, allowed] of Object.entries(baseline)) {
  const n = counts.get(rel) ?? 0;
  if (n < allowed) {
    problems.push(`${rel}: baseline records ${allowed} reads and ${n} remain, lower the entry`);
  }
}

if (problems.length > 0) {
  console.error(
    'Engine dates: an engine wall-clock date is read through startDate.ts or format.ts.\n'
  );
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nUse formatEpochDayUtc, epochDayKeyUtc or wallClockSecondsToLocalDate. A true instant'
  );
  console.error('carries `// true-instant: <reason>` on the line.');
  process.exit(1);
}
console.log(
  `engine dates: ${[...counts.values()].reduce((a, b) => a + b, 0)} baseline reads, none new.`
);
