#!/usr/bin/env node
// A title styled by hand with the section or card title type role looks like a heading and is
// not one: nothing gives it the header role, so the headings rotor and heading navigation skip
// it. The title components in `src/shared/ui` carry the role, `SectionTitle` for a title outside
// a card, a list group or a sheet.
//
// Not every read is a title. Some borrow the size for a figure, so this is a ratchet in the
// shape of `lint-hand-rolled-buttons.mjs` rather than a rule that refuses.
// `scripts/heading-token-baseline.json` holds the reads each file still carries. A file above
// its baseline fails, a file the baseline never listed fails, and a file the tree has already
// beaten fails with the flag to paste back.
//
// Counted: `typography.sectionTitle` and `typography.cardTitle`, spread or read by property.
//
// Not counted: `src/shared/ui/`, where the title components are built, and tests.

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
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'heading-token-baseline.json'));
const SRC = join(ROOT, 'src');
const WRITE = process.argv.includes('--write');

const EXEMPT = ['src/shared/ui/', 'src/__tests__/'];

const READ = /\btypography\.(?:sectionTitle|cardTitle)\b/g;

const tree = treeView(ROOT, [relative(ROOT, SRC)]);

const counts = {};
for (const file of tree.files(
  SRC,
  (rel) => /\.tsx?$/.test(rel) && !rel.split('/').includes('node_modules')
)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
  const hits = (tree.text(file).match(READ) || []).length;
  if (hits > 0) counts[rel] = hits;
}

const total = () => Object.values(counts).reduce((a, b) => a + b, 0);

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(counts, null, 2) + '\n');
  console.log(
    `heading token baseline written: ${total()} across ${Object.keys(counts).length} files`
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
    `heading token guard: ${total()} across ${Object.keys(counts).length} files, all at baseline.`
  );
  process.exit(0);
}

if (over.length > 0) {
  console.error('A title role read outside the shared title components, which carry the header');
  console.error('role. Use SectionTitle or the card title from src/shared/ui.\n');
  for (const [file, n, allowed] of over) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
}
if (under.length > 0) {
  console.error('\nThe tree has beaten its baseline. Lower it, so the ground stays taken:');
  for (const [file, n, allowed] of under) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
  console.error('\n  npm run lint:heading-tokens -- --write');
}
process.exit(1);
