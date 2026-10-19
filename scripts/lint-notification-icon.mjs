#!/usr/bin/env node
// Android draws a notification's small icon from its alpha channel alone and
// tints it, so an icon with colour artwork on an opaque ground renders as a
// blank square in the status bar, the shade header, the lock screen and the
// always-on display. The `expo-notifications` plugin entry in `app.json` names
// the one image every Android notification resolves, through the
// `notification_icon` drawable it writes at prebuild, and nothing in the build
// looks at what that image is.
//
// So this reads the image the entry names and refuses it unless at least half
// its pixels are fully transparent and every opaque pixel is white: a flat
// white silhouette on transparency. An entry with no icon is refused too,
// because then the notifications fall back to the launcher artwork.

import { inflateSync } from 'node:zlib';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { trackedText, treeSources } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);

const PLUGIN = 'expo-notifications';
const MIN_TRANSPARENT = 0.5;

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

/** The `icon` the plugin entry names, relative to the root, or why there is none. */
function pluginIcon() {
  const text = trackedText(ROOT, 'app.json');
  if (text === undefined) return { error: 'app.json is not in the tree.' };
  const plugins = JSON.parse(text).expo?.plugins ?? [];
  const entry = plugins.find((p) => (Array.isArray(p) ? p[0] : p) === PLUGIN);
  if (!entry) return { error: `app.json has no ${PLUGIN} plugin entry.` };
  const icon = Array.isArray(entry) ? entry[1]?.icon : undefined;
  if (typeof icon !== 'string') {
    return {
      error: `The ${PLUGIN} entry in app.json names no icon, so every notification falls back to the launcher artwork.`,
    };
  }
  return { icon: posix.normalize(icon) };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * The image's pixels as RGBA bytes. Reads 8-bit, non-interlaced PNG in every
 * colour type, which is what the plugin and an export tool write.
 */
function decodePng(bytes) {
  const SIGNATURE = '89504e470d0a1a0a';
  if (bytes.subarray(0, 8).toString('hex') !== SIGNATURE) throw new Error('not a PNG');
  let header;
  let palette;
  let paletteAlpha;
  const data = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colourType: body[9],
        interlace: body[12],
      };
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') paletteAlpha = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (!header) throw new Error('no IHDR chunk');
  const { width, height, depth, colourType, interlace } = header;
  const channels = CHANNELS[colourType];
  if (depth !== 8 || interlace !== 0 || channels === undefined) {
    throw new Error(
      `bit depth ${depth}, colour type ${colourType}, interlace ${interlace}: export it as 8-bit RGBA`
    );
  }

  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? rows[out + x - channels] : 0;
      const up = y > 0 ? rows[out - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? rows[out - stride + x - channels] : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      if (predictor === undefined) throw new Error(`unknown row filter ${filter}`);
      rows[out + x] = (line[x] + predictor) & 0xff;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    let px;
    if (colourType === 6) px = [rows[s], rows[s + 1], rows[s + 2], rows[s + 3]];
    else if (colourType === 4) px = [rows[s], rows[s], rows[s], rows[s + 1]];
    else if (colourType === 2) px = [rows[s], rows[s + 1], rows[s + 2], 255];
    else if (colourType === 0) px = [rows[s], rows[s], rows[s], 255];
    else {
      const index = rows[s];
      const p = index * 3;
      px = [palette[p], palette[p + 1], palette[p + 2], paletteAlpha?.[index] ?? 255];
    }
    rgba.set(px, i * 4);
  }
  return { width, height, rgba };
}

const found = pluginIcon();
if (found.error) fail([found.error]);
const { icon } = found;

const bytes = treeSources(ROOT, [icon]).get(icon);
if (!bytes) fail([`The ${PLUGIN} icon in app.json, ${icon}, is not in the tree.`]);

let image;
try {
  image = decodePng(bytes);
} catch (error) {
  fail([`The ${PLUGIN} icon, ${icon}, could not be read: ${error.message}.`]);
}

const total = image.width * image.height;
let transparent = 0;
let coloured = 0;
for (let i = 0; i < total; i++) {
  const [r, g, b, a] = image.rgba.subarray(i * 4, i * 4 + 4);
  if (a === 0) transparent++;
  else if (a === 255 && (r !== 255 || g !== 255 || b !== 255)) coloured++;
}

const problems = [];
if (transparent / total < MIN_TRANSPARENT) {
  problems.push(
    `${((100 * transparent) / total).toFixed(1)} % of its pixels are fully transparent, under the ${100 * MIN_TRANSPARENT} % a silhouette leaves.`
  );
}
if (coloured > 0) problems.push(`${coloured} opaque pixels are not white.`);
if (problems.length > 0) {
  fail([
    `The Android notification icon, ${icon}, would render as a solid square in the status bar:`,
    ...problems.map((p) => `  ${p}`),
    '',
    'Android draws the small icon from its alpha channel and tints it, so it has to be a',
    'flat white glyph on transparency, with the brand colour set by the plugin `color`.',
  ]);
}
