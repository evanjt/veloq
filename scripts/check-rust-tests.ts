#!/usr/bin/env npx tsx
/**
 * Refuse a commit whose Rust does not build the test tree.
 *
 * `cargo check` of the library passes when the only caller of a deleted method
 * is a test, and the merge battery builds only the suites the merge touched. So
 * a deletion whose caller lives in a suite nothing else names left
 * `cargo check --tests` broken on main, with every Rust integration test
 * silently not building, until somebody needed one.
 *
 * Runs only when the staged set holds a `.rs` file this repository owns, so a
 * TypeScript-only commit pays nothing. Measured on 2026-09-13 with the fleet
 * active: 1 m 10 s cold, 0.2 s warm, so the cost falls on the commit that
 * changed Rust and on nobody else.
 */

import { execFileSync, spawnSync } from 'child_process';
import { join } from 'path';

import { parseStagedList, stagedRustFiles } from './lib/rustFmtGate';

function staged(): string[] {
  const raw = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMRD', '-z'], {
    encoding: 'utf-8',
  });
  return stagedRustFiles(parseStagedList(raw));
}

if (staged().length === 0) {
  process.exit(0);
}

const result = spawnSync('cargo', ['check', '--tests', '-p', 'veloqrs'], {
  cwd: join(__dirname, '..', 'modules', 'veloqrs', 'rust'),
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.error) {
  console.error('Refusing to commit: cargo is not on PATH and Rust files are staged.');
  process.exit(1);
}

if (result.status === 0) {
  process.exit(0);
}

console.error('Refusing to commit: the Rust test tree does not build.');
console.error('');
console.error(result.stderr?.trim() ?? '');
console.error('');
console.error('A test is the only caller of something this commit changed. Run');
console.error('`cd modules/veloqrs/rust && cargo check --tests -p veloqrs` and fix the callers.');
process.exit(1);
