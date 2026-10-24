#!/usr/bin/env node
// An availability check at or below the iOS deployment target is always true.
//
// Every Swift file here compiles against the target in app.json, so a check for
// that version or an older one holds on each device that can install the app,
// and the fallback beside it (an `else`, a `return nil`, a skipped refresh) is
// a path no device takes. Checks above the target stay: they gate features by
// OS, which is what an availability check is for.

import { resolve } from 'node:path';

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const SWIFT_ROOTS = [/^widget\//, /^push\//, /^modules\/[^/]+\/ios\//];
// `#available(...)` in code and `@available(...)` on a declaration. The args
// never hold a parenthesis, so the first `)` closes them.
const CHECK = /[#@]available\(([^)]*)\)/g;
const IOS = /\biOS\b\s*(?:,\s*introduced:\s*|\s+)(\d+(?:\.\d+)?)/;

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

// 16.4 is 1604, as check-ios-project.mjs counts it.
function version(value) {
  const match = String(value)
    .replaceAll('"', '')
    .trim()
    .match(/^(\d+)(?:\.(\d+))?$/);
  return match ? Number(match[1]) * 100 + Number(match[2] ?? 0) : NaN;
}

// The bytes come out of the index, as every whole-tree guard reads them.
const config = indexedSources(root, ['app.json']).get('app.json');
if (!config) {
  console.error(
    'lint-ios-availability: app.json is not tracked, so no deployment target was read.'
  );
  process.exit(1);
}
const build = JSON.parse(config.toString('utf8')).expo.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
);
const target = build?.[1]?.ios?.deploymentTarget;
if (!target || !Number.isFinite(version(target))) {
  console.error(
    'lint-ios-availability: iOS deployment target is missing from expo-build-properties'
  );
  process.exit(1);
}

const swift = indexedSources(root, ['*.swift']);
refuseEmptyListing(swift, 'lint-ios-availability');

const failures = [];
for (const [file, bytes] of swift) {
  if (!SWIFT_ROOTS.some((scope) => scope.test(file))) continue;
  bytes
    .toString('utf8')
    .split('\n')
    .forEach((line, index) => {
      for (const check of line.matchAll(CHECK)) {
        const ios = check[1].match(IOS);
        if (ios && version(ios[1]) <= version(target)) {
          failures.push(`${file}:${index + 1}: ${check[0]}`);
        }
      }
    });
}

if (failures.length > 0) {
  console.error(
    `lint-ios-availability: ${failures.length} availability check(s) at or below the iOS deployment target ${target}, which every installable build meets:`
  );
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('Delete each check with its fallback branch.');
  process.exit(1);
}
