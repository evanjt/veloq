#!/usr/bin/env node
// The tracematch pointer and the tracematch working tree are two facts, and
// nothing keeps them together.
//
// `git ls-tree HEAD` says which commit this branch wants. The submodule's own
// HEAD says which one is on disk. A merge moves the first and leaves the second
// where it was, and every Rust build from that tree then compiles the detector
// on disk rather than the one the commit names: `cargo test` passes, a bitwise
// gate goes green, and a release build ships it. `git status` shows one line,
// `M modules/veloqrs/rust/tracematch`, which reads like the clone recipe's usual
// noise beside an agent's own edits.
//
// Absent is not wrong. A fresh worktree has no submodule until the clone recipe
// runs, and a directory with no repository in it is the same state one step on.
// A detached HEAD equal to the pointer is exactly right and is what every
// worktree has.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// `cwd` does not decide which repository git reads: the pre-commit hook exports
// GIT_DIR and GIT_COMMON_DIR and those win, so a guard pointed at a fixture
// would read this repository instead. Drop them, the same way
// `lint-module-link.mjs` does.
const GIT_ENV = (() => {
  const env = { ...process.env };
  for (const key of [
    'GIT_DIR',
    'GIT_INDEX_FILE',
    'GIT_WORK_TREE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_COMMON_DIR',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_PREFIX',
    'GIT_CEILING_DIRECTORIES',
  ]) {
    delete env[key];
  }
  return env;
})();

const SUB = 'modules/veloqrs/rust/tracematch';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

const path = join(root, SUB);
if (!existsSync(path) || !existsSync(join(path, '.git'))) {
  process.exit(0);
}

const recorded = pointer();
const checked = git(['rev-parse', 'HEAD'], path);
if (!recorded || !checked || recorded === checked) {
  process.exit(0);
}

const short = (sha) => sha.slice(0, 7);
console.error('The tracematch working tree is not the commit this branch records:');
console.error(`  recorded ${short(recorded)}  ${subject(recorded) ?? ''}`);
console.error(`  on disk  ${short(checked)}  ${subject(checked) ?? ''}`);
console.error('');
console.error('Every Rust build here compiles what is on disk, so a test or a bitwise gate');
console.error('passes against a detector this commit does not name. Bring the tree to the');
console.error('pointer:');
console.error(`  git submodule update --checkout ${SUB}`);
console.error('');
console.error('If the tree is the one you want, move the pointer instead, with a commit that');
console.error('says so.');
process.exit(1);

/** The commit the tree records for the submodule, or null when it records none. */
function pointer() {
  const line = git(['ls-tree', 'HEAD', SUB], root);
  if (!line) return null;
  const match = /^160000 commit ([0-9a-f]{40})\t/.exec(line);
  return match ? match[1] : null;
}

function subject(sha) {
  return git(['log', '-1', '--format=%s', sha], path);
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      env: GIT_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}
