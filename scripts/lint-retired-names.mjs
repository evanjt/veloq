#!/usr/bin/env node
// Names that were removed on purpose, and the places they must not come back to.
//
// Activity retention by `created_at` was cited as one of the ways an activity
// leaves the device, and it never ran. The engine function had no export and
// no caller outside two tests, the store field had a validating setter and no
// screen, and a comment beside the stream window said the path existed, which
// is what kept the belief alive. The path is gone, and a name reappearing is
// the first sign of someone rebuilding it from that belief.
//
// Tests may name these to assert they are gone, and the generated bindings
// mirror whatever the Rust doc comments say, so both are left out.

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const RETIRED = [
  {
    name: 'retentionDays',
    where: ['src', 'modules/veloqrs/src'],
    files: /\.tsx?$/,
    why: 'the activity retention setting, which no screen set and nothing read',
  },
  {
    name: 'cleanup_old_activities',
    where: ['modules/veloqrs/rust/veloqrs/src', 'modules/veloqrs/rust/veloqrs/tests'],
    files: /\.rs$/,
    why: 'the engine half of activity retention, with no export and no caller',
  },
  {
    name: 'RouteSettingsStore',
    where: ['src/features/settings/lib/streamRetention.ts'],
    files: /\.ts$/,
    why: 'the stream window is a different knob; the comment pointing here kept the belief alive',
  },
];

function skipped(file) {
  return /(^|\/)(__tests__|__mocks__|generated|target|node_modules)\//.test(file);
}

const pathspec = [...new Set(RETIRED.flatMap((r) => r.where))];
const tracked = indexedSources(root, pathspec);
refuseEmptyListing(tracked, 'Retired names guard');

const failures = [];
for (const [file, bytes] of tracked) {
  if (skipped(file)) continue;
  const rules = RETIRED.filter(
    (r) => r.files.test(file) && r.where.some((w) => file === w || file.startsWith(`${w}/`))
  );
  if (rules.length === 0) continue;
  const lines = bytes.toString('utf8').split('\n');
  for (const rule of rules) {
    lines.forEach((line, i) => {
      if (line.includes(rule.name)) failures.push(`${file}:${i + 1}  ${rule.name}: ${rule.why}`);
    });
  }
}

if (failures.length > 0) {
  console.error(`A retired name is back where it was removed from: ${failures.length}.\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Retired names guard: none has come back.');
