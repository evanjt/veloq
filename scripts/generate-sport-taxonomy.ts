#!/usr/bin/env npx tsx
/**
 * Write the sport families from the Rust module that owns them.
 *
 * Usage:
 *   npx tsx scripts/generate-sport-taxonomy.ts
 *   npx tsx scripts/generate-sport-taxonomy.ts --check   # exit 1 on drift
 */

import * as fs from 'fs';
import * as path from 'path';

import { trackedText } from './lib/indexedSources.mjs';
import { readRustSportDisplayGroups, readRustSportFamilies, renderSportTaxonomy } from './lib/sportTaxonomy';

const REPO = path.resolve(__dirname, '..');
const RUST = 'modules/veloqrs/rust/veloqrs/src/sport.rs';
const OUT_REL = 'src/shared/native/sportTaxonomy.generated.ts';
const OUT = path.join(REPO, OUT_REL);

const CHECK = process.argv.includes('--check');
const source = CHECK ? (trackedText(REPO, RUST) ?? '') : fs.readFileSync(path.join(REPO, RUST), 'utf-8');
const rendered = renderSportTaxonomy(readRustSportFamilies(source), readRustSportDisplayGroups(source));

if (CHECK) {
  const current = trackedText(REPO, OUT_REL) ?? '';
  if (current === rendered) {
    console.log('Sport taxonomy is up to date with the Rust source.');
    process.exit(0);
  }
  console.error('src/shared/native/sportTaxonomy.generated.ts is behind sport.rs.');
  console.error('Run: npm run config:sports');
  process.exit(1);
}

fs.writeFileSync(OUT, rendered);
console.log(`Wrote ${path.relative(REPO, OUT)}`);
