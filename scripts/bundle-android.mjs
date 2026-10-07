#!/usr/bin/env node
// Embed the JavaScript bundle the Android build packages.
//
// The bundle is built from this checkout or not at all. A tree whose
// `node_modules` links into another checkout is refused before Metro starts,
// naming the setup command that gives it an installation of its own
// (`scripts/check-native-tree.mjs`). Metro's cache is kept: `metro.config.js`
// keys it per checkout, so a rebuild reuses this checkout's transforms and
// never another's.
//
// `scripts/lint-android-bundle.mjs` is the other half: it refuses a bundle
// that carries none of the app, whichever tree wrote it, and runs here once the
// export has written one.
//
// The export also regenerates the UniFFI bindings, through the bindgen's own
// hook, and that generator writes em dashes into its comments. `npm run audit`
// refuses those across the whole tree, so a device build left two generated
// files dirty and every session's commit and merge failed on a file nobody had
// touched. `modules/veloqrs/scripts/fix-generated.sh` is what strips them, and
// it runs here so no path can produce unfixed bindings.
//
// Once the fixer has run, the bundle is recorded with the hash of the build
// inputs it was made from (`scripts/lib/build-record.js`), which the APK build
// record reads. A bundle whose inputs moved during the export is refused.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { requireNativeTree } from './check-native-tree.mjs';

const require = createRequire(import.meta.url);
const { sourceIdentity } = require('./lib/build-stamp.js');
const { recordBundle } = require('./lib/build-record.js');

const BUNDLE = 'android/app/src/main/assets/index.android.bundle';

/** The fixups every regeneration owes, whichever command regenerated. */
export const FIXER = 'modules/veloqrs/scripts/fix-generated.sh';

export function bundleArgs() {
  return [
    'expo',
    'export:embed',
    '--platform',
    'android',
    '--dev',
    'false',
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

const args = bundleArgs();

if (
  !process.argv.includes('--print-fixer') &&
  process.env.NODE_ENV &&
  process.env.NODE_ENV !== 'production'
) {
  console.error('bundle-android: release bundles require NODE_ENV=production');
  process.exit(1);
}

if (process.argv.includes('--print-args')) {
  console.log(args.join(' '));
} else if (process.argv.includes('--print-fixer')) {
  const { command, cwd } = fixerSpawn(process.cwd());
  console.log(`${command}\n${cwd}`);
} else {
  requireNativeTree(process.cwd());
  // The inputs before Metro reads them, compared once the fixer has run, so a
  // bundle built while the tree moved is never recorded as built from either.
  const before = sourceIdentity(process.cwd());
  const run = spawnSync('npx', args, { stdio: 'inherit' });
  // A spawn that never starts answers a null status with the reason in
  // `error`, and `stdio: 'inherit'` prints nothing because there was no child
  // to inherit anything. Left unreported it is a bare exit 1 in front of a
  // thirteen-minute wait for the Android lock, which is what SB23 cost twice.
  if (run.error) {
    console.error(`bundle-android: could not run npx: ${run.error.message}`);
    process.exit(1);
  }
  // A child ended by a signal has a null status and no `error`.
  if (run.status !== 0) {
    if (run.signal) console.error(`bundle-android: npx was killed by ${run.signal}`);
    process.exit(run.status ?? 1);
  }

  const lint = spawnSync('node', [join(process.cwd(), 'scripts/lint-android-bundle.mjs')], {
    stdio: 'inherit',
  });
  if (lint.error) {
    console.error(`bundle-android: could not run node: ${lint.error.message}`);
    process.exit(1);
  }
  if (lint.status !== 0) process.exit(lint.status ?? 1);

  const { command, cwd } = fixerSpawn(process.cwd());
  const fix = spawnSync(command, [], { cwd, stdio: 'inherit' });
  if (fix.error) {
    console.error(`bundle-android: could not run ${command}: ${fix.error.message}`);
    process.exit(1);
  }
  if (fix.signal) console.error(`bundle-android: ${command} was killed by ${fix.signal}`);
  if (fix.status !== 0) process.exit(fix.status ?? 1);

  try {
    const entry = recordBundle(process.cwd(), before);
    console.log(`bundle-android: recorded the bundle as built from ${entry.stamp}`);
  } catch (error) {
    console.error(`bundle-android: ${error.message}`);
    process.exit(1);
  }
}
