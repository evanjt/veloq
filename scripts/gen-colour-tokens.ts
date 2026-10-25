#!/usr/bin/env npx tsx
/**
 * Write every colour table from the committed token file.
 *
 * Usage:
 *   npx tsx scripts/gen-colour-tokens.ts
 *   npx tsx scripts/gen-colour-tokens.ts --check   # exit 1 on drift or a gap
 *
 * `--check` reads the token file, the role map and the outputs out of the
 * index, so it judges what a commit would carry.
 */

import * as fs from 'fs';
import * as path from 'path';

import { trackedText } from './lib/indexedSources.mjs';
import {
  checkColourRoles,
  renderAppColours,
  renderRustHeatPalettes,
  renderTypeScript,
  resolveColourTokens,
  roleColours,
  staleOutputs,
  type HeatPalette,
  type RoleMap,
  type TokenFile,
} from './lib/colourTokens';

const REPO = path.resolve(__dirname, '..');
const TOKENS = 'src/theme/tokens.json';
const ROLES = 'src/theme/colourRoles.json';
const OUT_TS = 'src/theme/colourTokens.generated.ts';
const OUT_RUST = 'modules/veloqrs/rust/veloqrs/src/heatmap_ramp.rs';
const OUT_APP = 'src/theme/appColours.json';

// The engine stores one heatmap tile set and serves it to each base map in that
// base's own heat steps, swapping only the tile's palette. Satellite imagery is
// any colour under a trail, so that base rings its heat in a dark halo.
const HEAT_PALETTES: HeatPalette[] = (['light', 'dark', 'satellite'] as const).map((base) => ({
  base,
  steps: [1, 2, 3, 4, 5].map((step) => `map-${base}-heat-${step}`),
  ...(base === 'satellite' && { halo: 'neutral-950' }),
}));

// Native code draws these before any JavaScript runs: the adaptive icon, the
// splash and the notification accent, through app.config.js and the icon generator.
// The brand ground is a blue-600 to blue-700 gradient under a gold-300 to
// gold-400 mark. Native grounds take one flat colour, so they take the
// gradient's first stop.
const APP_COLOURS: Record<string, string> = {
  appColour: 'blue-600',
  appColourDeep: 'blue-700',
  markGold: 'gold-300',
  markGoldDeep: 'gold-400',
  notificationAccent: 'blue-600',
};

// The steps `brand` in colors.ts reads straight from the tokens.
const BRAND_TOKENS = [
  'blue-300',
  'blue-400',
  'blue-500',
  'blue-550',
  'blue-600',
  'blue-700',
  'gold-300',
  'gold-400',
  'gold-500',
];

const CHECK = process.argv.includes('--check');
const read = (rel: string) =>
  CHECK ? (trackedText(REPO, rel) ?? null) : fs.readFileSync(path.join(REPO, rel), 'utf-8');

function load<T>(rel: string): T {
  const text = read(rel);
  if (text === null) {
    console.error(`${rel} is not committed.`);
    process.exit(1);
  }
  return JSON.parse(text) as T;
}

async function main() {
  const file = load<TokenFile>(TOKENS);
  const map = load<RoleMap>(ROLES);

  let outputs: Record<string, string>;
  try {
    const resolved = resolveColourTokens(file);
    outputs = {
      [OUT_TS]: renderTypeScript(resolved, roleColours(resolved, map)),
      [OUT_RUST]: renderRustHeatPalettes(resolved, HEAT_PALETTES),
      [OUT_APP]: renderAppColours(resolved, APP_COLOURS),
    };
  } catch (error) {
    console.error(`${TOKENS}: ${(error as Error).message}`);
    process.exit(1);
  }

  if (CHECK) {
    const stale = staleOutputs(outputs, (rel) => trackedText(REPO, rel) ?? null);
    if (stale.length > 0) {
      for (const rel of stale) console.error(`${rel} is behind ${TOKENS}.`);
      console.error('Run: npm run gen:colour-tokens');
      process.exit(1);
    }
  } else {
    for (const [rel, text] of Object.entries(outputs)) {
      fs.writeFileSync(path.join(REPO, rel), text);
      console.log(`Wrote ${rel}`);
    }
  }

  // The palette is read after the tables are written, since it is built from them.
  const { colors, darkColors } = await import('../src/theme/colors');
  const resolved = resolveColourTokens(file);
  const problems = checkColourRoles(file, resolved, map, { light: colors, dark: darkColors }, [
    ...HEAT_PALETTES.flatMap((p) => [...p.steps, ...(p.halo ? [p.halo] : [])]),
    ...Object.values(APP_COLOURS),
    ...BRAND_TOKENS,
  ]);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`${ROLES}: ${problem}`);
    process.exit(1);
  }
  if (CHECK)
    console.log('Every colour table matches the token file, and every palette key is mapped.');
}

main();
