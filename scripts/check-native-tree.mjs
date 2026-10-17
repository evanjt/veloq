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
// that gives the tree an installation of its own. It also refuses an
// installation the worklets lifecycle repair never reached, because that app
// keeps a vsync loop running while Android caches it and is killed for CPU, and
// one the screens sheet width patch never reached, because that app draws every
// sheet across the full width of a tablet, and one the screens sheet hide patch never
// reached, because that app lets a drag dismiss a sheet that is meant to stay on screen.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SYNC as SYNC_WIDGETS, hasWidgetTree, widgetDrift } from './lib/androidWidgetSources.mjs';

export const SETUP = 'npm run setup:native';

const REPAIR_WORKLETS = 'node scripts/patch-worklets-lifecycle.js';
const { applyPatch: repairWorklets } = createRequire(import.meta.url)(
  './patch-worklets-lifecycle.js'
);
const PATCH_SCREENS = 'node scripts/patch-screens-sheet-width.js';
const { applyPatch: patchScreens } = createRequire(import.meta.url)(
  './patch-screens-sheet-width.js'
);
const PATCH_SCREENS_HIDE = 'node scripts/patch-screens-sheet-hide.js';
const { applyPatch: patchScreensHide } = createRequire(import.meta.url)(
  './patch-screens-sheet-hide.js'
);

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
  if (found.length > 0) {
    report(root, found);
    process.exit(1);
  }
  const problem = patchProblem(root, 'react-native-worklets', repairWorklets);
  if (problem !== null) {
    console.error('The installed react-native-worklets does not carry the lifecycle repair.');
    console.error(`  ${problem}`);
    console.error('A build here would keep scheduling frames while Android caches the app,');
    console.error('and Android kills a cached process for that CPU. Repair it, then build again:');
    console.error(`  ${REPAIR_WORKLETS}`);
    process.exit(1);
  }
  const screens = patchProblem(root, 'react-native-screens', patchScreens);
  if (screens !== null) {
    console.error('The installed react-native-screens does not carry the sheet width patch.');
    console.error(`  ${screens}`);
    console.error('A build here would draw every sheet across the full width of a tablet.');
    console.error('Patch it, then build again:');
    console.error(`  ${PATCH_SCREENS}`);
    process.exit(1);
  }
  const hide = patchProblem(root, 'react-native-screens', patchScreensHide);
  if (hide !== null) {
    console.error('The installed react-native-screens does not carry the sheet hide patch.');
    console.error(`  ${hide}`);
    console.error('A build here would let a drag dismiss a sheet that is meant to stay on screen.');
    console.error('Patch it, then build again:');
    console.error(`  ${PATCH_SCREENS_HIDE}`);
    process.exit(1);
  }
}

/**
 * Why the installed `name` lacks what `apply` writes into it, or null when it carries it.
 * An installation without the package has nothing to patch.
 */
function patchProblem(root, name, apply) {
  if (!existsSync(join(root, 'node_modules', name))) return null;
  try {
    apply(root, true);
    return null;
  } catch (error) {
    return error.message;
  }
}

/**
 * Exit 1 naming what differs when the build tree's widget sources are not the tracked ones.
 * A tree with no Android project or no tracked widgets has nothing to compare.
 */
export async function requireWidgetSources(root) {
  if (!hasWidgetTree(root)) return;
  const lines = await widgetDrift(root);
  if (lines.length === 0) return;
  console.error('The Android build tree holds widget sources that are not the tracked ones.');
  for (const line of lines.slice(0, 10)) console.error(`  ${line}`);
  if (lines.length > 10) console.error(`  and ${lines.length - 10} more`);
  console.error('A build here would install widgets from whenever they were last copied.');
  console.error('Copy them, then build again:');
  console.error(`  ${SYNC_WIDGETS}`);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--root');
  const root = resolve(at === -1 ? process.cwd() : argv[at + 1]);
  // Only a refusal prints, so a build log carries nothing from a tree that passed.
  requireNativeTree(root);
  // A recipe that holds the build lock copies the widgets itself and checks the result, so
  // its early installation check, made before it waits for the lock, leaves them out.
  if (!argv.includes('--installation')) await requireWidgetSources(root);
}
