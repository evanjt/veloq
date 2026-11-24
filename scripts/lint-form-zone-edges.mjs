#!/usr/bin/env node
// A screen names no form zone edge and does no form maths.
//
// The engine states each day's form, its zone and its text in the athlete's unit, and sends the
// edges between zones with it. A TypeScript file that holds the edges, or zones or prints a form
// from loads, is a second judge that drifts from the engine: one surface then names a different
// zone, or prints a different figure, for the same day.
//
// Tests are exempt, since a fixture states what the engine answers.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseEmptyListing, treeSources } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const ROOT = resolve(flag('--root') ?? join(HERE, '..'));

const EDGE_LIST = /-30\s*,\s*-10\s*,\s*5\s*,\s*25/;
const EDGE_COMPARE = /<\s*-30\b/;
const FORM_MATHS = /\b(getFormZone|formZoneFromLoads|formatForm|formFromLoads|tsbFromLoads)\b/;

const sources = treeSources(ROOT, ['src', 'modules/veloqrs/src']);
refuseEmptyListing(sources, 'form zone edge guard');

const problems = [];
for (const [rel, bytes] of sources) {
  if (!/\.(ts|tsx)$/.test(rel)) continue;
  if (rel.includes('/__tests__/') || rel.includes('/generated/')) continue;
  bytes
    .toString('utf8')
    .split('\n')
    .forEach((text, i) => {
      if (EDGE_LIST.test(text) || EDGE_COMPARE.test(text) || FORM_MATHS.test(text)) {
        problems.push(`${rel}:${i + 1}  ${text.trim()}`);
      }
    });
}

if (problems.length > 0) {
  console.error('Form zones: the engine owns the zone edges and the form figure.\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nRead the form, zone and text the engine states for the day, and the edges it sends.'
  );
  process.exit(1);
}
console.log('form zones: no screen holds an edge or derives a form.');
