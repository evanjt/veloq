#!/usr/bin/env node
// Refuse a native build from a tree whose installation is another checkout's.
//
// A worktree made for gates and merges links its `node_modules` into the main
// checkout, whole or one entry at a time, because installing for every gate
// run costs minutes and gigabytes. That is right for a typecheck and wrong for
// a build. Through those links a build compiles another checkout's engine
// module and ships it in an app that installs, launches and renders, and the
// packages that compile native code (Reanimated and Worklets write `.cxx`
// under their own package directory) share one set of outputs between every
// tree building at once.
//
// So every command that builds the app natively runs this first. It passes
// when `node_modules`, every package in it, `veloqrs` and the router app root
// all resolve inside this checkout, with `veloqrs` resolving to this
// checkout's own module, and otherwise names what escapes and the command
// that gives the tree an installation of its own.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SETUP = 'npm run setup:native';

/** The router app root: expo-router reads `src/app` when the directory exists. */
const APP_ROOT = join('src', 'app');

/** Everything in `root` that a native build would read from outside it. */
export function escapes(root) {
  const home = realpathSafe(root) ?? resolve(root);
  const inside = (path) => path !== null && (path === home || path.startsWith(home + sep));
  const found = [];

  const modules = join(root, 'node_modules');
  const installed = realpathSafe(modules);
  if (installed === null) {
    return [{ name: 'node_modules', target: null }];
  }
  if (!inside(installed)) {
    return [{ name: 'node_modules', target: installed }];
  }

  for (const name of packages(modules)) {
    const target = realpathSafe(join(modules, name));
    if (!inside(target)) found.push({ name: join('node_modules', name), target });
  }

  const own = realpathSafe(join(root, 'modules', 'veloqrs'));
  const engine = realpathSafe(join(modules, 'veloqrs'));
  if (!inside(own)) {
    found.push({ name: join('modules', 'veloqrs'), target: own });
  }
  if (engine === null || engine !== own || !inside(engine)) {
    found.push({ name: join('node_modules', 'veloqrs'), target: engine, expected: own });
  }

  const app = realpathSafe(join(root, APP_ROOT));
  if (!inside(app)) found.push({ name: APP_ROOT, target: app });

  return found;
}

const ENGINE_SUBMODULE = 'modules/veloqrs/rust/tracematch';

/** The pin and the checked-out commit when they differ, otherwise null. */
export function submoduleDrift(pinned, head) {
  return pinned === head ? null : { pinned, head };
}

/**
 * Drift between the commit this checkout pins for the engine submodule and the one its
 * working copy holds. A tree with no git history or an uninitialised submodule has no
 * working copy to compare, so it reports none.
 */
export function engineDrift(root) {
  const dir = join(root, ENGINE_SUBMODULE);
  // An empty, uninitialised directory has no `.git` of its own, and git run inside it
  // would answer for the superproject instead.
  if (!existsSync(join(dir, '.git'))) return null;
  try {
    const git = (cwd, ...args) =>
      execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    const pinned = git(root, 'ls-tree', 'HEAD', ENGINE_SUBMODULE).split(/\s+/)[2];
    if (!pinned) return null;
    return submoduleDrift(pinned, git(dir, 'rev-parse', 'HEAD'));
  } catch {
    return null;
  }
}

/** Top-level packages, with a scope directory's members in place of the scope. */
function packages(modules) {
  const names = [];
  for (const entry of readdirSync(modules)) {
    // `.bin` links into the packages beside it, which are checked themselves.
    if (entry === '.bin' || entry === 'veloqrs') continue;
    const stat = lstatSafe(join(modules, entry));
    if (entry.startsWith('@') && stat?.isDirectory() && !stat.isSymbolicLink()) {
      for (const member of readdirSync(join(modules, entry))) names.push(join(entry, member));
    } else {
      names.push(entry);
    }
  }
  return names;
}

function report(root, found) {
  console.error('This tree cannot build the app natively: it reads from outside the checkout.');
  for (const { name, target, expected } of found.slice(0, 10)) {
    console.error(`  ${name} -> ${target ?? 'missing'}`);
    if (expected !== undefined)
      console.error(
        `    expected ${expected ?? join(root, 'modules', 'veloqrs')}, this checkout's own`
      );
  }
  if (found.length > 10) console.error(`  and ${found.length - 10} more`);
  console.error('');
  console.error("A build here would compile and ship that checkout's code, and share");
  console.error('its native build outputs with every tree building at the same time.');
  console.error('Give this tree an installation of its own, then build again:');
  console.error(`  ${SETUP}`);
}

function realpathSafe(path) {
  try {
    return realpathSync(path);
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

/** Exit 1 with the report when `root` cannot build natively. */
export function requireNativeTree(root) {
  const drift = engineDrift(root);
  if (drift !== null) {
    console.error('The engine submodule is not at the commit this checkout pins.');
    console.error(`  pinned       ${drift.pinned}`);
    console.error(`  checked out  ${drift.head}`);
    console.error('A build here would compile that engine and stamp the build with this commit.');
    console.error('Bring it to the pin, then build again:');
    console.error(`  git submodule update --checkout ${ENGINE_SUBMODULE}`);
    process.exit(1);
  }
  const found = escapes(root);
  if (found.length === 0) return;
  report(root, found);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--root');
  const root = resolve(at === -1 ? process.cwd() : argv[at + 1]);
  // Only a refusal prints, so a build log carries nothing from a tree that passed.
  requireNativeTree(root);
}
