// How wide each map credit draws in the attribution's text role, against the
// narrowest screens every layout must hold at.
//
// The credits are read from the source as the app builds them, the face is the
// bundled Manrope Regular, and the role is `typography.micro`: 10 px with
// 0.2 px letter spacing, capped at 1.3x by `DenseText`.
//
//   node scripts/measure/attribution-width.mjs

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const CanvasKitInit = require('canvaskit-wasm');

const FONT_SIZE = 10;
const LETTER_SPACING = 0.2;
const SCALES = [1, 1.3];
const SCREENS = { 'Android 360': 360, 'iPhone 375': 375 };
// The bar's own horizontal padding, both sides, at spacing.sm (8) each.
const BAR_PADDING = 16;

const table = readFileSync(join(root, 'src/features/maps/lib/mapSourceCredits.ts'), 'utf8');
const match = (re) => {
  const m = table.match(re);
  if (!m) throw new Error(`not found in the credit table: ${re}`);
  return m[1];
};
const SEPARATOR = match(/CREDIT_SEPARATOR = '([^']+)'/);
const credit = (id) => match(new RegExp(`\\n  ${id}: \\{[\\s\\S]*?shortCredit: '([^']+)'`));
const line = (...ids) => ids.map(credit).join(SEPARATOR);
const BASE = ['openfreemap', 'openmaptiles', 'openstreetmap'];

// Each line as the map shows it: the sources drawn, in stack order, then terrain in 3D.
const cases = {
  'light or dark': line(...BASE),
  'light or dark, 3D': line(...BASE, 'terrain'),
  'satellite, open sea (EOX)': line('eox'),
  'satellite, EOX, 3D': line('eox', 'terrain'),
  'satellite, Geneva border (swisstopo, IGN, EOX)': line('swisstopo', 'ign', 'eox'),
  'satellite, Geneva border, 3D': line('swisstopo', 'ign', 'eox', 'terrain'),
  'satellite, Vienna to Brno (basemap.at, ČÚZK, EOX), 3D': line(
    'austria',
    'czechia',
    'eox',
    'terrain'
  ),
  'satellite, Basel (swisstopo, IGN, EOX), 3D': line('swisstopo', 'ign', 'eox', 'terrain'),
  'satellite, Lake Constance (swisstopo, basemap.at, EOX), 3D': line(
    'swisstopo',
    'austria',
    'eox',
    'terrain'
  ),
  'satellite, Maastricht (PDOK, EOX), 3D': line('netherlands', 'eox', 'terrain'),
  'satellite, Pyrenees (IGN, PNOA, EOX), 3D': line('ign', 'spain', 'eox', 'terrain'),
};

const ck = await CanvasKitInit({
  locateFile: (f) => join(root, 'node_modules/canvaskit-wasm/bin', f),
});
const face = ck.Typeface.MakeFreeTypeFaceFromData(
  readFileSync(join(root, 'assets/fonts/Manrope-Regular.ttf')).buffer
);

function width(text, scale) {
  const font = new ck.Font(face, FONT_SIZE * scale);
  const glyphs = font.getGlyphIDs(text);
  const advances = font.getGlyphWidths(glyphs);
  font.delete();
  let sum = 0;
  for (const a of advances) sum += a;
  return sum + LETTER_SPACING * scale * text.length;
}

const header = [
  'credit',
  'chars',
  ...SCALES.map((s) => `${s}x px`),
  'lines at 360, 1x',
  'lines at 360, 1.3x',
];
console.log(header.join('\t'));
for (const [name, text] of Object.entries(cases)) {
  const w = SCALES.map((s) => width(text, s));
  const lines = SCALES.map((s, i) => Math.ceil(w[i] / (SCREENS['Android 360'] - BAR_PADDING)));
  console.log([name, text.length, ...w.map((x) => x.toFixed(1)), ...lines].join('\t'));
}
console.log(
  `\nusable bar width: ${SCREENS['Android 360'] - BAR_PADDING} px at 360, ${SCREENS['iPhone 375'] - BAR_PADDING} px at 375`
);
// The pill: 62 % of the map, less the 6 px corner inset and 12 px padding each side.
console.log(`62% corner pill at 360: ${(0.62 * 360 - 6 - 24).toFixed(1)} px of text`);
