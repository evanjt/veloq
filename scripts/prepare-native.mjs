#!/usr/bin/env node
// Regenerate a native project that carries the other identity, before a build.
//
//   node scripts/prepare-native.mjs --platform android|ios
//
// Nothing under `android/` or `ios/` is tracked, so the identity a generated
// project carries is whatever `APP_VARIANT` held when it was last generated,
// and its native configuration is whatever the config and plugins said then.
// Gradle and Xcode build that tree as it stands, so a production build over a
// Dev tree compiles Veloq Dev under the release name, and a plugin change (the
// key a release is signed with, an entitlement) never reaches a tree generated
// before it. This compares the identity `APP_VARIANT` selects
// (`scripts/lib/app-identity.js`) with the one the project builds, and the
// hash of the configuration generation reads with the one recorded inside the
// project when it was generated. When both match it does nothing, so an
// incremental build stays incremental. Otherwise it regenerates with `--clean`:
// a switch renames the iOS project folder and moves the Android Kotlin
// package, and a generation over the old tree leaves the old one beside the new.
//
// The release signing files are per machine and generation does not write
// them, so they are moved aside first and put back after. They go to a
// directory beside `android/` rather than to memory, so a run killed during
// generation leaves them on disk and the next run restores them.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

/**
 * The files generation reads besides `node_modules`, directories whole. The
 * Android widget sources are left out because `sync-android-widgets.mjs`
 * copies them into the project before every build. The translations behind
 * the native strings are left out because they change with most releases and
 * each regeneration costs a full native build.
 */
export const CONFIGURATION = [
  'app.json',
  'app.config.js',
  'scripts/lib/app-identity.js',
  'src/plugins',
  'src/theme/appColours.json',
];

const PLATFORMS = {
  android: { read: androidAppId, flags: ['--no-install'], configuration: [] },
  // Pods install as part of generation, since an iOS build reads them.
  ios: {
    read: iosBundleId,
    flags: [],
    configuration: ['widget/ios', 'push/ios', 'config/StoreKitConfiguration.storekit'],
  },
};

/** Inside the generated project, so a clean generation removes it with the tree. */
export const RECORD = '.generated-from.json';

function files(root, relative) {
  const full = join(root, relative);
  let stat;
  try {
    stat = statSync(full);
  } catch {
    return [[relative, null]];
  }
  if (!stat.isDirectory()) return [[relative, readFileSync(full)]];
  return readdirSync(full)
    .sort()
    .flatMap((name) => files(root, join(relative, name)));
}

/** Every `./` path the app config names, its icons and splash among them. */
function namedPaths(value, found = new Set()) {
  if (typeof value === 'string' && value.startsWith('./')) found.add(value.slice(2));
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) namedPaths(item, found);
  }
  return found;
}

/** Expo and every config plugin that comes from a package, as `name@version`. */
function pluginVersions(root, config) {
  const names = new Set(['expo']);
  for (const plugin of config?.expo?.plugins ?? []) {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    if (typeof name === 'string' && !name.startsWith('.')) names.add(name);
  }
  return [...names].sort().map((name) => {
    try {
      const { version } = JSON.parse(
        readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')
      );
      return `${name}@${version}`;
    } catch {
      return `${name}@absent`;
    }
  });
}

/** A hash of everything a generation for `platform` reads besides the identity. */
export function configurationHash(root, platform) {
  let config = null;
  try {
    config = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
  } catch {
    // An unreadable app.json is hashed as its bytes below, and names nothing.
  }
  const paths = new Set([
    ...CONFIGURATION,
    ...PLATFORMS[platform].configuration,
    ...namedPaths(config),
  ]);
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    for (const [file, contents] of files(root, path)) {
      hash.update(`${file}\0${contents === null ? 'absent' : contents.length}\0`);
      if (contents !== null) hash.update(contents);
    }
  }
  for (const entry of pluginVersions(root, config)) hash.update(`${entry}\0`);
  return hash.digest('hex');
}

function readRecord(root, platform) {
  try {
    return JSON.parse(readFileSync(join(root, platform, RECORD), 'utf8'));
  } catch {
    return null;
  }
}

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
  const configuration = configurationHash(root, platform);
  const record = readRecord(root, platform);
  const current = record?.appId === identity.appId && record?.configuration === configuration;
  if (carried === identity.appId && current) return { regenerated: false };

  const target = `${identity.name} (${identity.appId})`;
  if (!carried) {
    console.error(
      `prepare-native: no ${platform}/ project for ${identity.appId}, generating one for ${identity.name}`
    );
  } else if (carried !== identity.appId) {
    console.error(`prepare-native: ${platform}/ builds ${carried}, regenerating it for ${target}`);
  } else if (!record) {
    console.error(
      `prepare-native: ${platform}/ has no record of the configuration it was generated from, regenerating it for ${target}`
    );
  } else {
    console.error(
      `prepare-native: ${platform}/ native configuration changed since it was generated, regenerating it for ${target}`
    );
  }

  // A file still aside here is one a project file already stood in for, and
  // moving the current one over it would lose whichever is the real key.
  if (existsSync(join(root, KEEP_DIR))) {
    throw new KeptFilesError(
      `${KEEP_DIR}/ still holds signing files beside the ones in android/; keep the right ones and remove it`
    );
  }
  const aside = KEPT.filter((file) => existsSync(join(root, file)));
  for (const file of aside) move(join(root, file), join(root, KEEP_DIR, file));
  // A generation that fails part way must not leave the old record vouching for the tree.
  rmSync(join(root, platform, RECORD), { force: true });
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
  // Hashed before generating, so an input edited meanwhile regenerates next time.
  if (status === 0 && read(root) === identity.appId) {
    writeFileSync(
      join(root, platform, RECORD),
      `${JSON.stringify({ appId: identity.appId, configuration }, null, 2)}\n`
    );
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
