#!/usr/bin/env node
// One table of trend thresholds. `TREND_DEADBAND` in `src/shared/format/trend.ts`
// says how far a metric has to move before it reads as up or down, and every
// surface takes its threshold from there.
//
// The widget and the summary card each carried their own copy of all five, and
// they drifted, so the same week read as up on one and flat on the other. Two
// shapes let that back in, and this fails both: a bare number handed to a trend
// call as its threshold, and a trend call taken from anywhere but the shared
// module, which is what a second copy of the function looks like.
//
// The shared module is exempt, since it is where the table lives.

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const SHARED = 'src/shared/format/trend.ts';
const SHARED_IMPORT = '@/shared/format/trend';

// A call whose last argument is a numeric literal. `trendOfMetric` takes no
// threshold, so only the two that do are matched. One level of nested
// parentheses is allowed in the arguments, for `trendOf(num(x), y, 0.5)`.
const BARE_THRESHOLD = /\btrend(?:Of|Direction)\((?:[^()]|\([^()]*\))*,\s*-?(?:\d+\.?\d*|\.\d+)\s*\)/g;

// The shared functions a surface calls. A definition is not a call.
const SHARED_CALLS = ['trendDirection', 'trendOfMetric'];

function isSource(file) {
  if (!/\.tsx?$/.test(file) || /\.d\.ts$/.test(file)) return false;
  if (/(^|\/)(__tests__|__mocks__)\//.test(file)) return false;
  return !/\.(test|spec)\.tsx?$/.test(file);
}

/** The names a file imports from the shared module. */
function importedFromShared(text) {
  const names = new Set();
  const pattern = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const [, list, from] of text.matchAll(pattern)) {
    if (from !== SHARED_IMPORT) continue;
    for (const item of list.split(',')) {
      const name = item.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
      if (name) names.add(name);
    }
  }
  return names;
}

const tracked = indexedSources(root, ['src']);
refuseEmptyListing(tracked, 'Trend threshold guard');

const failures = [];
for (const [file, bytes] of tracked) {
  if (file === SHARED || !isSource(file)) continue;
  const text = bytes.toString('utf8');

  text.split('\n').forEach((line, i) => {
    for (const match of line.matchAll(BARE_THRESHOLD)) {
      failures.push(`${file}:${i + 1}  bare threshold: ${match[0]}`);
    }
  });

  const imported = importedFromShared(text);
  for (const name of SHARED_CALLS) {
    const called = new RegExp(`(?<!function\\s)\\b${name}\\(`).test(text);
    if (called && !imported.has(name)) {
      failures.push(`${file}  calls ${name} without importing it from ${SHARED_IMPORT}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`A trend threshold that is not the shared table's: ${failures.length}.`);
  console.error(`Take the threshold from TREND_DEADBAND and the call from ${SHARED_IMPORT}.\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Trend threshold guard: every threshold comes from the shared table.');
