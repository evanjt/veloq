#!/usr/bin/env node
// The `lat`/`lng` point is declared once, as `LatLngShort` in the module's `coords.ts`.
//
// Every structural copy typechecks against the others, so a field added to the
// one declaration, or a change to one copy, is honoured nowhere else. A record
// that carries `lat` and `lng` beside other fields is not a point and is left alone.

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const DECLARING_FILE = 'modules/veloqrs/src/coords.ts';
const SHAPE =
  /\{\s*(?:lat\s*:\s*number\s*[;,]\s*lng|lng\s*:\s*number\s*[;,]\s*lat)\s*:\s*number\s*[;,]?\s*\}/g;

function skipped(file) {
  return (
    file === DECLARING_FILE ||
    !/\.tsx?$/.test(file) ||
    /(^|\/)(__tests__|__mocks__|generated|node_modules)\//.test(file)
  );
}

const tracked = indexedSources(root, ['src', 'modules/veloqrs/src']);
refuseEmptyListing(tracked, 'Point shape guard');

const failures = [];
for (const [file, bytes] of tracked) {
  if (skipped(file)) continue;
  const text = bytes.toString('utf8');
  for (const match of text.matchAll(SHAPE)) {
    const line = text.slice(0, match.index).split('\n').length;
    failures.push(`${file}:${line}  import LatLngShort instead of declaring the point`);
  }
}

if (failures.length > 0) {
  console.error(`The lat/lng point is declared outside coords.ts: ${failures.length}.\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Point shape guard: one declaration.');
