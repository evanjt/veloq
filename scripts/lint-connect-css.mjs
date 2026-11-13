#!/usr/bin/env node
// The connect page draws from the app's design tokens, which
// `scripts/gen-colour-tokens.ts` writes to `web/connect/tokens.generated.css`.
// A colour, or a length in a spacing, radius, border or font-size property, written
// into any other stylesheet under `web/connect/` is a second copy of a token and
// drifts from the app. Read the variable instead.

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const GENERATED = 'web/connect/tokens.generated.css';
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
const LENGTH_PROPERTY =
  /^(padding|margin|gap|column-gap|row-gap|border-radius|border|outline|outline-offset|font-size)(-[a-z]+)*$/;
const PIXELS = /(?<![\w.-])\d*\.?\d+px\b/;

const sources = indexedSources(root, ['web/connect']);
refuseEmptyListing(sources, 'Connect page stylesheet guard');

const failures = [];
for (const [file, bytes] of sources) {
  if (!file.endsWith('.css') || file === GENERATED) continue;
  const lines = bytes.toString('utf8').split('\n');
  lines.forEach((line, index) => {
    const declaration = /^\s*(?:[^{}]*\{\s*)?([a-z-]+)\s*:\s*([^;}]*)/.exec(line);
    if (declaration && COLOUR.test(declaration[2]))
      failures.push(`${file}:${index + 1} a colour literal`);
    else if (declaration && LENGTH_PROPERTY.test(declaration[1]) && PIXELS.test(declaration[2])) {
      failures.push(`${file}:${index + 1} a pixel length in ${declaration[1]}`);
    }
  });
}

if (failures.length > 0) {
  console.error(`The connect page's stylesheets carry token values: ${failures.length}.\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nRead a custom property from web/connect/tokens.generated.css, or add the');
  console.error('token to src/theme/tokens.json and run: npm run gen:colour-tokens');
  process.exit(1);
}

console.log('Connect page stylesheet guard: every colour and length reads a token.');
