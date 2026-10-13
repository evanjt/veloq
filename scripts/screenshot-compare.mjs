#!/usr/bin/env node
// Compare the demo-mode screen captures against their goldens.
//
//   node scripts/screenshot-compare.mjs --platform android|ios \
//     [--candidates screenshots/compare] [--goldens .maestro/goldens] \
//     [--diffs screenshots/compare-diffs]
//
// The goldens sit at <goldens>/<platform>/<theme>/<screen>.png, the candidates
// at <candidates>/<theme>/<screen>.png, as `.maestro/screen-compare.yaml`
// writes them. `<goldens>/masks.json` names every screen and the rectangles
// each one ignores, in fractions of the image: `everyScreen` applies to all of
// them, `screens.<name>` to that one, and a rectangle carrying `platform`
// applies on that platform only.
//
// Two captures of one build differed only where the content moved: map
// imagery, a progress spinner, a growing cache size and the status bar. With
// those masked, every screen measured 0.000% run to run on both platforms and
// both themes, 0.006% at most. So a pixel counts as different when any channel
// moved at all, and a screen fails above 0.1% of its unmasked pixels, which a
// text row moved by one pixel exceeds.
//
// A missing golden fails. Goldens are recorded only after the owner signs off
// a before-and-after report, so nothing here writes one.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import pngjs from 'pngjs';

const { PNG } = pngjs;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORMS = ['android', 'ios'];
const THEMES = ['light', 'dark'];
const TOLERANCE = 0.001;

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  if (!value || value.startsWith('--')) refuse(`--${name} needs a value`);
  return value;
}

function refuse(message) {
  console.error(`screenshot-compare: ${message}`);
  process.exit(2);
}

const platform = flag('platform');
if (!PLATFORMS.includes(platform)) refuse(`--platform must be one of ${PLATFORMS.join(', ')}`);
const goldens = resolve(flag('goldens', join(ROOT, '.maestro/goldens')));
const candidates = resolve(flag('candidates', join(ROOT, 'screenshots/compare')));
const diffs = resolve(flag('diffs', join(ROOT, 'screenshots/compare-diffs')));

const masksFile = join(goldens, 'masks.json');
if (!existsSync(masksFile)) refuse(`no ${masksFile}: it names the screens to compare`);
const masks = JSON.parse(readFileSync(masksFile, 'utf8'));
const screens = Object.keys(masks.screens ?? {});
if (screens.length === 0) refuse(`${masksFile} names no screens`);

function read(file) {
  return PNG.sync.read(readFileSync(file));
}

/** Whether each pixel is compared: false inside a mask that applies here. */
function keepMap(width, height, rects) {
  const keep = new Uint8Array(width * height).fill(1);
  for (const r of rects) {
    if (r.platform && r.platform !== platform) continue;
    const x0 = Math.floor(r.x0 * width);
    const x1 = Math.ceil(r.x1 * width);
    const y0 = Math.floor(r.y0 * height);
    const y1 = Math.ceil(r.y1 * height);
    for (let y = y0; y < y1; y++) keep.fill(0, y * width + x0, y * width + x1);
  }
  return keep;
}

/** Copy the golden into the candidate wherever a mask covers it. */
function applyMask(golden, candidate, keep) {
  const masked = Buffer.from(candidate.data);
  for (let p = 0; p < keep.length; p++) {
    if (keep[p]) continue;
    golden.data.copy(masked, p * 4, p * 4, p * 4 + 4);
  }
  return masked;
}

function compareScreen(theme, screen) {
  const label = `${platform} ${theme} ${screen}`;
  const goldenFile = join(goldens, platform, theme, `${screen}.png`);
  const candidateFile = join(candidates, theme, `${screen}.png`);
  if (!existsSync(goldenFile)) {
    return `${label}: no golden at ${goldenFile}; one is recorded only on the owner's sign-off`;
  }
  if (!existsSync(candidateFile)) return `${label}: no capture at ${candidateFile}`;

  const golden = read(goldenFile);
  const candidate = read(candidateFile);
  const { width, height } = golden;
  if (candidate.width !== width || candidate.height !== height) {
    return `${label}: the capture is ${candidate.width}x${candidate.height} and the golden ${width}x${height}`;
  }

  const keep = keepMap(width, height, [...(masks.everyScreen ?? []), ...masks.screens[screen]]);
  const compared = keep.reduce((n, k) => n + k, 0);
  const diff = new PNG({ width, height });
  const differing = pixelmatch(
    golden.data,
    applyMask(golden, candidate, keep),
    diff.data,
    width,
    height,
    { threshold: 0, includeAA: true }
  );
  const share = compared === 0 ? 0 : differing / compared;
  const percent = `${(share * 100).toFixed(3)}%`;
  if (share <= TOLERANCE) {
    console.log(`screenshot-compare: ${label}: ${percent} differ`);
    return null;
  }

  const diffFile = join(diffs, platform, theme, `${screen}.png`);
  mkdirSync(dirname(diffFile), { recursive: true });
  writeFileSync(diffFile, PNG.sync.write(diff));
  return `${label}: ${percent} of unmasked pixels differ, above ${(TOLERANCE * 100).toFixed(1)}%; diff at ${diffFile}`;
}

const failures = THEMES.flatMap((theme) => screens.map((s) => compareScreen(theme, s))).filter(
  Boolean
);
for (const failure of failures) console.error(`screenshot-compare: ${failure}`);
if (failures.length > 0) {
  console.error(
    `screenshot-compare: ${failures.length} of ${THEMES.length * screens.length} screens failed.`
  );
  process.exit(1);
}
console.log(`screenshot-compare: ${THEMES.length * screens.length} screens match on ${platform}.`);
