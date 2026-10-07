#!/usr/bin/env node
// Give a worktree an installation of its own, so it can build the app natively.
//
// A worktree made for gates links its `node_modules` into the main checkout,
// and `scripts/check-native-tree.mjs` refuses to build from it. This replaces
// those links with a lockfile install into the worktree, where `veloqrs` links
// to the worktree's own module and the packages that compile native code write
// their outputs under this tree alone.
//
// The links are removed here, before npm runs, and never through: `npm ci`
// clears `node_modules` itself, and through a link that is the installation
// every other checkout builds and tests against. Removing a link removes the
// link, and removing a directory of links removes the links, so what they
// point at is untouched either way.
//
// The main checkout is refused. Its installation is the one every gate-only
// worktree links into, and replacing it under a running fleet breaks them all.

import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { escapes, SETUP } from './check-native-tree.mjs';

// `cwd` does not decide which repository git reads: a hook exports GIT_DIR and
// GIT_COMMON_DIR and those win.
const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));

const argv = process.argv.slice(2);
const at = argv.indexOf('--root');
const root = resolve(at === -1 ? process.cwd() : argv[at + 1]);
// The override is for the test, which cannot run a real install.
const npm = process.env.VELOQ_NPM || 'npm';

const main = mainCheckout(root);
if (main === null || realpathSync(main) === realpathSync(root)) {
  console.error(`setup-native: ${root} is the main checkout, or no worktree at all.`);
  console.error('Its node_modules is the installation every gate-only worktree links into,');
  console.error('so it is not reinstalled from here. Run this from a linked worktree.');
  process.exit(1);
}

const modules = join(root, 'node_modules');
const existing = lstatSafe(modules);
if (existing?.isSymbolicLink()) {
  unlinkSync(modules);
} else if (existing) {
  rmSync(modules, { recursive: true, force: true });
}

const install = spawnSync(npm, ['ci'], { cwd: root, stdio: 'inherit' });
if (install.error) {
  console.error(`setup-native: could not run ${npm}: ${install.error.message}`);
  process.exit(1);
}
if (install.status !== 0) {
  console.error(`setup-native: ${npm} ci failed${install.signal ? ` (${install.signal})` : ''}.`);
  process.exit(install.status ?? 1);
}

const found = escapes(root);
if (found.length > 0) {
  console.error('setup-native: the installation still reads from outside the checkout:');
  for (const { name, target } of found) console.error(`  ${name} -> ${target ?? 'missing'}`);
  console.error('The lockfile install should link veloqrs to ./modules/veloqrs and put every');
  console.error(`package under this tree; ${SETUP} gives the same result until it does.`);
  process.exit(1);
}

console.log(`setup-native: ${root} has an installation of its own and can build natively.`);

/** The checkout the shared git directory lives in, or null outside a repository. */
function mainCheckout(from) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: from,
      env: GIT_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
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
