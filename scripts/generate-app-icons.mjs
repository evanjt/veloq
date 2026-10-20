#!/usr/bin/env node
// Draws the app icon set `app.json` names, the splash mark and the wordmark
// logos from one palette and two outlined words.
//
// Each image is written as an SVG under src/assets/logos and rendered to the PNGs
// it ships as, so a palette change here is a rerun rather than a redraw.
// scripts/check-app-icons.mjs judges what this writes.
//
//   icon              full-bleed ground, opaque, square corners: iOS masks it,
//                     and the Play listing takes it at 512 as its store icon
//   icon-dark         the mark on transparency, which iOS lays on its dark ground
//   icon-tinted       a white mark on black, whose luminance iOS tints
//   adaptive-icon     Android's foreground layer, the mark inside the safe zone
//   monochrome-icon   Android's themed layer, the same mark in one flat colour
//   logo              the mark on a rounded tile, the website's and README's icon
//                     and the web build's favicon
//   logo-transparent  the mark on transparency
//   splash            "veloq" on transparency, which the native splash lays on
//                     the app colour
//
// Needs `rsvg-convert` (librsvg) on the PATH.
//
// Usage: npm run gen:app-icons

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The brand colours, which scripts/gen-colour-tokens.ts writes from the token file.
const appColours = JSON.parse(readFileSync(join(root, 'src/theme/appColours.json'), 'utf8'));

// Gradients run from the top-left corner to the bottom-right.
const PALETTE = {
  ground: [appColours.appColour, appColours.appColourDeep],
  mark: [appColours.markGold, appColours.markGoldDeep],
};

// The words in Noto Sans Bold, outlined, in font units (1000 to the em, y up,
// the baseline at 0) with the first letter at the origin and no kerning. They
// are paths rather than text so a render does not depend on the fonts
// installed where it runs: the text they replaced named Verdana, and the
// shipped images were whichever font the rendering machine substituted.
const WORDS = {
  vq: {
    advance: 1203,
    path:
      'M208 0 0 546H158L260 224Q265 208 272.5 180.5Q280 153 282 134H286Q288 154 295.5 179.5' +
      'Q303 205 309 223L413 546H571L363 0ZM979 -11Q979 8 980 30Q981 52 984 71H978Q957 37 920.5 13.5' +
      'Q884 -10 824 -10Q732 -10 675 61.5Q618 133 618 272Q618 412 676 484Q734 556 827 556' +
      'Q887 556 924 533Q961 510 984 476H988L1002 546H1130V-240H979ZM878 109Q939 109 963.5 144.5' +
      'Q988 180 988 253V274Q988 353 964.5 395.5Q941 438 875 438Q823 438 797.5 394Q772 350 772 270' +
      'Q772 109 878 109Z',
  },
  veloq: {
    advance: 2723,
    path:
      'M208 0 0 546H158L260 224Q265 208 272.5 180.5Q280 153 282 134H286Q288 154 295.5 179.5' +
      'Q303 205 309 223L413 546H571L363 0ZM877 556Q991 556 1056.5 492Q1122 428 1122 308V235H771' +
      'Q774 173 809.5 137.5Q845 102 912 102Q963 102 1005 112Q1047 122 1091 142V29' +
      'Q1051 9 1006 -0.5Q961 -10 896 -10Q815 -10 752.5 20.5Q690 51 654 113Q618 175 618 269' +
      'Q618 412 689.5 484Q761 556 877 556ZM881 449Q836 449 807.5 420.5Q779 392 775 336H981' +
      'Q980 385 955.5 417Q931 449 881 449ZM1392 0H1241V760H1392ZM2043 274Q2043 138 1971.5 64' +
      'Q1900 -10 1777 -10Q1700 -10 1640.5 23Q1581 56 1547 119.5Q1513 183 1513 274' +
      'Q1513 410 1584.5 483Q1656 556 1780 556Q1857 556 1916 523.5Q1975 491 2009 428' +
      'Q2043 365 2043 274ZM1667 274Q1667 194 1693 149.5Q1719 105 1779 105Q1837 105 1863 149.5' +
      'Q1889 194 1889 274Q1889 355 1863 398Q1837 441 1778 441Q1719 441 1693 398' +
      'Q1667 355 1667 274ZM2499 -11Q2499 8 2500 30Q2501 52 2504 71H2498Q2477 37 2440.5 13.5' +
      'Q2404 -10 2344 -10Q2252 -10 2195 61.5Q2138 133 2138 272Q2138 412 2196 484' +
      'Q2254 556 2347 556Q2407 556 2444 533Q2481 510 2504 476H2508L2522 546H2650V-240H2499Z' +
      'M2398 109Q2459 109 2483.5 144.5Q2508 180 2508 253V274Q2508 353 2484.5 395.5' +
      'Q2461 438 2395 438Q2343 438 2317.5 394Q2292 350 2292 270Q2292 109 2398 109Z',
  },
};

