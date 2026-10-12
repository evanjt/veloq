#!/usr/bin/env node
// The bottom inset is padded in one place, `src/shared/ui/tabBarClearance.ts`.
//
// A view that adds `insets.bottom` to its own bottom padding has no floor on a phone that reports
// no inset, adds it a second time under a safe area that already took it, and leaves a control
// under the navigation bar when it forgets it on Android. `useBottomClearance` and
// `useScrollEndInset` know the tab bar, the inset and what a safe area above already took, so a
// padding reads one of them instead. `--root` points the lint at another tree.

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

// Files that pad the inset themselves, each for its reason.
const OWNERS = new Map([
  ['src/shared/ui/tabBarClearance.ts', 'the owner'],
  // Covers the whole screen, the tab bar included, and keeps its own floor.
  ['src/features/maps/components/SectionCreationOverlay.tsx', 'a full-screen overlay'],
  // A full-screen camera modal above every navigator.
  ['src/features/settings/components/NextcloudQrScanner.tsx', 'a full-screen modal'],
]);

const PADDING = /\b(?:paddingBottom\s*:|bottomPadding\s*=)[^,;}\n]*\binsets\.bottom\b/g;

const tracked = indexedSources(root, ['src']);
refuseEmptyListing(tracked, 'Bottom inset guard');

const failures = [];
for (const [file, bytes] of tracked) {
  if (!/\.tsx?$/.test(file) || OWNERS.has(file)) continue;
  if (file.split('/').includes('__tests__')) continue;
  const text = bytes.toString('utf8');
  for (const m of text.matchAll(PADDING)) {
    const line = text.slice(0, m.index).split('\n').length;
    failures.push(`${file}:${line}`);
  }
}

if (failures.length > 0) {
  console.error(`A bottom padding adds the inset itself: ${failures.length}.\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nRead useBottomClearance or useScrollEndInset from @/shared/ui instead.');
  process.exit(1);
}

console.log('Bottom inset guard: every bottom padding reads the owner.');
