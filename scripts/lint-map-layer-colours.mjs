#!/usr/bin/env node
// A map layer builder draws every colour from the palette it is handed, which
// the surface reads for the base map it draws. A colour imported from the theme
// is the same on every base, so a builder that imports one draws it unchanged
// over light, dark and satellite whatever the palette says. From the theme a
// builder imports only the palette, its types and the helpers that take a
// colour rather than hold one.

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const BUILDER_DIRS = /^src\/features\/(maps|routes|recording)\//;
const BUILDER_NAME = /(LayerSpecs|Layers|Layer|Paint)\.ts$/;
const NAMED_BUILDERS = new Set([
  'src/features/maps/lib/deltaLineColor.ts',
  'src/features/maps/lib/gradientLineColor.ts',
  'src/features/routes/lib/groupingLegend.ts',
]);
// The heatmap's stops are the engine's tile table, mirrored for the contrast
// and parity checks; they move to the base with the tiles themselves.
const EXEMPT = new Set(['src/features/maps/lib/heatmapPaint.ts']);

const ALLOWED = new Set([
  'mapPalette',
  'colourIndexExpression',
  'colorWithOpacity',
  'mixColour',
  'sectionPaletteIndex',
  'MapPalette',
  'MapBase',
  'MapDivStep',
  'MapLayerColours',
  'VectorMapPalette',
  'SatelliteMapPalette',
]);

const IMPORT = /import\s+(type\s+)?([^'";]*?)\s+from\s+['"]([^'"]+)['"]/g;

function isBuilder(file) {
  if (EXEMPT.has(file) || /(^|\/)(__tests__|__mocks__)\//.test(file)) return false;
  return NAMED_BUILDERS.has(file) || (BUILDER_DIRS.test(file) && BUILDER_NAME.test(file));
}

function isTheme(specifier) {
  return /^@\/theme(\/|$)/.test(specifier) || /^\.{1,2}\/(.*\/)?theme(\/[\w.]+)?$/.test(specifier);
}

function refusedNames(clause) {
  const names = [];
  const braces = clause.match(/\{([^}]*)\}/);
  const outside = clause
    .replace(/\{[^}]*\}/, '')
    .replace(/,/g, ' ')
    .trim();
  if (outside) names.push(outside);
  if (braces) {
    for (const raw of braces[1].split(',')) {
      const name = raw
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0];
      if (name && !ALLOWED.has(name)) names.push(name);
    }
  }
  return names;
}

const tracked = indexedSources(root, ['src']);
refuseEmptyListing(tracked, 'Map layer colour guard');

const failures = [];
for (const [file, bytes] of tracked) {
  if (!isBuilder(file)) continue;
  const text = bytes.toString('utf8');
  for (const match of text.matchAll(IMPORT)) {
    if (!isTheme(match[3])) continue;
    const line = text.slice(0, match.index).split('\n').length;
    for (const name of refusedNames(match[2])) failures.push(`${file}:${line} ${name}`);
  }
}

if (failures.length > 0) {
  console.error(`Map layer builders import a colour from the theme: ${failures.length}.\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nTake a `MapPalette` argument and read the colour from it. A colour the');
  console.error('palette lacks is added to `mapPalette` in src/theme/palette.ts.');
  process.exit(1);
}

console.log('Map layer colour guard: every layer builder reads its palette.');
