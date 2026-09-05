#!/usr/bin/env npx tsx
/**
 * The commands a merge's changed files call for, one per line, on stdin/stdout.
 *
 * Kept apart from the shell so the mapping is testable: which suites a merge
 * runs is the part that decides whether the gate catches anything.
 */

import { hasTargets, mergeTestTargets } from './lib/mergeTestTargets';

const changed = require('node:fs')
  .readFileSync(0, 'utf8')
  .split('\n')
  .map((line: string) => line.trim())
  .filter(Boolean);

const targets = mergeTestTargets(changed);
if (!hasTargets(targets)) process.exit(0);

const lines: string[] = [];
const cargo: string[] = [];
if (targets.rustLib) cargo.push('--lib');
for (const name of targets.rustTests) cargo.push(`--test ${name}`);
if (cargo.length > 0) {
  lines.push(
    `cargo test --manifest-path modules/veloqrs/rust/veloqrs/Cargo.toml -p veloqrs ${cargo.join(' ')}`
  );
}
if (targets.typescript.length > 0) {
  lines.push(
    `npx jest --config config/jest.config.js --findRelatedTests --passWithNoTests ${targets.typescript.join(' ')}`
  );
}

console.log(lines.join('\n'));
