#!/usr/bin/env npx tsx
/**
 * Refuse a commit carrying unformatted Rust.
 *
 * Runs only when the staged set contains a `.rs` file this repository owns, so
 * a TypeScript-only commit pays nothing. See lib/rustFmtGate.ts for why this
 * is rustfmt per file rather than `cargo fmt` over the crate.
 */

import { execFileSync, spawnSync } from 'child_process';

import { EDITION, parseStagedList, stagedRustFiles } from './lib/rustFmtGate';

function staged(): string[] {
  const raw = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'], {
    encoding: 'utf-8',
  });
  return stagedRustFiles(parseStagedList(raw));
}

const files = staged();
if (files.length === 0) {
  process.exit(0);
}

const result = spawnSync('rustfmt', [`--edition=${EDITION}`, '--check', ...files], {
  encoding: 'utf-8',
});

if (result.error) {
  console.error('Refusing to commit: rustfmt is not on PATH and Rust files are staged.');
  console.error('Install it with `rustup component add rustfmt`, or unstage the Rust changes.');
  process.exit(1);
}

if (result.status === 0) {
  process.exit(0);
}

console.error(`Refusing to commit: ${files.length} staged Rust file(s) are not rustfmt clean.`);
console.error('');
console.error(result.stdout?.trim() ?? '');
console.error(result.stderr?.trim() ?? '');
console.error('');
console.error('Run `cd modules/veloqrs/rust && cargo fmt -p veloqrs`, then stage the result.');
process.exit(1);
