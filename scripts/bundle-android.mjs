#!/usr/bin/env node
// Embed the JavaScript bundle the Android build packages.
//
// A linked worktree shares the main checkout's `node_modules`, and metro keys
// its transform cache on the path it resolves through. So the worktree's
// expo-router entry comes back from the cache with the main checkout's app
// root baked in, matches nothing, and the bundle lands at 2.5 MB carrying no
// screen. `--reset-cache` is the only thing that separates the two, and it
// costs about a minute, so it is passed where it is needed and nowhere else.
//
// `scripts/lint-android-bundle.mjs` is the other half: it refuses a bundle
// that carries none of the app, whichever tree wrote it.
//
// The export also regenerates the UniFFI bindings, through the bindgen's own
// hook, and that generator writes em dashes into its comments. `npm run audit`
// refuses those across the whole tree, so a device build left two generated
// files dirty and every session's commit and merge failed on a file nobody had
// touched. `modules/veloqrs/scripts/fix-generated.sh` is what strips them, and
// it runs here so no path can produce unfixed bindings.

import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLE = 'android/app/src/main/assets/index.android.bundle';

/** The fixups every regeneration owes, whichever command regenerated. */
export const FIXER = 'modules/veloqrs/scripts/fix-generated.sh';

/** A linked worktree carries `.git` as a file pointing at the common directory. */
export function isLinkedWorktree(root) {
  try {
    return statSync(join(root, '.git')).isFile();
  } catch {
    return false;
  }
}

export function bundleArgs(root) {
  return [
    'expo',
    'export:embed',
    '--platform',
    'android',
    '--dev',
    'false',
    ...(isLinkedWorktree(root) ? ['--reset-cache'] : []),
    '--bundle-output',
    BUNDLE,
    '--assets-dest',
    'android/app/src/main/res',
  ];
}

/**
 * Where the fixer is, and where to run it from.
 *
 * Absolute, because the `cwd` handed to the spawn is the module directory and a
 * relative command resolves against that: `modules/veloqrs/scripts/...` became
 * `modules/veloqrs/modules/veloqrs/scripts/...`, `spawnSync` answered ENOENT,
 * and the bundle step exited 1 after writing a perfectly good bundle. Nothing
 * said so, because a spawn that never starts prints nothing.
 */
export function fixerSpawn(root) {
  return { command: join(root, FIXER), cwd: join(root, 'modules', 'veloqrs') };
}

const args = bundleArgs(process.cwd());

if (process.argv.includes('--print-args')) {
  console.log(args.join(' '));
} else if (process.argv.includes('--print-fixer')) {
  const { command, cwd } = fixerSpawn(process.cwd());
  console.log(`${command}\n${cwd}`);
} else {
  const run = spawnSync('npx', args, { stdio: 'inherit' });
  // A spawn that never starts answers a null status with the reason in
  // `error`, and `stdio: 'inherit'` prints nothing because there was no child
  // to inherit anything. Left unreported it is a bare exit 1 in front of a
  // thirteen-minute wait for the Android lock, which is what SB23 cost twice.
  if (run.error) {
    console.error(`bundle-android: could not run npx: ${run.error.message}`);
    process.exit(1);
  }
  if (run.status !== 0) process.exit(run.status);

  const { command, cwd } = fixerSpawn(process.cwd());
  const fix = spawnSync(command, [], { cwd, stdio: 'inherit' });
  if (fix.error) {
    console.error(`bundle-android: could not run ${command}: ${fix.error.message}`);
    process.exit(1);
  }
  process.exit(fix.status ?? 1);
}
