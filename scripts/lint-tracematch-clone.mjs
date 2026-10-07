#!/usr/bin/env node
// A linked worktree's tracematch tree must be a clone of its own.
//
// Jobs build side by side, and a tracematch directory that links to the main
// checkout's, or whose git directory lives there, is one working tree read by
// every job. The second job to commit then carries the first job's uncommitted
// detector edits under its own message, and the pointer move trips the bitwise
// gate at landing. Clone it at the pinned sha instead, the recipe in
// REFERENCE.md, "Worktrees".
//
// The main checkout and an empty submodule directory are left alone.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
);

const SUB = 'modules/veloqrs/rust/tracematch';

const argv = process.argv.slice(2);
const at = argv.indexOf('--root');
const root = resolve(at === -1 ? process.cwd() : argv[at + 1]);
const path = join(root, SUB);

const gitDir = git(root, ['rev-parse', '--path-format=absolute', '--git-dir']);
const commonDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
const isLinked =
  gitDir !== '' && commonDir !== '' && realpathSync(gitDir) !== realpathSync(commonDir);

if (!isLinked || !existsSync(path)) done();

if (lstatSync(path).isSymbolicLink()) {
  refuse(`${SUB} is a link to ${realpathSync(path)}.`);
}
if (existsSync(join(path, '.git'))) {
  const own = git(path, ['rev-parse', '--path-format=absolute', '--absolute-git-dir']);
  const tree = realpathSync(root) + sep;
  if (own === '' || !realpathSync(own).startsWith(tree)) {
    refuse(
      `${SUB} keeps its git directory at ${own || 'an unreadable path'}, outside this worktree.`
    );
  }
}
done();

function done() {
  console.log('Tracematch clone: this checkout owns its tracematch tree.');
  process.exit(0);
}

function refuse(reason) {
  console.error(reason);
  console.error('Jobs on one machine would share that tree, and one job would commit the');
  console.error("other's uncommitted edits. Replace it with a clone of its own at the pinned sha:");
  console.error(`  sha=$(git ls-tree HEAD ${SUB} | awk '{print $3}')`);
  console.error(`  rm -rf ${SUB} && git clone --no-checkout <main>/${SUB} ${SUB}`);
  console.error(`  git -C ${SUB} checkout "$sha"`);
  process.exit(1);
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      env: GIT_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}
