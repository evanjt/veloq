#!/usr/bin/env node
// `colors.success` (#22C55E) measures 2.28:1 on white and `colors.warning`
// (#F59E0B) 2.15:1. Neither clears the 4.5:1 a text or icon colour needs, nor
// even the 3:1 for a graphical object. As a *fill* they are fine, because the
// mark on top carries the contrast; as the mark itself they are not.
//
// So this guard holds the mark and leaves the ground alone: `color`,
// `borderColor` and `tintColor` fail, `backgroundColor` does not. The light
// palette already carries compliant tones for two of the three, `warningAmber`
// at 7.09:1 and `errorDark` at 4.83:1, and `successDeep` is the green.
//
// Dark mode is not the problem: `darkColors.success` and `.warning` are light
// tones on a near-black surface and clear the bar comfortably. It is
// `colors.*`, the light set, that this names.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);
const SRC = join(ROOT, 'src');

const EXEMPT = [
  'src/theme/colors.ts',
  'src/theme/index.ts',
  // One sport group has no colour of its own and falls back to a semantic
  // token, which this guard then reads as a verdict green. The value is used
  // as the chip's fill when selected and its label when not, so it cannot
  // simply take a deep tone: the group needs a colour in the sport palette.
  // That is its own finding, not this guard's to force.
  'src/features/maps/components/ActivityTypeFilter.tsx',
];

/** The property this line is setting, for the message. */
const PROP = /\b(color|borderColor|tintColor)\b/;

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === '__mocks__') continue;
      out.push(...walk(full));
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(name) || /\.d\.ts$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

/**
 * The `darkColors` status tones. These are chosen for a near-black surface, so
 * one read with no theme branch is the same defect in the other direction: the
 * energy card drew `darkColors.amberIcon` (#FBBF24, 2.15:1 on white) in both
 * themes. Only the status tones, not the text ones: a `textLight` or
 * `textMutedDark` style is dark-only by convention and applied conditionally,
 * which is correct and is most of what a wider rule would flag.
 */
const DARK_TONE =
  /\b(?:color|borderColor|tintColor)\s*[:=]\s*darkColors\.(amberIcon|warningAmber|success|successDeep|warning|error|successLight|errorLight|warningLight)\b/;

/** A style key ending in `Dark` is a dark-only entry, applied under `isDark`. */
const DARK_KEY = /^\s*([A-Za-z0-9_]+):\s*\{\s*$/;

function unbranchedDarkTones(file, rel) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const out = [];
  let key = null;
  lines.forEach((line, i) => {
    const k = line.match(DARK_KEY);
    if (k) key = k[1];
    if (!DARK_TONE.test(line)) return;
    if (/isDark|\?/.test(line)) return;
    if (key && /Dark$/.test(key)) return;
    // A guard a line or two above, the shape `if (isDark && ...) { color = ... }`.
    if (lines.slice(Math.max(0, i - 3), i).some((l) => /isDark/.test(l))) return;
    out.push(`${rel}:${i + 1}  ${line.trim().slice(0, 96)}`);
  });
  return out;
}

const failures = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (EXEMPT.includes(rel)) continue;
  failures.push(...unbranchedDarkTones(file, rel));
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/backgroundColor/.test(line)) return;
    // A map layer's line is drawn over tiles, not over an app surface, so the
    // surface bar does not describe it and its own item decides its colour.
    if (/'line-color'|'circle-color'|'fill-color'/.test(line)) return;
    // A translucent border is decoration on a tinted card, not a mark: the
    // text inside it is what has to be legible.
    if (/colorWithOpacity\(|\+ '[0-9A-Fa-f]{2}'/.test(line)) return;
    if (!PROP.test(line)) return;
    if (!/colors\.(success|warning)\b/.test(line)) return;
    if (/darkColors\.(success|warning)\b/.test(line) && !/[^k]colors\.(success|warning)\b/.test(line))
      return;
    failures.push(`${rel}:${i + 1}  ${line.trim().slice(0, 96)}`);
  });
}

if (failures.length > 0) {
  console.error(
    `A mark drawn in a token that cannot carry one: ${failures.length}. colors.success is 2.28:1 on white and colors.warning 2.15:1.`
  );
  console.error(
    'Use verdictColor(rung, isDark) for a verdict, or colors.successDeep / colors.warningAmber for a mark that is not one.\n'
  );
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Mark contrast guard: no icon, border or text drawn in a fill-only token.');
