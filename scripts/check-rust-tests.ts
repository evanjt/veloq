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
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';

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

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim();
}

// The tree being committed, read from git rather than from where this script
// sits, so the check and the cargo run are about the same checkout.
const root = git(['rev-parse', '--show-toplevel']);
const SUBMODULE = 'modules/veloqrs/rust/tracematch';

// The workspace names tracematch as a member, so without it cargo cannot load
// the workspace at all, and most worktrees run with the directory empty. That
// failure is not a test caller and must not read like one. The same presence
// test as `lint-submodule-pointer.mjs`: the path exists and holds a `.git`.
const submodule = join(root, SUBMODULE);
if (!existsSync(submodule) || !existsSync(join(submodule, '.git'))) {
  const main = dirname(resolve(root, git(['rev-parse', '--git-common-dir'])));
  console.error(`Refusing to commit: the tracematch submodule is absent at ${SUBMODULE},`);
  console.error('so cargo cannot load the workspace and the Rust test tree cannot be built.');
  console.error('');
  console.error('Clone it from the main checkout at the pinned sha, from the root of this tree:');
  console.error('');
  console.error(`  sha=$(git ls-tree HEAD ${SUBMODULE} | awk '{print $3}')`);
  console.error(`  rmdir ${SUBMODULE}`);
  console.error(`  git clone --no-checkout ${main}/${SUBMODULE} ${SUBMODULE}`);
  console.error(`  git -C ${SUBMODULE} checkout "$sha"`);
  console.error('');
  console.error('Never cd into the empty directory to run git: it runs against this tree.');
  console.error('Or drop this one gate and keep the rest: VELOQ_SKIP_GATES=rusttests git commit ...');
  process.exit(1);
}

const result = spawnSync('cargo', ['check', '--tests', '-p', 'veloqrs'], {
  cwd: join(root, 'modules', 'veloqrs', 'rust'),
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

const stderr = result.stderr?.trim() ?? '';
console.error('Refusing to commit: the Rust test tree does not build.');
console.error('');
console.error(stderr);
console.error('');
// A manifest cargo could not load is a broken checkout, not a broken caller.
if (/failed to (load|read|parse) manifest/.test(stderr)) {
  console.error('cargo could not load the workspace, so no test was built. Fix the manifest');
  console.error('or the submodule it names above, then commit again.');
  process.exit(1);
}
console.error('A test is the only caller of something this commit changed. Run');
console.error('`cd modules/veloqrs/rust && cargo check --tests -p veloqrs` and fix the callers.');
process.exit(1);
