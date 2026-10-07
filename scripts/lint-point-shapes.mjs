#!/usr/bin/env node
// A track point has one type, `LatLng` in modules/veloqrs/src/coords.ts. A local
// copy with the same fields stops following it when a field is added or renamed,
// so the decoder and the screen type their points apart.
//
// Import `type LatLng` from `@/shared/geo/polyline`. A fix-shaped point, such as
// a live recording position, is a different fact and takes a different name.

import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeSources } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--root');
const ROOT = i === -1 ? join(HERE, '..') : resolve(process.argv[i + 1]);

const OWNER = 'modules/veloqrs/src/coords.ts';
const DECLARATION = /^\s*(?:export\s+)?(?:interface|type)\s+(LatLng|GpxPoint|RawGpsPoint)\b/;

export const localPointShapes = (rel, source) => {
  if (rel === OWNER) return [];
  const found = [];
  source.split('\n').forEach((text, n) => {
    if (DECLARATION.test(text)) found.push(n + 1);
  });
  return found;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const hits = [];
  for (const [rel, bytes] of treeSources(ROOT, ['src', 'modules/veloqrs/src'])) {
    if (!/\.(ts|tsx)$/.test(rel)) continue;
    for (const line of localPointShapes(rel, bytes.toString('utf8'))) hits.push(`${rel}:${line}`);
  }
  if (hits.length === 0) {
    console.log('Point shape guard: LatLng is declared once.');
    process.exit(0);
  }
  console.error('A track point is declared locally. Import type LatLng from @/shared/geo/polyline:\n');
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
