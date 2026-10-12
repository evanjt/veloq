#!/usr/bin/env node
// Draws the app icon set `app.json` names from one palette and one mark.
//
// Each image is written as an SVG under src/assets/logos and rendered to the PNG
// beside it under src/assets, so a palette change here is a rerun rather than a
// redraw. scripts/check-app-icons.mjs judges what this writes.
//
//   icon             full-bleed ground, opaque, square corners: iOS masks it
//   icon-dark        the mark on transparency, which iOS lays on its dark ground
//   icon-tinted      a white mark on black, whose luminance iOS tints
//   adaptive-icon    Android's foreground layer, the mark inside the safe zone
//   monochrome-icon  Android's themed layer, the same mark in one flat colour
//
// Needs `rsvg-convert` (librsvg) on the PATH.
//
// Usage: npm run gen:app-icons

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const CANVAS = 1024;

// The ground is the app colour the splash and adaptive icon are drawn on.
const appColours = JSON.parse(readFileSync(join(root, 'src/theme/appColours.json'), 'utf8'));

// Gradients run from the top-left corner to the bottom-right.
const PALETTE = {
  ground: [appColours.appColour, appColours.appColourDeep],
  mark: ['#FFD700', '#FFA500'],
};

// "vq" in Noto Sans Bold, outlined, in font units (1000 to the em, y up, the
// baseline at 0) with the v at the origin. It is a path rather than text so a
// render does not depend on the fonts installed where it runs: the text it
// replaced named Verdana, and the shipped images were whichever font the
// rendering machine substituted.
const MARK = {
  advance: 1203,
  path:
    'M208 0 0 546H158L260 224Q265 208 272.5 180.5Q280 153 282 134H286Q288 154 295.5 179.5' +
    'Q303 205 309 223L413 546H571L363 0ZM979 -11Q979 8 980 30Q981 52 984 71H978Q957 37 920.5 13.5' +
    'Q884 -10 824 -10Q732 -10 675 61.5Q618 133 618 272Q618 412 676 484Q734 556 827 556' +
    'Q887 556 924 533Q961 510 984 476H988L1002 546H1130V-240H979ZM878 109Q939 109 963.5 144.5' +
    'Q988 180 988 253V274Q988 353 964.5 395.5Q941 438 875 438Q823 438 797.5 394Q772 350 772 270' +
    'Q772 109 878 109Z',
};

// The baseline, and the mark's size in pixels to the em. The full icon carries
// it larger; the Android layers keep it inside the adaptive icon's safe zone,
// the centre 66% of the canvas.
const BASELINE = 580;
const ICON_SIZE = 340;
const LAYER_SIZE = 300;

const ICONS = [
  { name: 'icon', ground: 'gradient', mark: 'gradient', size: ICON_SIZE },
  { name: 'icon-dark', ground: null, mark: 'gradient', size: ICON_SIZE },
  { name: 'icon-tinted', ground: '#000000', mark: '#FFFFFF', size: ICON_SIZE },
  { name: 'adaptive-icon', ground: null, mark: 'gradient', size: LAYER_SIZE },
  { name: 'monochrome-icon', ground: null, mark: '#FFFFFF', size: LAYER_SIZE },
];

function gradient(id, [from, to]) {
  return [
    `    <linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%">`,
    `      <stop offset="0%" stop-color="${from}"/>`,
    `      <stop offset="100%" stop-color="${to}"/>`,
    '    </linearGradient>',
  ];
}

function svg({ ground, mark, size }) {
  const defs = [
    ...(ground === 'gradient' ? gradient('ground', PALETTE.ground) : []),
    ...(mark === 'gradient' ? gradient('mark', PALETTE.mark) : []),
  ];
  // Rounded so float noise does not reach the written source.
  const scale = Number((size / 1000).toFixed(4));
  const left = Number((CANVAS / 2 - (MARK.advance * scale) / 2).toFixed(4));
  const fill = (paint, id) => (paint === 'gradient' ? `url(#${id})` : paint);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}">`,
    '  <!-- Written by scripts/generate-app-icons.mjs: change the palette there and rerun it. -->',
    ...(defs.length > 0 ? ['  <defs>', ...defs, '  </defs>'] : []),
    ...(ground
      ? [`  <rect width="${CANVAS}" height="${CANVAS}" fill="${fill(ground, 'ground')}"/>`]
      : []),
    `  <path transform="translate(${left} ${BASELINE}) scale(${scale} ${-scale})" fill="${fill(mark, 'mark')}"`,
    `        d="${MARK.path}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

try {
  execFileSync('rsvg-convert', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('generate-app-icons: needs rsvg-convert on the PATH (librsvg)');
  process.exit(1);
}

for (const icon of ICONS) {
  const source = join(root, 'src/assets/logos', `${icon.name}.svg`);
  const image = join(root, 'src/assets', `${icon.name}.png`);
  writeFileSync(source, svg(icon));
  execFileSync('rsvg-convert', [
    '--width',
    String(CANVAS),
    '--height',
    String(CANVAS),
    '--output',
    image,
    source,
  ]);
  console.log(`generate-app-icons: ${icon.name}`);
}
