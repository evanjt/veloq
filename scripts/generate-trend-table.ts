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

import { readRustTrendMetrics, renderTrendTable } from './lib/trendTable';

const REPO = path.resolve(__dirname, '..');
const RUST = path.join(REPO, 'modules/veloqrs/rust/veloqrs/src/trend_table.rs');
const OUT = path.join(REPO, 'src/shared/format/trendTable.generated.ts');

const rendered = renderTrendTable(readRustTrendMetrics(fs.readFileSync(RUST, 'utf-8')));
const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : '';

if (process.argv.includes('--check')) {
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
