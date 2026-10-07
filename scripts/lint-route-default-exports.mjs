#!/usr/bin/env node
// Every file under src/app is a route, so each must default-export a component.
//
// expo-router registers a file with no default export as a route anyway. A
// development build logs a warning and substitutes an empty screen, but a
// release build hands React an undefined component, so opening that route's
// link lands in the global error boundary. Code that is not a screen belongs
// outside src/app.
//
// `+`-prefixed files are expo-router's own conventions and carry no screen.

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const tracked = indexedSources(root, ['src/app']);
refuseEmptyListing(tracked, 'Route default exports guard');

const failures = [];
for (const [file, bytes] of tracked) {
  if (!/\.tsx?$/.test(file)) continue;
  if (/(^|\/)\+[^/]*$/.test(file)) continue;
  if (!/^export\s+default\b|^export\s*\{[^}]*\bas\s+default\b/m.test(bytes.toString('utf8'))) {
    failures.push(file);
  }
}

if (failures.length > 0) {
  console.error(`A route file has no default export: ${failures.length}.\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Route default exports guard: every route file has one.');
