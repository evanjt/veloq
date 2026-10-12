#!/usr/bin/env node
// The app has one empty state, `EmptyState` in `src/shared/ui/EmptyState.tsx`,
// with a `screen`, a `compact` and an `inline` form. Before it had the inline
// form, every card and chart drew its own empty line under a local style key,
// at its own size and spacing, and the same missing data read differently on
// each screen.
//
// So this refuses a new style key named for an empty state outside
// `src/shared/ui`: `emptyText`, `emptyHint`, `emptyContainer`, `emptyTitle` or
// `emptySubtitle`, with any suffix (`emptyTextDark`). It is a ratchet, the shape
// `lint-hand-rolled-buttons.mjs` uses. `scripts/empty-state-style-baseline.json`
// holds the count each file still carries. A file above its baseline fails, a
// file the baseline never listed fails, and a file the tree has already beaten
// fails with the number to paste back, so the list only falls.
//
// Not counted: `src/shared/ui/`, where the empty state is built; and tests.

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
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'empty-state-style-baseline.json'));
const SRC = join(ROOT, 'src');
const WRITE = process.argv.includes('--write');

const EXEMPT = ['src/shared/ui/', 'src/__tests__/'];

/** A style key named for an empty state, opening an object. */
const KEY = /^\s*(?:emptyText|emptyHint|emptyContainer|emptyTitle|emptySubtitle)\w*\s*:\s*\{/gm;

const tree = treeView(ROOT, [relative(ROOT, SRC)]);

const counts = {};
for (const file of tree.files(
  SRC,
  (rel) => /\.tsx?$/.test(rel) && !rel.split('/').includes('node_modules')
)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
  const hits = (tree.text(file).match(KEY) || []).length;
  if (hits > 0) counts[rel] = hits;
}

const total = () => Object.values(counts).reduce((a, b) => a + b, 0);

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(counts, null, 2) + '\n');
  console.log(
    `empty state style baseline written: ${total()} across ${Object.keys(counts).length} files`
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
    `empty state style guard: ${total()} across ${Object.keys(counts).length} files, all at baseline.`
  );
  process.exit(0);
}

if (over.length > 0) {
  console.error('A hand-rolled empty state style above the baseline. Render EmptyState from');
  console.error("src/shared/ui, with variant 'inline' inside a card or under a chart's title.\n");
  for (const [file, n, allowed] of over) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
}
if (under.length > 0) {
  console.error('\nThe tree has beaten its baseline. Lower it, so the ground stays taken:');
  for (const [file, n, allowed] of under) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
  console.error('\n  npm run lint:empty-state-styles -- --write');
}
process.exit(1);
