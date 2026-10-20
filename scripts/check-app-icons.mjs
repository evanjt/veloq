#!/usr/bin/env node
// Guard the app icon set `app.json` names.
//
// iOS masks the icon itself and flattens any transparency onto white, so an
// icon with its corners rounded into the artwork shows white where the
// system's continuous corner and the artwork's circular one part, and the
// 1024 image is also the store's marketing icon. Since iOS 18 a Home Screen
// may be dark or tinted, and since Android 13 a launcher may theme every icon
// from a monochrome layer; an app that names neither keeps a full-colour tile
// among recoloured ones.
//
// So, read from the tree:
//   icon and ios.icon.light  square and opaque in every pixel
//   ios.icon                 light, dark and tinted, each a 1024 square PNG
//   ios.icon.tinted          opaque grayscale, since the build flattens it onto white
//   adaptiveIcon.monochromeImage  one colour on a mostly transparent ground,
//                                 since the launcher recolours it from its alpha
//   the expo-splash-screen image  400 wide with an alpha channel, the mark alone
//                                 on the splash ground native code paints
//   icon, ios.icon.light, web.favicon and the Play store icon
//                            a ground in appColour, read at the first opaque
//                            pixel down the diagonal from the top-left corner,
//                            where the generator's gradient starts
//   the Play store icon      512 square, the size the store takes
//   src/assets/logos/*.svg   no text element, since live text renders in whatever
//                            font the machine substitutes, and every gradient the
//                            mark or the ground, stopped at the brand colours
//                            src/theme/appColours.json holds
//
// The images come from scripts/generate-app-icons.mjs.
//
// Usage: node scripts/check-app-icons.mjs [--root DIR]

import { posix, resolve } from 'node:path';

import { trackedText, treeSources } from './lib/indexedSources.mjs';
import { decodePng } from './lib/png.mjs';

const IOS_SIZE = 1024;
const SPLASH_WIDTH = 400;
const LOGOS = 'src/assets/logos';
const APP_COLOURS = 'src/theme/appColours.json';
const PLAY_ICON = 'config/fastlane/metadata/android/en-US/images/icon.png';
const PLAY_ICON_SIZE = 512;
// How far a ground pixel may sit from appColour, per channel: a downscaled
// render blends a few pixels of the gradient into the first opaque one.
const GROUND_TOLERANCE = 8;

const rootArg = process.argv.indexOf('--root');
const root = resolve(rootArg === -1 ? '.' : process.argv[rootArg + 1]);

const problems = [];

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** The decoded image `key` names, or null after recording why it has none. */
function image(key, value) {
  if (typeof value !== 'string' || value === '') {
    problems.push(`${key} names no image`);
    return null;
  }
  const file = posix.normalize(value);
  const bytes = treeSources(root, [file]).get(file);
  if (!bytes) {
    problems.push(`${key}: ${file} is not in the tree`);
    return null;
  }
  try {
    return { file, ...decodePng(bytes) };
  } catch (error) {
    problems.push(`${key}: ${file} cannot be read: ${error.message}`);
    return null;
  }
}

function count(img, test) {
  let n = 0;
  for (let i = 0; i < img.rgba.length; i += 4) {
    if (test(img.rgba[i], img.rgba[i + 1], img.rgba[i + 2], img.rgba[i + 3])) n += 1;
  }
  return n;
}

function requireSquare(key, img, size) {
  if (img.width !== img.height || (size !== undefined && img.width !== size)) {
    const want = size === undefined ? 'square' : `${size}x${size}`;
    problems.push(`${key}: ${img.file} is ${img.width}x${img.height}, not ${want}`);
  }
}

function requireOpaque(key, img) {
  const clear = count(img, (r, g, b, a) => a < 255);
  if (clear > 0) {
    problems.push(
      `${key}: ${img.file} has ${plural(clear, 'pixel')} below full opacity; ` +
        'draw the ground to the edge and let the system mask the corners'
    );
  }
}

function hex(r, g, b) {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
}

/** The first fully opaque pixel down the diagonal from the top-left corner, or null. */
function groundPixel(img) {
  for (let d = 0; d < Math.min(img.width, img.height); d += 1) {
    const i = 4 * (d * img.width + d);
    if (img.rgba[i + 3] === 255) return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]];
  }
  return null;
}

const appColoursText = trackedText(root, APP_COLOURS);
const appColours = appColoursText === undefined ? null : JSON.parse(appColoursText);
if (!appColours)
  problems.push(`${APP_COLOURS} is not in the tree, so the logos have no brand colours`);

/** Refuses an image whose ground is not appColour. */
function requireBrandGround(key, img) {
  const want = appColours?.appColour;
  if (typeof want !== 'string') return;
  const ground = groundPixel(img);
  if (!ground) {
    problems.push(`${key}: ${img.file} has no opaque ground to carry ${want}`);
    return;
  }
  const brand = [1, 3, 5].map((i) => parseInt(want.slice(i, i + 2), 16));
  if (ground.some((c, i) => Math.abs(c - brand[i]) > GROUND_TOLERANCE)) {
    problems.push(
      `${key}: ${img.file} has its ground at ${hex(...ground)}, not ${want} ` +
        `(appColour in ${APP_COLOURS}); rerun npm run gen:app-icons`
    );
  }
}

const config = JSON.parse(trackedText(root, 'app.json') ?? '{}').expo ?? {};

const icon = image('icon', config.icon);
if (icon) {
  requireSquare('icon', icon);
  requireOpaque('icon', icon);
  requireBrandGround('icon', icon);
}

