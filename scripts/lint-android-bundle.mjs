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

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BUNDLE = 'android/app/src/main/assets/index.android.bundle';
const SOURCE = 'src';

// Directories under `src/` that no bundle carries, so a test run touching them
// must not fail a build whose bundle is current.
const SKIP = new Set(['__tests__', '__mocks__', '__snapshots__']);

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

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
