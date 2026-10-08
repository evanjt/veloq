#!/usr/bin/env node
// Copy the tracked Android widget sources into the build tree before a build.
//
// `widget/android/` is where the widgets are edited, and Gradle compiles the copy under
// `android/`. `expo prebuild` makes that copy when it generates the project, and this
// refreshes it after a widget edit without generating again. Every recipe that builds
// the app runs this first, inside the build lock, and `scripts/check-native-tree.mjs`
// refuses a tree it has not run on.
// See `scripts/lib/androidWidgetSources.mjs`.

import { resolve } from 'node:path';
import { createRequire } from 'node:module';

import { hasWidgetTree, syncWidgetSources } from './lib/androidWidgetSources.mjs';

const argv = process.argv.slice(2);
const at = argv.indexOf('--root');
const root = resolve(at === -1 ? process.cwd() : argv[at + 1]);
const require = createRequire(import.meta.url);
const { writeAndroidStrings } = require('../src/plugins/nativeStrings.js');

if (!hasWidgetTree(root)) {
  console.error('sync-android-widgets: there is no Android tree with a namespace to copy into.');
  console.error('Generate it first: npx expo prebuild --platform android --no-install');
  process.exit(1);
}

const changed = await syncWidgetSources(root);
writeAndroidStrings(resolve(root, 'android/app/src/main/res'));
for (const path of changed) console.log(`widgets: wrote ${path}`);
