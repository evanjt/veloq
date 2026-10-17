#!/usr/bin/env node
// Refuse a tracked directory the build cache keys cannot see.
//
// Two lists decide whether a change rebuilds the app, and both are written by
// hand. `compute-source-hash.js` hashes only the top-level directories it
// names, and the simulator-app cache is keyed on that hash, so a change under
// any other directory restores the old app. A pull request runs the native
// builds only for a change `scripts/ci-required.mjs` reads as native, from the
// areas `scripts/ci-areas.mjs` names, so a change to native iOS source it
// reads as app code alone is never compiled before it merges.
//
// So every tracked top-level directory has to be a build input or be left out
// on purpose, and every tracked iOS native source in a build input has to be
// read as native.
//
// Usage: node scripts/check-build-inputs.mjs [--root <dir>]

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { ciAreas } from './ci-areas.mjs';
import { buildsNative } from './ci-required.mjs';

const { buildDirectories, excludedDirectories } = createRequire(import.meta.url)(
  './compute-source-hash.js'
);

/** Files Xcode compiles or bundles into an iOS target. */
const IOS_SOURCE = /\.(swift|m|mm|h|plist|entitlements|xcprivacy|podspec)$/;

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

function trackedFiles() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', env })
    .split('\0')
    .filter(Boolean);
}

/** Whether a pull request changing only this file runs the native builds. */
function buildsFile(file) {
  return buildsNative({ event: 'pull_request', areas: ciAreas({ paths: [file], root }) });
}

const files = trackedFiles();
const problems = [];

const directories = new Set(files.filter((f) => f.includes('/')).map((f) => f.split('/')[0]));
for (const dir of [...directories].sort()) {
  if (!buildDirectories.has(dir) && !excludedDirectories.has(dir)) {
    problems.push(
      `${dir}/ is neither a build input nor left out: add it to buildDirectories or ` +
        'excludedDirectories in scripts/compute-source-hash.js'
    );
  }
}

for (const file of files) {
  if (!IOS_SOURCE.test(file) || !buildDirectories.has(file.split('/')[0])) continue;
  if (!buildsFile(file)) {
    problems.push(
      `${file} is iOS native source a pull request builds no native app for: ` +
        'add its path to the native rules in scripts/ci-areas.mjs'
    );
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-build-inputs: ${problem}`);
  process.exit(1);
}
