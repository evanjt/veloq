#!/usr/bin/env node
// A linked worktree's `node_modules` is its own install or the main checkout's.
//
// A job tree an earlier job used can still carry a whole-directory link into
// another job tree's install. That install may lack packages this tree's Jest
// config names, and the suite then fails at config validation, which reads as a
// broken branch. A link to the main checkout's install is the documented gate
// setup and is left alone. Anything else is refused: run
// `scripts/provision-job-tree.sh`, which replaces it.

import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
);

const argv = process.argv.slice(2);
const at = argv.indexOf('--root');
const root = resolve(at === -1 ? process.cwd() : argv[at + 1]);
const modules = join(root, 'node_modules');

const gitDir = git(['rev-parse', '--path-format=absolute', '--git-dir']);
const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
const isLinked =
  gitDir !== '' && commonDir !== '' && realpathSafe(gitDir) !== realpathSafe(commonDir);

if (isLinked && lstatSafe(modules)?.isSymbolicLink()) {
  const target = realpathSafe(modules);
  const main = realpathSafe(join(dirname(commonDir), 'node_modules'));
  if (target === null || target !== main) {
    console.error(`node_modules is a link to ${target ?? 'a path that does not exist'}.`);
    console.error("That is not the main checkout's install, so it may lack packages this");
    console.error("tree's Jest config names, and the suite fails at config validation.");
    console.error('Replace it with an install made for this tree:');
    console.error('  scripts/provision-job-tree.sh');
    process.exit(1);
  }
}
console.log('Node modules link: this checkout resolves its own install.');

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      env: GIT_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function lstatSafe(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function realpathSafe(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}
