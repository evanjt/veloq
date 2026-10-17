#!/usr/bin/env node
// The two smallest type styles, `pillLabel` at 9px and `micro` at 10px, are
// the floor of the scale and are for one or two words: a chip value, an axis
// tick, a zone letter. A sentence set at either is the line a reader cannot
// read at the largest text size, so a sentence takes `caption`. Licence and
// attribution text is the one sentence allowed at `micro`.
//
// Most reads left are chart ticks and chip values still being moved to the
// chart text size, so this is a ratchet in the shape of
// `lint-font-size-pluck.mjs`. `scripts/floor-type-style-baseline.json` holds
// the reads each file still carries. A file above its baseline fails, a file
// the baseline never listed fails, and a file the tree has already beaten
// fails with the flag to paste back.
//
// Counted: every `typography.pillLabel` and `typography.micro`, spread or
// plucked.
//
// Not counted: `src/theme/`, which defines the roles, and tests.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'floor-type-style-baseline.json'));
const SRC = join(ROOT, 'src');
const WRITE = process.argv.includes('--write');

const EXEMPT = ['src/theme/', 'src/__tests__/'];

const FLOOR_READ = /\btypography\.(?:pillLabel|micro)\b/g;

const tree = treeView(ROOT, [relative(ROOT, SRC)]);

const counts = {};
for (const file of tree.files(
  SRC,
  (rel) =>
    /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel) && !rel.split('/').includes('node_modules')
)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
  const hits = (tree.text(file).match(FLOOR_READ) || []).length;
  if (hits > 0) counts[rel] = hits;
}

const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
const total = () => Object.values(counts).reduce((a, b) => a + b, 0);

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(sorted, null, 2) + '\n');
  console.log(
    `floor type style baseline written: ${total()} across ${Object.keys(counts).length} files`
  );
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
const over = [];
const under = [];
for (const [file, n] of Object.entries(counts)) {
  const allowed = baseline[file] ?? 0;
  if (n > allowed) over.push([file, n, allowed]);
  else if (n < allowed) under.push([file, n, allowed]);
}
for (const file of Object.keys(baseline)) {
  if (!(file in counts)) under.push([file, 0, baseline[file]]);
}

if (over.length === 0 && under.length === 0) {
  console.log(
    `floor type style guard: ${total()} across ${Object.keys(counts).length} files, all at baseline.`
  );
  process.exit(0);
}

if (over.length > 0) {
  console.error('A read of the 9px pillLabel or the 10px micro style past the baseline. They');
  console.error('are for one or two words; a sentence takes `...typography.caption`, and');
  console.error('licence or attribution text alone may sit at micro.\n');
  for (const [file, n, allowed] of over) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
}
if (under.length > 0) {
  console.error('\nThe tree has beaten its baseline. Lower it, so the ground stays taken:');
  for (const [file, n, allowed] of under) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
  console.error('\n  npm run lint:floor-type-styles -- --write');
}
process.exit(1);
