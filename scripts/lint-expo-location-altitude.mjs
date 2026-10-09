#!/usr/bin/env node
// The Android half of the altitude fix is a patch to expo-location, not code in
// this tree. A build against an unpatched copy compiles, installs and records
// heights above the ellipsoid, or 0 m for a fix with no altitude, so the patch
// being on disk is checked here rather than trusted to `postinstall` and the
// gate runner's link step.
//
// It reads through whatever `node_modules` is, so a worktree linked whole to
// the main checkout is checking the main checkout's copy, which is the one its
// builds ship. No expo-location at all is an install that has not run.

// Reads `node_modules` on purpose: this checks the installed package, which is
// the environment and not a tracked file.
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { locationPackage, locationState } = require('./patch-expo-location.js');

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

const pkg = locationPackage(root);
if (!pkg) process.exit(0);

const { state, file } = locationState(pkg);
if (state === 'patched') process.exit(0);

console.error(
  state === 'unpatched'
    ? 'expo-location is not patched, so Android records altitude above the ellipsoid:'
    : 'expo-location changed a line the altitude patch rewrites:'
);
console.error(`  ${existsSync(file) ? realpathSync(file) : file}`);
console.error('');
console.error(
  state === 'unpatched'
    ? 'Patch it from the checkout that owns that node_modules:'
    : 'Update scripts/patch-expo-location.js to the new lines, then run it there:'
);
console.error('  node scripts/patch-expo-location.js');
process.exit(1);
