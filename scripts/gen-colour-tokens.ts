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
  renderRustHeatRamp,
  renderTypeScript,
  resolveColourTokens,
  roleColours,
  staleOutputs,
  type HeatStop,
  type RoleMap,
  type TokenFile,
} from './lib/colourTokens';

const REPO = path.resolve(__dirname, '..');
const TOKENS = 'src/theme/tokens.json';
const ROLES = 'src/theme/colourRoles.json';
const OUT_TS = 'src/theme/colourTokens.generated.ts';
const OUT_RUST = 'modules/veloqrs/rust/veloqrs/src/heatmap_ramp.rs';
const OUT_APP = 'src/theme/appColours.json';

// The heatmap is painted once in the engine and drawn over every map style, so
// it takes one ramp: the dark map's heat steps, faint to pale. The light map's
// raster paint inverts lightness, so the same ramp darkens with density there.
// The alphas start high enough that the faintest stops composite at 3:1 over
// every light map ground and the faintest to the densest at 3:1 over land,
// which the engine's own tests measure.
const HEAT_STOPS: HeatStop[] = [
  { intensity: 0.04, token: 'map-dark-heat-1', alpha: 176 },
  { intensity: 0.2, token: 'map-dark-heat-2', alpha: 194 },
  { intensity: 0.45, token: 'map-dark-heat-3', alpha: 212 },
  { intensity: 0.75, token: 'map-dark-heat-4', alpha: 230 },
  { intensity: 1, token: 'map-dark-heat-5', alpha: 248 },
];

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
      [OUT_TS]: renderTypeScript(resolved, roleColours(resolved, map), HEAT_STOPS),
      [OUT_RUST]: renderRustHeatRamp(resolved, HEAT_STOPS),
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
    ...HEAT_STOPS.map((s) => s.token),
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