// The icons are a 1024 canvas with the baseline at 580. The full icon carries
// the mark larger; the Android layers keep it inside the adaptive icon's safe
// zone, the centre 66% of the canvas. Sizes are pixels to the em.
const ICON = { width: 1024, height: 1024, word: 'vq', baseline: 580 };
const ICON_SIZE = 340;
const LAYER_SIZE = 300;

const iconPng = (name) => [{ file: `src/assets/${name}.png`, width: 1024, height: 1024 }];

const IMAGES = [
  {
    name: 'icon',
    ...ICON,
    ground: 'gradient',
    mark: 'gradient',
    size: ICON_SIZE,
    renders: [
      ...iconPng('icon'),
      { file: 'config/fastlane/metadata/android/en-US/images/icon.png', width: 512, height: 512 },
    ],
  },
  {
    name: 'icon-dark',
    ...ICON,
    ground: null,
    mark: 'gradient',
    size: ICON_SIZE,
    renders: iconPng('icon-dark'),
  },
  {
    name: 'icon-tinted',
    ...ICON,
    ground: '#000000',
    mark: '#FFFFFF',
    size: ICON_SIZE,
    renders: iconPng('icon-tinted'),
  },
  {
    name: 'adaptive-icon',
    ...ICON,
    ground: null,
    mark: 'gradient',
    size: LAYER_SIZE,
    renders: iconPng('adaptive-icon'),
  },
  {
    name: 'monochrome-icon',
    ...ICON,
    ground: null,
    mark: '#FFFFFF',
    size: LAYER_SIZE,
    renders: iconPng('monochrome-icon'),
  },
  {
    name: 'logo',
    width: 512,
    height: 512,
    word: 'vq',
    baseline: 310,
    ground: 'gradient',
    tile: { inset: 16, radius: 96 },
    mark: 'gradient',
    size: 200,
    renders: [
      { file: 'docs/icon.png', width: 1024, height: 1024 },
      { file: 'src/assets/favicon.png', width: 48, height: 48 },
    ],
  },
  {
    name: 'logo-transparent',
    width: 512,
    height: 512,
    word: 'vq',
    baseline: 340,
    ground: null,
    mark: 'gradient',
    size: 280,
    renders: [],
  },
  {
    // The splash plugin reads a 400-wide image and draws it 200 points wide.
    name: 'splash',
    width: 512,
    height: 200,
    word: 'veloq',
    baseline: 140,
    ground: null,
    mark: 'gradient',
    size: 120,
    renders: [{ file: 'src/assets/splash-icon.png', width: 400 }],
  },
];

// The mark's path is drawn y up and flipped onto the canvas, so its gradient
// runs bottom to top in the path's own space to land top-left to bottom-right.
function gradient(id, [from, to], flipped = false) {
  const [y1, y2] = flipped ? ['100%', '0%'] : ['0%', '100%'];
  return [
    `    <linearGradient id="${id}" x1="0%" y1="${y1}" x2="100%" y2="${y2}">`,
    `      <stop offset="0%" stop-color="${from}"/>`,
    `      <stop offset="100%" stop-color="${to}"/>`,
    '    </linearGradient>',
  ];
}

function groundShape({ width, height, ground, tile }) {
  const fill = ground === 'gradient' ? 'url(#ground)' : ground;
  if (!tile) return `  <rect width="${width}" height="${height}" fill="${fill}"/>`;
  const { inset, radius } = tile;
  return (
    `  <rect x="${inset}" y="${inset}" width="${width - 2 * inset}" height="${height - 2 * inset}"` +
    ` rx="${radius}" fill="${fill}"/>`
  );
}

function svg(image) {
  const { width, height, word, baseline, ground, mark, size } = image;
  const defs = [
    ...(ground === 'gradient' ? gradient('ground', PALETTE.ground) : []),
    ...(mark === 'gradient' ? gradient('mark', PALETTE.mark, true) : []),
  ];
  const { advance, path } = WORDS[word];
  // Rounded so float noise does not reach the written source.
  const scale = Number((size / 1000).toFixed(4));
  const left = Number((width / 2 - (advance * scale) / 2).toFixed(4));
  const fill = mark === 'gradient' ? 'url(#mark)' : mark;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">`,
    '  <!-- Written by scripts/generate-app-icons.mjs: change the palette there and rerun it. -->',
    ...(defs.length > 0 ? ['  <defs>', ...defs, '  </defs>'] : []),
    ...(ground ? [groundShape(image)] : []),
    `  <path transform="translate(${left} ${baseline}) scale(${scale} ${-scale})" fill="${fill}"`,
    `        d="${path}"/>`,
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

for (const image of IMAGES) {
  const source = join(root, 'src/assets/logos', `${image.name}.svg`);
  writeFileSync(source, svg(image));
  for (const render of image.renders) {
    const size = ['--width', String(render.width)];
    if (render.height !== undefined) size.push('--height', String(render.height));
    execFileSync('rsvg-convert', [...size, '--output', join(root, render.file), source]);
  }
  console.log(`generate-app-icons: ${image.name}`);
}
