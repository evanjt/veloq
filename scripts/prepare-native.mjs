#!/usr/bin/env node
// Regenerate a native project that carries the other identity, before a build.
//
//   node scripts/prepare-native.mjs --platform android|ios
//
// Nothing under `android/` or `ios/` is tracked, so the identity a generated
// project carries is whatever `APP_VARIANT` held when it was last generated.
// Gradle and Xcode build that tree as it stands, so a production build over a
// Dev tree compiles Veloq Dev under the release name. This compares the
// identity `APP_VARIANT` selects (`scripts/lib/app-identity.js`) with the one
// the project builds. When they match it does nothing, so an incremental build
// stays incremental. When the project is absent or carries the other identity
// it regenerates it with `--clean`: a switch renames the iOS project folder and
// moves the Android Kotlin package, and a generation over the old tree leaves
// the old one beside the new.
//
// The release signing files are per machine and generation does not write
// them, so they are moved aside first and put back after. They go to a
// directory beside `android/` rather than to memory, so a run killed during
// generation leaves them on disk and the next run restores them.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { IdentityError, androidAppId, iosBundleId, selected } = require('./lib/app-identity.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

class KeptFilesError extends Error {}

/** Per-machine files inside `android/` that generation neither writes nor keeps. */
export const KEPT = [
  'android/keystore.properties',
  'android/app/release.keystore',
  'android/local.properties',
];

/** Where the kept files wait while the project is regenerated. Git ignores it. */
export const KEEP_DIR = '.native-keep';

const PLATFORMS = {
  android: { read: androidAppId, flags: ['--no-install'] },
  // Pods install as part of generation, since an iOS build reads them.
  ios: { read: iosBundleId, flags: [] },
};

function move(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
}

/** Put back whatever an earlier run left aside, never over a file that is there. */
function restore(root) {
  const keep = join(root, KEEP_DIR);
  if (!existsSync(keep)) return;
  for (const file of KEPT) {
    const aside = join(keep, file);
    if (existsSync(aside) && !existsSync(join(root, file))) move(aside, join(root, file));
  }
  removeEmpty(keep);
}

/** Remove a directory and its empty subdirectories, leaving any file in place. */
function removeEmpty(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmpty(join(dir, entry.name));
  }
  if (readdirSync(dir).length === 0) rmdirSync(dir);
}

export function prepare(root, platform, env = process.env) {
  const identity = selected(env);
  const { read, flags } = PLATFORMS[platform];
  restore(root);
  const carried = read(root);
  if (carried === identity.appId) return { regenerated: false };

  console.error(
    carried
      ? `prepare-native: ${platform}/ builds ${carried}, regenerating it for ${identity.name} (${identity.appId})`
      : `prepare-native: no ${platform}/ project for ${identity.appId}, generating one for ${identity.name}`
  );

  // A file still aside here is one a project file already stood in for, and
  // moving the current one over it would lose whichever is the real key.
  if (existsSync(join(root, KEEP_DIR))) {
    throw new KeptFilesError(
      `${KEEP_DIR}/ still holds signing files beside the ones in android/; keep the right ones and remove it`
    );
  }
  const aside = KEPT.filter((file) => existsSync(join(root, file)));
  for (const file of aside) move(join(root, file), join(root, KEEP_DIR, file));
  let status;
  try {
    status = spawnSync('npx', ['expo', 'prebuild', '--platform', platform, '--clean', ...flags], {
      cwd: root,
      stdio: 'inherit',
      env: { ...env, CI: '1' },
    }).status;
  } finally {
    restore(root);
  }
  return { regenerated: true, status: status ?? 1 };
}

function main(argv) {
  const at = argv.indexOf('--platform');
  const platform = at >= 0 ? argv[at + 1] : undefined;
  if (!Object.hasOwn(PLATFORMS, platform ?? '')) {
    console.error('usage: node scripts/prepare-native.mjs --platform android|ios');
    return 2;
  }
  try {
    const result = prepare(ROOT, platform);
    return result.regenerated ? result.status : 0;
  } catch (error) {
    if (!(error instanceof IdentityError) && !(error instanceof KeptFilesError)) throw error;
    console.error(`prepare-native: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
