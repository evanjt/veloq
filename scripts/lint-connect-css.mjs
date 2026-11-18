#!/usr/bin/env node
// The connect page draws from the app's design tokens, which
// `scripts/gen-colour-tokens.ts` writes to `web/connect/tokens.generated.css`.
// A colour, or a length in a spacing, radius, border or font-size property, written
// into any other stylesheet under `web/connect/` is a second copy of a token and
// drifts from the app. Read the variable instead. The page's type, density and layout come
// from the `web` scale (`--web-*`), never the phone's `--type-*`, `--radius-*` or `--size-*` roles, a pixel height on a `.ui-*` rule, and every `var()` names
// a custom property the generated file or a stylesheet defines. A `z-index` is a rung of the
// layer scale in `src/theme/tokens.json`, read as `var(--layer-*)`, never a number.

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const GENERATED = 'web/connect/tokens.generated.css';
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(/;
const COLOUR_HEX = /#[0-9a-fA-F]{3,8}\b/;
const NAMED_COLOURS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet ' +
    'brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan ' +
    'darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta ' +
    'darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue ' +
    'darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey ' +
    'dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray ' +
    'green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush ' +
    'lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray ' +
    'lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon ' +
    'mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin ' +
    'navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen ' +
    'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna ' +
    'silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle ' +
    'tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' ')
);
const QUOTED_NAME = /(['"`])([a-z]+)\1/g;
const hasColourLiteral = (text) => COLOUR_HEX.test(text) || COLOUR_FUNCTION.test(text);
// A quoted colour name that is the value of a colour-bearing key: `'line-color': 'orange'`.
const COLOUR_KEY = /(?:color|fill|stroke|background|shadow)['"]?\s*[:=]\s*$/i;
const namedColourProperty = (text) =>
  [...text.matchAll(QUOTED_NAME)].some(
    (match) => NAMED_COLOURS.has(match[2]) && COLOUR_KEY.test(text.slice(0, match.index))
  );
const CSS_VALUE_COLOUR = (value) =>
  hasColourLiteral(value) ||
  value
    .replace(/var\([^)]*\)/g, '')
    .split(/[\s,]+/)
    .some((word) => NAMED_COLOURS.has(word.toLowerCase()));
const LENGTH_PROPERTY =
  /^(padding|margin|gap|column-gap|row-gap|border-radius|border|outline|outline-offset|font-size)(-[a-z]+)*$/;
const PHONE_ROLE = /^--(radius|size)(-|$)/;
const HEIGHT_PROPERTY = /^(min-|max-)?height$/;
const PIXELS = /(?<![\w.-])\d*\.?\d+px\b/;
const LAYER_READ = /^var\(\s*--layer-[A-Za-z0-9_-]+\s*\)$/;

const sources = indexedSources(root, ['web/connect']);
refuseEmptyListing(sources, 'Connect page stylesheet guard');

const stylesheets = [...sources].filter(([file]) => file.endsWith('.css'));
const scripts = [...sources].filter(([file]) => /\.tsx?$/.test(file) && !file.endsWith('.d.ts'));
const defined = new Set();
for (const [, bytes] of stylesheets) {
  for (const match of bytes.toString('utf8').matchAll(/(--[A-Za-z0-9_-]+)\s*:/g))
    defined.add(match[1]);
}

const failures = [];
for (const [file, bytes] of stylesheets) {
  if (file === GENERATED) continue;
  const lines = bytes.toString('utf8').split('\n');
  let selector = '';
  lines.forEach((line, index) => {
    if (line.includes('{')) selector = line.slice(0, line.indexOf('{'));
    for (const read of line.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
      const name = read[1];
      if (name.startsWith('--type-'))
        failures.push(`${file}:${index + 1} reads the phone type role ${name}`);
      else if (PHONE_ROLE.test(name))
        failures.push(`${file}:${index + 1} reads the phone role ${name}`);
      else if (!defined.has(name))
        failures.push(`${file}:${index + 1} reads ${name}, which nothing defines`);
    }
    // Every declaration on the line, not only the first.
    const body = line.includes('{') ? line.slice(line.indexOf('{') + 1) : line;
    for (const part of body.split(';')) {
      const declaration = /^\s*([a-z0-9-]+)\s*:\s*([^;}]*)/.exec(part);
      if (!declaration) continue;
      if (declaration[1] === 'z-index' && !LAYER_READ.test(declaration[2].trim())) {
        failures.push(`${file}:${index + 1} a z-index literal`);
      } else if (CSS_VALUE_COLOUR(declaration[2])) {
        failures.push(`${file}:${index + 1} a colour literal`);
      } else if (
        (LENGTH_PROPERTY.test(declaration[1]) ||
          (HEIGHT_PROPERTY.test(declaration[1]) && /\.ui-/.test(selector))) &&
        PIXELS.test(declaration[2])
      ) {
        failures.push(`${file}:${index + 1} a pixel length in ${declaration[1]}`);
      }
    }
  });
}

// A colour in TypeScript is a token read or a value resolved from the token file.
const tokenNames = new Set();
const generated = sources.get(GENERATED);
if (generated)
  for (const match of generated.toString('utf8').matchAll(/(--colour-[A-Za-z0-9_-]+)\s*:/g))
    tokenNames.add(match[1]);
for (const [file, bytes] of scripts) {
  bytes
    .toString('utf8')
    .split('\n')
    .forEach((line, index) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const code = line.replace(/\s\/\/ .*$/, '');
      if (hasColourLiteral(code) && !/^\s*import /.test(code))
        failures.push(`${file}:${index + 1} a colour literal`);
      else if (namedColourProperty(code)) failures.push(`${file}:${index + 1} a named colour`);
      for (const read of code.matchAll(/['"`](--colour-[A-Za-z0-9_-]+)['"`]/g))
        if (generated && !tokenNames.has(read[1]))
          failures.push(
            `${file}:${index + 1} reads ${read[1]}, which the token file does not define`
          );
    });
}

if (failures.length > 0) {
  console.error(`The connect page's stylesheets carry token values: ${failures.length}.\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nRead a custom property from web/connect/tokens.generated.css, or add the');
  console.error('token to src/theme/tokens.json and run: npm run gen:colour-tokens');
  console.error('A z-index reads a layer rung, as var(--layer-sticky) or var(--layer-overlay).');
  process.exit(1);
}

console.log('Connect page stylesheet guard: every colour and length reads a token.');
