#!/usr/bin/env node
// Generates src/strength/catalogue_table.rs from the fitparser profile: one row per named
// exercise, with its snake_case label key, equipment, one-sided flag and body region.
//   node scripts/generate-exercise-catalogue.mjs [path/to/field_types.rs]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const registry = join(homedir(), '.cargo/registry/src');
const defaultProfile = () => {
  for (const d of readdirSync(registry)) {
    try {
      const p = join(registry, d, 'fitparser-0.11.0/src/profile/field_types.rs');
      readFileSync(p);
      return p;
    } catch {}
  }
  throw new Error('fitparser-0.11.0 not found; pass field_types.rs');
};
const src = readFileSync(process.argv[2] ?? defaultProfile(), 'utf8');
const out = 'modules/veloqrs/rust/veloqrs/src/strength/catalogue_table.rs';

// Category ids from `impl From<u16> for ExerciseCategory`.
const catBlock = src.match(/impl convert::From<u16> for ExerciseCategory \{[\s\S]*?\n\}\n/)[0];
const categories = new Map();
for (const m of catBlock.matchAll(/(\d+) => ExerciseCategory::(\w+),/g))
  categories.set(m[2], Number(m[1]));

// Category regions follow the primary muscles in `exercise_muscle_groups`.
const categoryRegion = {
  BenchPress: 'chest',
  CalfRaise: 'legs',
  Carry: 'core',
  Chop: 'core',
  Core: 'core',
  Crunch: 'core',
  Curl: 'arms',
  Deadlift: 'legs',
  Flye: 'chest',
  HipRaise: 'legs',
  HipStability: 'legs',
  HipSwing: 'legs',
  Hyperextension: 'back',
  LateralRaise: 'shoulders',
  LegCurl: 'legs',
  LegRaise: 'core',
  Lunge: 'legs',
  OlympicLift: 'legs',
  Plank: 'core',
  Plyo: 'legs',
  PullUp: 'back',
  PushUp: 'chest',
  Row: 'back',
  ShoulderPress: 'shoulders',
  ShoulderStability: 'shoulders',
  Shrug: 'shoulders',
  SitUp: 'core',
  Squat: 'legs',
  TotalBody: 'legs',
  TricepsExtension: 'arms',
};
// Categories past the strength set take a region only where the name makes the target clear.
const nameRegion = [
  [/bicep|curl|tricep|forearm|wrist/, 'arms'],
  [
    /shoulder|lateral_raise|front_raise|face_pull|upright_row|rotator|external_rotation|internal_rotation/,
    'shoulders',
  ],
  [/chest|fly|push_?up|bench/, 'chest'],
  [/lat|pull_?down|pull_apart|row|back_extension|superman/, 'back'],
  [/crunch|plank|ab_|twist|deadbug|sit_?up|core|leg_lift|mountain/, 'core'],
  [
    /squat|lunge|glute|hip|hamstring|calf|leg_|clam|kick|bridge|deadlift|abduction|adduction|step_up|thruster/,
    'legs',
  ],
];
const equipmentOf = (k) => {
  if (/(^|_)(barbell|ez_bar|smith_machine|olympic_bar)(_|$)/.test(k)) return 'barbell';
  if (/dumbbell|dumbell/.test(k)) return 'dumbbell';
  if (/kettlebell/.test(k)) return 'kettlebell';
  if (/cable|pulldown_with_cable/.test(k)) return 'cable';
  if (/machine|leg_press|lat_pulldown|pec_deck|seated_row_machine/.test(k)) return 'machine';
  if (/band|banded|resistance/.test(k)) return 'band';
  if (
    /bodyweight|body_weight|push_up|pull_up|chin_up|plank|crunch|sit_up|burpee|dip|jumping|mountain/.test(
      k
    )
  )
    return 'bodyweight';
  return 'other';
};
const oneSided = (k) =>
  /(^|_)(single|one)_(arm|leg)|(^|_)(unilateral)(_|$)|(^|_)(left|right)(_|$)|single_(arm|leg)|one_arm|one_leg/.test(
    k
  );

const rows = [];
for (const m of src.matchAll(/pub enum (\w+)ExerciseName \{/g)) {
  const enumName = `${m[1]}ExerciseName`;
  const catName = m[1];
  if (!categories.has(catName)) throw new Error(`no category for ${enumName}`);
  const cat = categories.get(catName);
  const asU16 = src.match(
    new RegExp(
      `impl ${enumName} \\{[\\s\\S]*?pub fn as_u16\\(self\\) -> u16 \\{[\\s\\S]*?\\n        \\}`
    )
  )[0];
  const display = src.match(
    new RegExp(`impl fmt::Display for ${enumName} \\{[\\s\\S]*?\\n\\}\\n`)
  )[0];
  const keys = new Map();
  for (const d of display.matchAll(
    new RegExp(`${enumName}::(\\w+)\\s*=>\\s*(?:\\{\\s*)?write!\\(\\s*f,\\s*"([^"]*)"`, 'g')
  ))
    keys.set(d[1], d[2]);
  for (const v of asU16.matchAll(new RegExp(`${enumName}::(\\w+) => (\\d+),`, 'g'))) {
    if (v[1] === 'Value') continue;
    const key = keys.get(v[1]);
    if (!key) throw new Error(`no key for ${enumName}::${v[1]}`);
    let region = categoryRegion[catName];
    if (!region && cat > 32) region = (nameRegion.find(([re]) => re.test(key)) ?? [])[1];
    rows.push([cat, Number(v[2]), key, equipmentOf(key), oneSided(key), region ?? null]);
  }
}
rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const eq = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  kettlebell: 'Kettlebell',
  cable: 'Cable',
  machine: 'Machine',
  band: 'Band',
  bodyweight: 'Bodyweight',
  other: 'Other',
};
const rg = (r) => (r ? `Some(Region::${r[0].toUpperCase()}${r.slice(1)})` : 'None');
const lines = rows.map(
  ([c, n, k, e, o, r]) => `    (${c}, ${n}, "${k}", Equipment::${eq[e]}, ${o}, ${rg(r)}),`
);
writeFileSync(
  out,
  `//! Generated by scripts/generate-exercise-catalogue.mjs from the fitparser profile. Do not edit.\n\nuse super::catalogue::{Equipment, Region};\n\n/// (category, name, label key, equipment, one-sided, region), sorted by category then name.\npub(super) const TABLE: &[(u16, u16, &str, Equipment, bool, Option<Region>)] = &[\n${lines.join('\n')}\n];\n`
);
execFileSync('rustfmt', ['--edition', '2021', out]);
console.log(`${rows.length} exercises`);
