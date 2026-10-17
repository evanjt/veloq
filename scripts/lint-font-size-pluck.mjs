#!/usr/bin/env node
// A text style that reads one role's `fontSize` and sets a weight of its own
// keeps the size and drops the rest of the role: its line height, tracking,
// family and tabular figures. Two texts meant to match then draw at two line
// heights, and a figure loses its fixed digit width. A type style is spread
// whole, `...typography.captionBold`, and overrides only what it must.
//
// About 160 plucks remain whose size and weight no role holds, so this is a
// ratchet in the shape of `lint-heading-tokens.mjs` rather than a rule that
// refuses. `scripts/font-size-pluck-baseline.json` holds the plucks each file
// still carries. A file above its baseline fails, a file the baseline never
// listed fails, and a file the tree has already beaten fails with the flag to
// paste back.
//
// Counted: `fontSize: typography.<role>.fontSize`.
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
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'font-size-pluck-baseline.json'));
const SRC = join(ROOT, 'src');
const WRITE = process.argv.includes('--write');

const EXEMPT = ['src/theme/', 'src/__tests__/'];

const PLUCK = /\bfontSize:\s*typography\.\w+\.fontSize\b/g;

const tree = treeView(ROOT, [relative(ROOT, SRC)]);

const counts = {};
for (const file of tree.files(
  SRC,
  (rel) =>
    /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel) && !rel.split('/').includes('node_modules')
)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
  const hits = (tree.text(file).match(PLUCK) || []).length;
  if (hits > 0) counts[rel] = hits;
}

const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
const total = () => Object.values(counts).reduce((a, b) => a + b, 0);

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(sorted, null, 2) + '\n');
  console.log(
    `font size pluck baseline written: ${total()} across ${Object.keys(counts).length} files`
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
    `font size pluck guard: ${total()} across ${Object.keys(counts).length} files, all at baseline.`
  );
  process.exit(0);
}

if (over.length > 0) {
  console.error("A role's font size read alone, which drops its line height, tracking and");
  console.error('figures. Spread the whole role from src/theme, `...typography.<role>`.\n');
  for (const [file, n, allowed] of over) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
}
if (under.length > 0) {
  console.error('\nThe tree has beaten its baseline. Lower it, so the ground stays taken:');
  for (const [file, n, allowed] of under) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
  console.error('\n  npm run lint:font-size-pluck -- --write');
}
process.exit(1);
