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

import { readRustSportFamilies, renderSportTaxonomy } from './lib/sportTaxonomy';

const REPO = path.resolve(__dirname, '..');
const RUST = path.join(REPO, 'modules/veloqrs/rust/veloqrs/src/sport.rs');
const OUT = path.join(REPO, 'src/shared/native/sportTaxonomy.generated.ts');

const rendered = renderSportTaxonomy(readRustSportFamilies(fs.readFileSync(RUST, 'utf-8')));
const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : '';

if (process.argv.includes('--check')) {
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
