#!/usr/bin/env node
// The data service writes its own name in lower case, and so do we: in the
// locales, the website, the store listings and the Maestro flows that assert
// them, at the start of a sentence as well. Copy drifted to a capital first
// letter in thirteen locales and both web pages, so the whole index is read
// rather than a list of directories.
//
// The all-capitals spelling stays allowed: it is a section label set in
// capitals like every other one, not a spelling of the name.

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const NAME = /intervals\.icu/gi;
const LOWER = 'intervals.icu';
const UPPER = LOWER.toUpperCase();

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const failures = [];

const tracked = indexedSources(root);
refuseEmptyListing(tracked, 'Service name guard');

for (const [file, bytes] of tracked) {
  if (bytes.includes(0)) continue;
  const lines = bytes.toString('utf8').split('\n');
  lines.forEach((line, i) => {
    const wrong = (line.match(NAME) ?? []).some((m) => m !== LOWER && m !== UPPER);
    if (wrong) failures.push(`${file}:${i + 1}  ${line.trim()}`);
  });
}

if (failures.length > 0) {
  console.error(
    `The service writes its name as ${LOWER}, in lower case. ${failures.length} lines:\n`
  );
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Service name guard: written in lower case throughout the tracked tree.');
