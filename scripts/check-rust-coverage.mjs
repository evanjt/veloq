#!/usr/bin/env node
// A coverage floor for the veloqrs crate, per layer rather than per crate.
//
// The crate measures 82 per cent of lines and that number is carried by
// `src/persistence`. The UniFFI object layer TypeScript actually calls sits at
// 42, and a single crate-wide floor would let it stay there forever. So
// `scripts/rust-coverage-baseline.json` holds a floor per layer, seeded at what
// each measured, and a layer under its floor fails. Raise a floor when a layer
// has moved up and stayed there; never lower one.
//
// Input is the JSON `cargo llvm-cov --json` writes. The full run takes about an
// hour, so this is the nightly lane, not the pre-commit hook.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const REPORT = flagValue('--report', join(HERE, '../modules/veloqrs/rust/coverage.json'));
const BASELINE = flagValue('--baseline', join(HERE, 'rust-coverage-baseline.json'));

// The crate-relative path of a file in the report, or null for another crate.
// Report paths are absolute; the layer keys are `src/<dir>` inside veloqrs.
function crateRelative(filename) {
  const marker = '/veloqrs/';
  const i = filename.lastIndexOf(marker);
  return i === -1 ? null : filename.slice(i + marker.length);
}

function layerTotals(report, layers) {
  const totals = new Map(layers.map((layer) => [layer, { count: 0, covered: 0, files: 0 }]));
  for (const data of report.data ?? []) {
    for (const file of data.files ?? []) {
      const rel = crateRelative(file.filename);
      if (rel === null) continue;
      const layer = layers.find((l) => rel.startsWith(`${l}/`));
      if (layer === undefined) continue;
      const lines = file.summary?.lines ?? { count: 0, covered: 0 };
      const t = totals.get(layer);
      t.count += lines.count;
      t.covered += lines.covered;
      t.files += 1;
    }
  }
  return totals;
}

function main() {
  if (!existsSync(REPORT)) {
    console.error(`check-rust-coverage: no report at ${REPORT}`);
    console.error(
      '  cargo llvm-cov -p veloqrs --features synthetic --json --output-path coverage.json'
    );
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(REPORT, 'utf8'));
  const floors = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const layers = Object.keys(floors);
  const totals = layerTotals(report, layers);

  const failures = [];
  for (const layer of layers) {
    const { count, covered, files } = totals.get(layer);
    if (files === 0 || count === 0) {
      failures.push(`  ${layer}  no files in the report, floor ${floors[layer]}%`);
      continue;
    }
    const percent = (100 * covered) / count;
    const line = `  ${layer}  ${percent.toFixed(1)}%, floor ${floors[layer]}%  (${covered}/${count} lines, ${files} files)`;
    if (percent < floors[layer]) failures.push(line);
    else console.log(line);
  }

  if (failures.length > 0) {
    console.error('Rust coverage under its floor:');
    for (const f of failures) console.error(f);
    console.error('');
    console.error('Fix: cover the layer, not the floor. The floors in');
    console.error('     scripts/rust-coverage-baseline.json only ever move up.');
    process.exit(1);
  }
  console.log('check-rust-coverage: OK');
}

main();
