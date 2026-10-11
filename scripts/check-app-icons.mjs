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
//
// The images come from scripts/generate-app-icons.mjs.
//
// Usage: node scripts/check-app-icons.mjs [--root DIR]

import { posix, resolve } from 'node:path';

import { trackedText, treeSources } from './lib/indexedSources.mjs';
import { decodePng } from './lib/png.mjs';

const IOS_SIZE = 1024;

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

const config = JSON.parse(trackedText(root, 'app.json') ?? '{}').expo ?? {};

const icon = image('icon', config.icon);
if (icon) {
  requireSquare('icon', icon);
  requireOpaque('icon', icon);
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

if (problems.length > 0) {
  console.error('check-app-icons: the app icon set refused:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('check-app-icons: icon set complete and opaque');
