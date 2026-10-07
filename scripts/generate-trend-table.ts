#!/usr/bin/env npx tsx
/**
 * Write the trend thresholds from the Rust source they live in.
 *
 * Usage:
 *   npx tsx scripts/generate-trend-table.ts
 *   npx tsx scripts/generate-trend-table.ts --check   # exit 1 on drift
 */

import * as fs from 'fs';
import * as path from 'path';

import { trackedText } from './lib/indexedSources.mjs';
import { readRustTrendMetrics, renderTrendTable } from './lib/trendTable';

const REPO = path.resolve(__dirname, '..');
const RUST = 'modules/veloqrs/rust/veloqrs/src/trend_table.rs';
const OUT_REL = 'src/shared/format/trendTable.generated.ts';
const OUT = path.join(REPO, OUT_REL);

const CHECK = process.argv.includes('--check');
const source = CHECK ? (trackedText(REPO, RUST) ?? '') : fs.readFileSync(path.join(REPO, RUST), 'utf-8');
const rendered = renderTrendTable(readRustTrendMetrics(source));

if (CHECK) {
  const current = trackedText(REPO, OUT_REL) ?? '';
  if (current === rendered) {
    console.log('Trend thresholds are up to date with the Rust table.');
    process.exit(0);
  }
  console.error('src/shared/format/trendTable.generated.ts is behind the Rust table.');
  console.error('Run: npm run config:trend');
  process.exit(1);
}

fs.writeFileSync(OUT, rendered);
console.log(`Wrote ${path.relative(REPO, OUT)}`);
