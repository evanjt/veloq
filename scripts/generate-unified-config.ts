#!/usr/bin/env npx tsx
/**
 * Write the validated detector configuration from the Rust source it lives in.
 *
 * Usage:
 *   npx tsx scripts/generate-unified-config.ts
 *   npx tsx scripts/generate-unified-config.ts --check   # exit 1 on drift
 */

import * as fs from 'fs';
import * as path from 'path';

import { readRustSectionDefaults, renderUnifiedConfig } from './lib/unifiedConfig';

const REPO = path.resolve(__dirname, '..');
const RUST = path.join(REPO, 'modules/veloqrs/rust/tracematch/src/sections/mod.rs');
const OUT = path.join(REPO, 'src/shared/native/unifiedConfig.generated.ts');

const rendered = renderUnifiedConfig(readRustSectionDefaults(fs.readFileSync(RUST, 'utf-8')));
const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : '';

if (process.argv.includes('--check')) {
  if (current === rendered) {
    console.log('Unified detector config is up to date with the Rust default.');
    process.exit(0);
  }
  console.error('src/shared/native/unifiedConfig.generated.ts is behind the Rust default.');
  console.error('Run: npm run config:unified');
  process.exit(1);
}

fs.writeFileSync(OUT, rendered);
console.log(`Wrote ${path.relative(REPO, OUT)}`);
