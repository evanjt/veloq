#!/usr/bin/env node
// `node_modules/veloqrs` is one symlink for the whole machine.
//
// A worktree links its entire `node_modules` to the main checkout's, so there
// is exactly one `veloqrs` entry no matter how many trees are open. Repointing
// it at a worktree, which is what a native build there needs, repoints it for
// the main checkout and for every other worktree at the same time. What follows
// is quiet: `tsc` reports missing methods that exist in the tree you are in and
// not in that one, and Metro and a release bundle resolve it the same way, so a
// build taken anywhere else ships that branch's engine module and still
// launches.
//
// Two targets are right, and only two. The checkout this runs in, which is the
// tree that repointed it for a build, and the main checkout, which is where it
// rests and what every worktree's typecheck is documented to read. A third tree
// is wrong for whoever is running, and that is the case this refuses.

import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// `cwd` does not decide which repository git reads. The pre-commit hook exports
// GIT_DIR and GIT_COMMON_DIR, and those win, so a guard pointed at a fixture
// with --root would find the repository's own main checkout instead. Drop them.
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

const link = join(root, 'node_modules', 'veloqrs');
const entry = lstatSafe(link);

// No entry at all is an install that has not been run, and that fails loudly
// enough on its own. A real directory is the other way out of this, a per-tree
// copy beside the shared `node_modules`, and it cannot point anywhere.
if (!entry || !entry.isSymbolicLink()) {
  process.exit(0);
}

const target = realpathSafe(link);
const own = realpathSafe(join(root, 'modules', 'veloqrs'));
const shared = mainCheckoutModule(root);

if (target && own && target !== own && target !== shared) {
  console.error('node_modules/veloqrs resolves to a checkout that is neither this one');
  console.error('nor the main one:');
  console.error(`  points at ${target}`);
  console.error(`  this tree ${own}`);
  if (shared) console.error(`  main tree ${shared}`);
  console.error('');
  console.error('Every worktree shares this one link, so a typecheck or a native build');
  console.error('anywhere reads that tree instead of its own. Put it back:');
  console.error(`  rm node_modules/veloqrs && ln -s ${shared ?? own} node_modules/veloqrs`);
  process.exit(1);
}

/** The main checkout's module, found through the shared git directory. */
function mainCheckoutModule(from) {
  try {
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: from, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    return realpathSafe(join(dirname(common), 'modules', 'veloqrs'));
  } catch {
    return null;
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
