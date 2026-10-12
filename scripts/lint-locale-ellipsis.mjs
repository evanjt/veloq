#!/usr/bin/env node
// Copy writes the ellipsis as the one character, never as three full stops. The
// locales held both, so one screen read "Loading…" beside "Loading more..." and
// a line that appended its own three dots to a string already ending in them
// printed six. Every locale bundle is read, because a translator who copies the
// base string copies its punctuation with it.

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const LOCALES = /^src\/i18n\/locales\/[^/]+\.json$/;
const THREE_DOTS = '...';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const tracked = indexedSources(root, ['src/i18n/locales']);
refuseEmptyListing(tracked, 'Locale ellipsis guard');

const failures = [];

function walk(file, path, value) {
  if (typeof value === 'string') {
    if (value.includes(THREE_DOTS)) failures.push(`${file}  ${path}: ${value}`);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      walk(file, path ? `${path}.${key}` : key, child);
    }
  }
}

for (const [file, bytes] of tracked) {
  if (!LOCALES.test(file)) continue;
  walk(file, '', JSON.parse(bytes.toString('utf8')));
}

if (failures.length > 0) {
  console.error(
    `Locale copy writes the ellipsis as …, not three full stops. ${failures.length} values:\n`
  );
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Locale ellipsis guard: every locale value writes the ellipsis as one character.');