if (config.web?.favicon !== undefined) {
  const favicon = image('web.favicon', config.web.favicon);
  if (favicon) {
    requireSquare('web.favicon', favicon);
    requireBrandGround('web.favicon', favicon);
  }
}

const playIcon = image('the Play store icon', PLAY_ICON);
if (playIcon) {
  requireSquare('the Play store icon', playIcon, PLAY_ICON_SIZE);
  requireOpaque('the Play store icon', playIcon);
  requireBrandGround('the Play store icon', playIcon);
}

const iosIcon = config.ios?.icon;
if (iosIcon === null || typeof iosIcon !== 'object') {
  problems.push(
    'ios.icon is not an object naming light, dark and tinted images, ' +
      'so dark and tinted Home Screens derive their own from the light artwork'
  );
} else {
  for (const appearance of ['light', 'dark', 'tinted']) {
    const key = `ios.icon.${appearance}`;
    const img = image(key, iosIcon[appearance]);
    if (!img) continue;
    requireSquare(key, img, IOS_SIZE);
    if (appearance === 'dark') continue;
    requireOpaque(key, img);
    if (appearance === 'light') requireBrandGround(key, img);
    if (appearance === 'tinted') {
      const coloured = count(img, (r, g, b) => r !== g || g !== b);
      if (coloured > 0) {
        problems.push(
          `${key}: ${img.file} has ${plural(coloured, 'pixel')} not grayscale; ` +
            'the system tints the luminance'
        );
      }
    }
  }
}

const monochrome = config.android?.adaptiveIcon?.monochromeImage;
if (monochrome === undefined) {
  problems.push(
    'android.adaptiveIcon.monochromeImage is absent, so a themed launcher keeps the full-colour tile'
  );
} else {
  const key = 'android.adaptiveIcon.monochromeImage';
  const img = image(key, monochrome);
  if (img) {
    requireSquare(key, img);
    const colours = new Set();
    for (let i = 0; i < img.rgba.length; i += 4) {
      if (img.rgba[i + 3] === 255) {
        colours.add((img.rgba[i] << 16) | (img.rgba[i + 1] << 8) | img.rgba[i + 2]);
      }
    }
    if (colours.size === 0) {
      problems.push(`${key}: ${img.file} has no opaque pixel`);
    } else if (colours.size > 1) {
      problems.push(
        `${key}: ${img.file} has ${colours.size} colours among its opaque pixels; ` +
          'the launcher recolours one glyph'
      );
    }
    const clear = count(img, (r, g, b, a) => a === 0);
    if (clear * 2 < img.width * img.height) {
      problems.push(
        `${key}: ${img.file} is ${Math.round((100 * clear) / (img.width * img.height))}% transparent; ` +
          'a glyph under half transparent themes as a solid tile'
      );
    }
  }
}

const splashPlugin = (config.plugins ?? []).find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen'
);
if (!splashPlugin) {
  problems.push('the expo-splash-screen plugin names no splash image');
} else {
  const props = splashPlugin[1] ?? {};
  const splashes = new Map([['expo-splash-screen.image', props.image]]);
  if (props.dark?.image !== undefined)
    splashes.set('expo-splash-screen.dark.image', props.dark.image);
  for (const [key, value] of splashes) {
    const img = image(key, value);
    if (!img) continue;
    if (img.width !== SPLASH_WIDTH) {
      problems.push(`${key}: ${img.file} is ${img.width} wide, not ${SPLASH_WIDTH}`);
    }
    if (!img.alpha) {
      problems.push(`${key}: ${img.file} has no alpha channel, so the mark sits on a box`);
    }
  }
}

// The gradients the generator draws, by id, and the app colours each stops at.
const GRADIENTS = {
  mark: ['markGold', 'markGoldDeep'],
  ground: ['appColour', 'appColourDeep'],
};

const logos = [...treeSources(root, [LOGOS]).entries()].filter(([file]) => file.endsWith('.svg'));
if (logos.length === 0) problems.push(`${LOGOS} holds no logo source`);
for (const [file, bytes] of logos) {
  const text = bytes.toString('utf8');
  if (/<text[\s>]/.test(text)) {
    problems.push(
      `${file} holds a <text element, which renders in whatever font the machine has; ` +
        'outline it in scripts/generate-app-icons.mjs'
    );
  }
  for (const [, id, body] of text.matchAll(
    /<linearGradient\b[^>]*\bid="([^"]*)"[^>]*>([\s\S]*?)<\/linearGradient>/g
  )) {
    const keys = GRADIENTS[id];
    if (!keys) {
      problems.push(
        `${file}: gradient ${id} is not one the generator draws (${Object.keys(GRADIENTS).join(', ')})`
      );
      continue;
    }
    if (!appColours) continue;
    const stops = [...body.matchAll(/stop-color[=:]\s*"?(#[0-9A-Fa-f]{3,8})/g)].map((m) => m[1]);
    const missing = keys.filter((key) => typeof appColours[key] !== 'string');
    if (missing.length > 0) {
      problems.push(
        `${file}: ${APP_COLOURS} holds no ${missing.join(' or ')} for the ${id} gradient`
      );
      continue;
    }
    const want = keys.map((key) => appColours[key]);
    if (
      stops.length !== want.length ||
      stops.some((stop, i) => stop.toUpperCase() !== String(want[i]).toUpperCase())
    ) {
      problems.push(
        `${file}: the ${id} gradient stops at ${stops.join(', ') || 'nothing'}, ` +
          `not ${want.join(', ')} (${keys.join(', ')} in ${APP_COLOURS})`
      );
    }
  }
}

if (problems.length > 0) {
  console.error('check-app-icons: the app icon set refused:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('check-app-icons: icon set complete and opaque, logos outlined in the brand colours');
