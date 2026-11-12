#!/usr/bin/env node
// Fails unless `xcodebuild -version`, read from stdin, reports the pinned Xcode.
//
//   xcodebuild -version | node scripts/check-xcode-version.mjs 27.1
//
// The pin matches whole version components, so 27.1 accepts 27.1 and 27.1.1
// and refuses 27.10. A runner that cannot select the pinned version fails the
// build here instead of building with the SDK it happened to default to.
import { readFileSync } from 'node:fs';

export function reportedVersion(output) {
  const match = /^Xcode (\d+(?:\.\d+)*)\s*$/m.exec(output);
  return match ? match[1] : null;
}

export function matchesPin(reported, pin) {
  if (!reported) return false;
  return reported === pin || reported.startsWith(`${pin}.`);
}

function main() {
  const pin = process.argv[2];
  if (!pin) {
    console.error('usage: check-xcode-version.mjs <version>  (xcodebuild -version on stdin)');
    process.exit(2);
  }
  const reported = reportedVersion(readFileSync(0, 'utf8'));
  if (!matchesPin(reported, pin)) {
    console.error(`Xcode ${pin} is pinned, but xcodebuild reports ${reported ?? 'no version'}.`);
    process.exit(1);
  }
  console.log(`Xcode ${reported} matches the pin ${pin}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
