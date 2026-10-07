#!/usr/bin/env node
// Point the tracematch submodule at its own tracked hooks.
//
// tracematch's pre-commit refuses GPS traces, but git runs it only where
// `core.hooksPath` is `.githooks`, and that is per-clone config. The submodule
// is the one tracematch checkout that takes commits, and no clone of it ever
// had the setting, so personal traces committed there met no hook at all.
//
// `prepare` and the pre-commit battery both run this, so a submodule cloned
// after the worktree was made is picked up at the next commit. It is
// re-runnable and changes nothing once the setting is in place.

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

// `cwd` does not decide which repository git reads: a hook exports GIT_DIR and
// GIT_COMMON_DIR and those win, which would write this config into veloq.
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
const HOOKS = '.githooks';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);
const path = join(root, SUB);

// An empty submodule directory has no repository, and git run there resolves
// to veloq itself, so the setting would switch off every one of veloq's hooks.
// A pin with no `.githooks` would do the same to tracematch's.
if (!existsSync(join(path, '.git')) || !existsSync(join(path, HOOKS))) {
  process.exit(0);
}
// A gitfile naming a git directory that is gone makes every git call here fail,
// and `prepare` failing would fail `npm install` with it.
let top = '';
try {
  top = realpathSync(git(['rev-parse', '--show-toplevel']));
} catch {
  console.log(`tracematch hooks: ${SUB} is not a readable repository, nothing linked.`);
  process.exit(0);
}
if (top !== realpathSync(path)) {
  process.exit(0);
}

let current = '';
try {
  current = git(['config', '--local', '--get', 'core.hooksPath']);
} catch {
  // Unset, which is what this is here to fix.
}
if (current !== HOOKS) {
  git(['config', '--local', 'core.hooksPath', HOOKS]);
  console.log(`tracematch hooks: core.hooksPath -> ${HOOKS}`);
}

function git(args) {
  return execFileSync('git', args, {
    cwd: path,
    env: GIT_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
