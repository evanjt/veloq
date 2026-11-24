#!/usr/bin/env node
// A generated export keeps its generated name on its way out of the veloqrs barrel.
//
// `export * from './generated/veloqrs'` already exports every `Ffi` name. A
// renamed copy (`FfiCallKind as CallKind`) gave one export two names, so a
// reader met both and a stub had to mirror whichever one a file chose.

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const BARREL = 'modules/veloqrs/src/index.ts';
const RENAME = /\bFfi\w+\s+as\s+\w+/g;

const tracked = indexedSources(root, ['modules/veloqrs/src']);
refuseEmptyListing(tracked, 'Generated name alias guard');

const bytes = tracked.get(BARREL);
if (!bytes) {
  console.error(`${BARREL} is not tracked.`);
  process.exit(1);
}

const text = bytes.toString('utf8');
const failures = [];
for (const match of text.matchAll(RENAME)) {
  const line = text.slice(0, match.index).split('\n').length;
  failures.push(`${BARREL}:${line}  ${match[0]}: export the generated name unchanged`);
}

if (failures.length > 0) {
  console.error(`Generated exports renamed on the way out of the barrel: ${failures.length}.\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Generated name alias guard: no renamed exports.');
