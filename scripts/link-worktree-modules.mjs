#!/usr/bin/env node
// Bring a worktree's `node_modules` back level with the main checkout's.
//
// A worktree holds a real `node_modules` directory of its own, one symlink per
// entry into the main checkout's, so `veloqrs` can point at the worktree's own
// module without repointing the one link the whole machine shares. Nothing
// refreshed that set: a package installed in the main checkout after the
// worktree was made is simply absent there, and the failure names the importer
// rather than the missing link. `@ubjs/core` arrived that way and seven suites
// read as the branch having broken the generated bindings.
//
// So this is re-runnable and runs before the gates: it adds what is missing and
// touches nothing else. `veloqrs` is never relinked, because which tree it
// should point at is the caller's business and `scripts/lint-module-link.mjs`
// is what holds that.
//
// In the main checkout, where `node_modules` is the real install, there is
// nothing to do and it says so.

import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, symlinkSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// `cwd` does not decide which repository git reads: a hook exports GIT_DIR and
// GIT_COMMON_DIR and those win, which would point a run in a fixture at this
// repository's own main checkout.
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
const root = resolve(flag('--root') ?? process.cwd());
const main = flag('--main') ? resolve(flag('--main')) : mainCheckout(root);

/** The module that belongs to the tree it is in, and is nobody else's to move. */
const OWN = 'veloqrs';

if (!main || realpathSafe(main) === realpathSafe(root)) {
  execFileSync(process.execPath, [new URL('./patch-expo-location.js', import.meta.url).pathname], { cwd: root });
  console.log('Worktree modules: this is the main checkout, nothing to link.');
  process.exit(0);
}

const here = join(root, 'node_modules');
const there = join(main, 'node_modules');

if (!lstatSafe(here)?.isDirectory() || lstatSafe(here)?.isSymbolicLink()) {
  // A whole-directory symlink is the other worktree form, and it is level with
  // the main checkout by construction. An absent one is an install that has not
  // been run, which fails loudly on its own.
  console.log('Worktree modules: no per-entry set here, nothing to link.');
  process.exit(0);
}

if (!lstatSafe(there)?.isDirectory()) {
  console.log(`Worktree modules: ${there} is not a directory, nothing to link.`);
  process.exit(0);
}

const linked = [];
for (const entry of readdirSync(there)) {
  if (entry === OWN) continue;
  const target = join(here, entry);
  if (lstatSafe(target)) continue;
  // A scope directory (`@ubjs`) is linked whole, the same as a package: the
  // worktree set is one link per entry of the main checkout's top level.
  symlinkSync(join(there, entry), target);
  linked.push(entry);
}

console.log(
  linked.length === 0
    ? 'Worktree modules: level with the main checkout.'
    : `Worktree modules: linked ${linked.length} missing (${linked.join(', ')}).`
);

// This native dependency must be copied before applying the altitude fix.
execFileSync(process.execPath, [new URL('./patch-expo-location.js', import.meta.url).pathname], { cwd: root });

function flag(name) {
  const at = argv.indexOf(name);
  return at === -1 ? null : argv[at + 1];
}

/** The checkout the shared git directory lives in, or null outside a repository. */
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
    return path;
  }
}
