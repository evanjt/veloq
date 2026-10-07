#!/usr/bin/env node
// The lint script holds the tree at zero warnings, and only that, and keeps its
// content cache in the checkout it describes.
//
// ESLint obeys whatever `--max-warnings` the lint script passes, so a commit
// that raised it beside a matching new warning passed every gate that read the
// number from the tree it judged. A second flag beside the zero is refused too:
// it would be the one ESLint obeys or the one a reader believes, and neither is
// safe.
//
// ESLint names a cache file inside a cache directory by a hash of the working
// directory, and every worktree links its node_modules to the main checkout's.
// A cache there left one file behind for each worktree ever made, for good. A
// location inside the checkout goes when the checkout goes.
//
// Reads the staged package.json in a checkout, since that is what the commit
// records, or the file given as the one argument, which the merge gate passes
// for its merged copy and the tests pass for a fixture.
// A checkout is read through git (the staged file), and the disk is read on purpose only for
// a root that is not a checkout or a file the caller names.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function git(args) {
  const run = spawnSync('git', args, { encoding: 'utf8' });
  if (run.error) {
    console.error(
      `lint-zero-warnings: git could not be run, so nothing was checked: ${run.error.message}`
    );
    process.exit(1);
  }
  return run;
}

// Only a directory that is not a checkout reads the disk. In a checkout a
// failed read of the staged copy, a blob pruned from the object store, used to
// fall back to the working copy too, which judged a package.json the commit was
// not recording.
function source(path) {
  if (path) return readFileSync(path, 'utf8');
  const staged = git(['show', ':package.json']);
  if (staged.status === 0) return staged.stdout;
  if (git(['rev-parse', '--git-dir']).status !== 0) return readFileSync('package.json', 'utf8');
  console.error(
    'lint-zero-warnings: could not read the staged package.json, so nothing was checked'
  );
  console.error(`  ${(staged.stderr ?? '').trim() || `git show exited ${staged.status}`}`);
  process.exit(1);
}

const pkg = JSON.parse(source(process.argv[2]));
const lint = pkg.scripts?.lint ?? '';
let failed = false;

const flags = lint.match(/--max-warnings[= ]\S+/g) ?? [];
if (!(flags.length === 1 && /[= ]0$/.test(flags[0]))) {
  failed = true;
  console.error(
    "lint-zero-warnings: package.json's lint script must pass --max-warnings 0, and only that"
  );
  console.error(`  found: ${flags.length > 0 ? flags.join(', ') : 'no --max-warnings flag'}`);
  console.error('  fix the warnings, or disable one line with its reason; the number is not raised');
}

// With no location ESLint writes `.eslintcache` where it runs, which is the
// checkout root.
const shared = (lint.match(/--cache-location[= ](\S+)/g) ?? []).filter((flag) => {
  const location = flag.replace(/^--cache-location[= ]/, '').replace(/^\.\//, '');
  return (
    location.startsWith('/') ||
    location.split('/').includes('..') ||
    location.split('/')[0] === 'node_modules'
  );
});
if (shared.length > 0) {
  failed = true;
  console.error(
    "lint-zero-warnings: package.json's lint script must keep --cache-location in the checkout"
  );
  console.error(`  found: ${shared.join(', ')}`);
  console.error(
    '  node_modules is shared by every worktree and outside the checkout nothing removes it;'
  );
  console.error('  use a gitignored file at the root, such as .eslintcache');
}

process.exit(failed ? 1 : 0);
