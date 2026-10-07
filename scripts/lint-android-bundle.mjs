#!/usr/bin/env node
// The embedded Android bundle can be older than the code and nothing says so.
//
// The recipe was `npx expo export` then `gradle assembleDebug`. Both succeed.
// `expo export` writes a `dist/` directory that no part of the Android build
// reads, and `assembleDebug` bundles no JavaScript of its own, because a debug
// build expects Metro to serve it. So Gradle packages whatever already sits at
// `android/app/src/main/assets/index.android.bundle`, which may be days old.
//
// The result is the same shape as the `node_modules/veloqrs` symlink trap next
// door: a build that compiles, installs, launches, renders, and silently runs
// superseded code. The build is green, the install is green, the app opens on
// the right screen, and the only signal is the feature not being there. That
// is what this refuses.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BUNDLE = 'android/app/src/main/assets/index.android.bundle';
const APK_ENTRY = 'assets/index.android.bundle';
const SOURCE = 'src';
const LOCALE = 'src/i18n/locales/en-AU.json';

// Phrases to look for inside the bundle, and how long one has to be to be
// worth looking for. A short string collides with the runtime's own.
const PROBES = 3;
const PROBE_MIN = 24;

// Directories under `src/` that no bundle carries, so a test run touching them
// must not fail a build whose bundle is current.
const SKIP = new Set(['__tests__', '__mocks__', '__snapshots__']);

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

const apkFlag = argv.indexOf('--apk');
const apk = apkFlag === -1 ? null : resolve(argv[apkFlag + 1]);

// The APK is what gets installed, so its own bundle is judged and the working
// tree's age is not: an installed build is old by design once `src/` moves on.
if (apk) {
  let text;
  try {
    text = execFileSync('unzip', ['-p', apk, APK_ENTRY], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    text = '';
  }
  if (text === '') {
    console.error(`${apk} has no ${APK_ENTRY}.`);
    console.error('Build it again with `npm run android:debug`.');
    process.exit(1);
  }
  refuseStub(apk, text, Buffer.byteLength(text));
  process.exit(0);
}

const bundle = statSafe(join(root, BUNDLE));

// No bundle is a tree that has never built one, or one that runs against
// Metro. Both are the normal case and neither is stale.
if (!bundle) {
  process.exit(0);
}

const newest = newestUnder(join(root, SOURCE));

// No source tree to compare against is a fixture or a partial checkout, not a
// stale build.
if (newest === null) {
  process.exit(0);
}

// A bundle built through another checkout's `node_modules`, or with a Metro
// cache not keyed per checkout, comes out as a stub carrying no screen at all:
// metro reuses the router entry it transformed for the other checkout, and the
// app root baked into it matches nothing here. It is newer than every source
// file, so the staleness check above cannot see it.
refuseStub(BUNDLE, readSafe(join(root, BUNDLE)), bundle.size);

if (bundle.mtimeMs < newest.at) {
  console.error(`${BUNDLE} is older than the code it is meant to carry.`);
  console.error(`  bundle  ${new Date(bundle.mtimeMs).toISOString()}`);
  console.error(`  newest  ${new Date(newest.at).toISOString()}  ${newest.path}`);
  console.error('');
  console.error('A debug build bundles no JavaScript of its own, so Gradle packages');
  console.error('whatever is already there and the APK runs superseded code with no');
  console.error('warning. `npx expo export` does not write this file. Embed it:');
  console.error('');
  console.error('  npx expo export:embed --platform android --dev false \\');
  console.error(`    --bundle-output ${BUNDLE} \\`);
  console.error('    --assets-dest android/app/src/main/res');
  process.exit(1);
}

/**
 * Phrases the shipped locale file carries, long enough that a bundle holding
 * them is holding the app. Reading them out of the tree rather than naming
 * them here keeps the check alive through a rename.
 */
function probePhrases(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
  const found = [];
  const walk = (node) => {
    if (found.length === PROBES) return;
    if (typeof node === 'string') {
      if (node.length >= PROBE_MIN && !node.includes('{{')) found.push(node);
      return;
    }
    if (node && typeof node === 'object') for (const value of Object.values(node)) walk(value);
  };
  walk(parsed);
  return found;
}

/** The bundle's text, or null when it cannot be read. */
function readSafe(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Exits 1 naming the phrases a bundle lacks, unless it carries the app. */
function refuseStub(label, text, size) {
  const probes = probePhrases(join(root, LOCALE));
  if (probes.length !== PROBES || text === null) return;
  const missing = probes.filter((phrase) => !text.includes(phrase));
  if (missing.length === 0) return;
  console.error(`${label} does not carry the app.`);
  console.error(`  ${missing.length} of ${PROBES} phrases from ${LOCALE} are missing from it:`);
  for (const phrase of missing) console.error(`    ${phrase}`);
  console.error(`  bundle  ${(size / 1e6).toFixed(1)} MB`);
  console.error('');
  console.error("A bundle built through another checkout's node_modules resolves the");
  console.error('router app root to nothing, and Gradle packages a stub that installs,');
  console.error('launches and renders blank. Build it again from this checkout:');
  console.error('');
  console.error('  npm run bundle:android');
  console.error('');
  console.error('which refuses a tree whose installation is not its own.');
  process.exit(1);
}

/** The newest file under `dir`, or null when there is nothing to read. */
function newestUnder(dir) {
  let newest = null;
  const walk = (at) => {
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) walk(join(at, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const path = join(at, entry.name);
      const stat = statSafe(path);
      if (stat && (newest === null || stat.mtimeMs > newest.at)) {
        newest = { at: stat.mtimeMs, path };
      }
    }
  };
  walk(dir);
  return newest;
}

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
