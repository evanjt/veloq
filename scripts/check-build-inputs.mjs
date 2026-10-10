#!/usr/bin/env node
// Refuse a tracked directory the build cache keys cannot see.
//
// Two lists decide whether a change rebuilds the app, and both are written by
// hand. `compute-source-hash.js` hashes only the top-level directories it
// names, and the simulator-app cache is keyed on that hash, so a change under
// any other directory restores the old app. The pull request native filter in
// `build.yml` runs the iOS build only for the paths it names, so a change to
// native iOS source outside them is never compiled before it merges.
//
// So every tracked top-level directory has to be a build input or be left out
// on purpose, and every tracked iOS native source in a build input has to be
// matched by the native filter.
//
// Usage: node scripts/check-build-inputs.mjs [--root <dir>]

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, matchesGlob, resolve } from 'node:path';

import { load } from 'js-yaml';

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

/** The path globs of the `native` filter in the pull request change detection. */
function nativeFilter() {
  const workflow = load(readFileSync(join(root, '.github/workflows/build.yml'), 'utf8'));
  const steps = workflow?.jobs?.changes?.steps ?? [];
  const step = steps.find((s) => String(s.uses ?? '').startsWith('dorny/paths-filter'));
  const filters = step?.with?.filters;
  const native = (typeof filters === 'string' ? load(filters) : filters)?.native;
  if (!Array.isArray(native)) {
    throw new Error('build.yml has no `native` paths filter in its `changes` job');
  }
  return native;
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

const globs = nativeFilter();
for (const file of files) {
  if (!IOS_SOURCE.test(file) || !buildDirectories.has(file.split('/')[0])) continue;
  if (!globs.some((glob) => matchesGlob(file, glob))) {
    problems.push(`${file} is iOS native source the build.yml native filter does not match`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-build-inputs: ${problem}`);
  process.exit(1);
}
