#!/usr/bin/env node
// A rendered number is written by `src/shared/format`, in the app locale.
//
// `toFixed` always writes a period decimal and no grouping, so a value printed
// with it reads '12.5' under a language that writes '12,5', beside dates and
// numbers that follow the language. `formatDecimal`, `formatPercent` and
// `formatSigned` write the locale's separators. Logs, debug screens and values
// nobody reads keep `toFixed`. `--root` points the lint at another tree.

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

// Values written with `toFixed` that no athlete reads as a number, by file and
// the expression before `.toFixed`, each for its reason.
const UNREAD = new Map([
  // The developer timing rows under the charts.
  ['src/features/activity/components/ActivityChartsSection.tsx', ['m.maxMs', 'm.totalMs']],
  // Part of a memo key, never shown.
  ['src/features/routes/hooks/useRoutesScreenData.ts', ['userLat', 'userLng']],
  // The text a number field is filled with, read back by `parseDecimalInput`,
  // which takes no group separator.
  ['src/features/routes/lib/paramUnits.ts', ['value']],
]);

const TO_FIXED = /([\w$.?]*)\.toFixed\(/g;
const LOG_CALL = /\b(?:log|console)\.\w+\(/g;

/** Whether `index` falls inside the arguments of a log call still open there. */
function insideLogCall(text, index) {
  let open = -1;
  for (const m of text.slice(0, index).matchAll(LOG_CALL)) open = m.index + m[0].length;
  if (open === -1) return false;
  let depth = 1;
  for (let i = open; i < index; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return false;
  }
  return true;
}

const tracked = indexedSources(root, ['src']);
refuseEmptyListing(tracked, 'Rendered decimals guard');

const failures = new Set();
for (const [file, bytes] of tracked) {
  if (!/\.tsx?$/.test(file) || file.startsWith('src/shared/format/')) continue;
  const segments = file.split('/');
  if (segments.includes('__tests__') || /debug/i.test(file)) continue;
  if (/\.generated\.tsx?$/.test(file)) continue;
  const text = bytes.toString('utf8');
  const unread = UNREAD.get(file) ?? [];
  for (const m of text.matchAll(TO_FIXED)) {
    if (unread.includes(m[1].replace(/\?$/, ''))) continue;
    if (insideLogCall(text, m.index)) continue;
    const line = text.slice(0, m.index).split('\n').length;
    failures.add(`${file}:${line}`);
  }
}

if (failures.size > 0) {
  console.error(`A rendered number is written with toFixed: ${failures.size}.\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    '\nWrite it with formatDecimal, formatPercent or formatSigned from @/shared/format, which follow the app locale.'
  );
  process.exit(1);
}

console.log('Rendered decimals guard: every rendered number follows the app locale.');
