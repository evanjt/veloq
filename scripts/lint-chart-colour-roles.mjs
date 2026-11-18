#!/usr/bin/env node
// A token family is read only by the files whose role it names: see scripts/lib/chartColourRoles.mjs.

import { checkChartColourRoles } from './lib/chartColourRoles.mjs';
import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const tracked = indexedSources(root, ['web/connect']);
refuseEmptyListing(tracked, 'Chart colour role guard');

const files = new Map();
for (const [file, bytes] of tracked) {
  if (/\.(tsx?|css)$/.test(file)) files.set(file, bytes.toString('utf8'));
}

const failures = checkChartColourRoles(files);
if (failures.length > 0) {
  console.error(`A chart colour is read outside its role: ${failures.length}.\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Chart colour role guard: every token family is read by its own files.');
