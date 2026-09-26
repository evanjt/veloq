#!/usr/bin/env node
// A worktree placed outside the main checkout's parent sees no `.cargo/config.toml`.
//
// Cargo resolves config from the working directory's **ancestors**, so the file
// at `~/projects/personal/intervals/.cargo/config.toml` reaches a checkout only
// if that checkout sits under that directory. It carries `[build] jobs = 8`,
// set after two builds at cargo's default of 32 jobs reached 15.5 GB, and
// `[env] TRACEMATCH_CORPUS`, which the local bitwise gates read.
//
// Nothing warns when it is missed. The build is simply faster and hungrier, and
// the corpus failure names a missing directory rather than a missing variable.
//
// CI has no such file and is not meant to: the refusal fires only when the main
// checkout resolves one and this tree does not, which is exactly the misplaced
// worktree and never a fresh clone.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// The pre-commit hook exports GIT_DIR and GIT_COMMON_DIR, and those win over
// `cwd`, so a guard pointed at a fixture would find the real repository.
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

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

// Where cargo is invoked from for this crate, and the tree whose ancestors
// therefore decide what it reads.
const crate = join(root, 'modules', 'veloqrs', 'rust');
const main = mainCheckout(root);

const here = nearestCargoConfig(crate);
if (here === null && main !== null && main !== root) {
  const theirs = nearestCargoConfig(join(main, 'modules', 'veloqrs', 'rust'));
  if (theirs !== null) {
    console.error('No .cargo/config.toml is reachable from this worktree:');
    console.error(`  this tree  ${root}`);
    console.error(`  main tree  ${main}`);
    console.error(`  its config ${theirs}`);
    console.error('');
    console.error('Cargo reads config from the working directory\'s ancestors, so a');
    console.error('worktree outside the main checkout\'s parent gets neither the job cap');
    console.error('nor TRACEMATCH_CORPUS, and nothing says so: the build is just hungrier.');
    console.error('Put the worktree under the same parent as the main checkout:');
    console.error(`  git worktree add ${join(dirname(main), 'veloq-<id>')} -b audit/<id>`);
    process.exit(1);
  }
}

/** The nearest `.cargo/config.toml` at or above `from`, or null. */
function nearestCargoConfig(from) {
  let dir = from;
  for (;;) {
    for (const name of ['config.toml', 'config']) {
      const candidate = join(dir, '.cargo', name);
      if (existsSync(candidate)) return candidate;
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** The main checkout's working tree, found through the shared git directory. */
function mainCheckout(from) {
  try {
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: from, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    return dirname(common);
  } catch {
    return null;
  }
}
