#!/usr/bin/env node
// A disclosure chevron promises that pressing the row opens something else,
// and the shared `Row` in `src/shared/ui/Row.tsx` is the one place that draws
// it: a row marked `navigate` gets it and a row marked `act` does not. Rows
// built beside it drew their own chevron at 20, 22 and 24 pt, or typed a '›'
// after the label, and rows that ran an action, a destructive one among them,
// wore the same mark as rows that open a screen.
//
// Counted, per file under `src/app` and `src/features`: every `chevron-right`
// icon name and every '›' character. Both are a disclosure mark drawn by hand.
//
// Demanding zero would fail every commit, since chevrons on cards, popups and
// expand toggles have not been swept yet, so this is a ratchet in the shape of
// `lint-hand-rolled-buttons.mjs`. `scripts/row-chevron-baseline.json` holds the
// count each file still carries. A file above its baseline fails, a file the
// baseline never listed fails, and a file the tree has already beaten fails
// with the command that lowers it, so ground a sweep takes stays taken.

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
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'row-chevron-baseline.json'));
const WRITE = process.argv.includes('--write');

const SCOPES = ['src/app', 'src/features'];

/** A chevron icon name in either quote, or a typed disclosure arrow. */
const MARK = /['"]chevron-right['"]|›/g;

const tree = treeView(ROOT, SCOPES);

const counts = {};
for (const scope of SCOPES) {
  for (const file of tree.files(
    join(ROOT, scope),
    (rel) => /\.tsx?$/.test(rel) && !rel.split('/').includes('node_modules')
  )) {
    const rel = relative(ROOT, file).split('\\').join('/');
    const hits = (tree.text(file).match(MARK) || []).length;
    if (hits > 0) counts[rel] = hits;
  }
}

const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
const total = () => Object.values(counts).reduce((a, b) => a + b, 0);

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(sorted, null, 2) + '\n');
  console.log(
    `row chevron baseline written: ${total()} across ${Object.keys(counts).length} files`
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
    `row chevron guard: ${total()} across ${Object.keys(counts).length} files, all at baseline.`
  );
  process.exit(0);
}

if (over.length > 0) {
  console.error('A disclosure chevron or typed › drawn outside the shared Row. Use Row from');
  console.error(
    "src/shared/ui with behaviour 'navigate', or 'act' for a row that opens nothing.\n"
  );
  for (const [file, n, allowed] of over) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
}
if (under.length > 0) {
  console.error('\nThe tree has beaten its baseline. Lower it, so the ground stays taken:');
  for (const [file, n, allowed] of under) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
  console.error('\n  npm run lint:row-chevrons -- --write');
}
process.exit(1);
