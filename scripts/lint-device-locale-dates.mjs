#!/usr/bin/env node
// An athlete-facing date is formatted with the app language, never the device locale.
//
// With the device on en-US and the app on ja, `toLocaleDateString()`,
// `Intl.DateTimeFormat()` and a call that passes `undefined` or a fixed 'en-US' render English
// month names. The debug screens are the two exempt files: their readers are developers.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseEmptyListing, treeSources } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const ROOT = resolve(rootFlag === -1 ? join(HERE, '..') : process.argv[rootFlag + 1]);

const EXEMPT = new Set([
  'src/app/debug.tsx',
  'src/features/routes/components/SyncDebugSection.tsx',
]);
const DEVICE_LOCALE_CALL =
  /\b(?:toLocale(?:Date|Time)?String|Intl\.DateTimeFormat)\(\s*(?:\)|undefined\b|'en-US')/g;

const sources = treeSources(ROOT, ['src']);
refuseEmptyListing(sources, 'device locale date guard');

const failures = [];
for (const [rel, bytes] of sources) {
  if (!/\.tsx?$/.test(rel) || rel.startsWith('src/__tests__/') || EXEMPT.has(rel)) continue;
  const text = bytes.toString('utf8');
  for (const m of text.matchAll(DEVICE_LOCALE_CALL)) {
    failures.push(`${rel}:${text.slice(0, m.index).split('\n').length}`);
  }
}

if (failures.length > 0) {
  console.error(
    `A date is formatted with the device locale. Pass the app locale. ${failures.length} sites:\n`
  );
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Device locale date guard: every date call passes the app locale.');
