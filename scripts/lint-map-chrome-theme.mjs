#!/usr/bin/env node
// Chrome drawn over a map (buttons, keys, legends, the credit, popups) follows the app
// theme. The base drawn under it decides only what is drawn on the map itself, so
// `isDarkStyle` is read by the file that declares it, for the status bar, and the layer
// builders read the base through `mapPalette`. A control that reads it is drawn from the
// base instead of the theme.

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const READERS = new Set(['src/features/maps/components/mapStyles.ts']);
const CALL = /\bisDarkStyle\s*\(/g;

function skipped(file) {
  return (
    READERS.has(file) ||
    !/\.tsx?$/.test(file) ||
    /(^|\/)(__tests__|__mocks__|node_modules)\//.test(file)
  );
}

const tracked = indexedSources(root, ['src']);
refuseEmptyListing(tracked, 'Map chrome theme guard');

const failures = [];
for (const [file, bytes] of tracked) {
  if (skipped(file)) continue;
  const text = bytes.toString('utf8');
  for (const match of text.matchAll(CALL)) {
    const line = text.slice(0, match.index).split('\n').length;
    failures.push(`${file}:${line}`);
  }
}

if (failures.length > 0) {
  console.error(`Map chrome reads the base map instead of the app theme: ${failures.length}.\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nRead `useTheme().isDark` for chrome. Only the status bar and the layers');
  console.error('follow the base, through `statusBarStyleForMap` and `mapPalette`.');
  process.exit(1);
}

console.log('Map chrome theme guard: chrome follows the app theme.');
