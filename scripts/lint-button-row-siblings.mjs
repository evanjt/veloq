#!/usr/bin/env node
// Equal actions side by side are set through `ButtonRow` in `src/shared/ui/ButtonRow.tsx`.
//
// A row of `flex: 1` buttons divides its width without asking what each label needs, and a label
// wider than its share is broken inside a word. `ButtonRow` measures the words and stacks the
// buttons when a share cannot hold one.
//
// So this refuses a new `Button` whose `style` is a style key that sets `flex: 1`, outside
// `src/shared/ui`. It is a ratchet, the shape `lint-empty-state-styles.mjs` uses:
// `scripts/button-row-sibling-baseline.json` holds the count each file still carries. A file above
// its baseline fails, a file the baseline never listed fails, and a file the tree has already
// beaten fails with the number to paste back, so the list only falls.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeView } from './lib/indexedSources.mjs';
import { settleRatchet } from './lib/baselineRatchet.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'button-row-sibling-baseline.json'));
const SRC = join(ROOT, 'src');
const WRITE = process.argv.includes('--write');

const EXEMPT = ['src/shared/ui/', 'src/__tests__/'];

/** Style keys whose object sets `flex: 1`. */
const FLEX_KEY = /(\w+)\s*:\s*\{[^{}]*\bflex:\s*1\b[^{}]*\}/g;
/** A `<Button` element and the style key it takes, within its own tag. */
const BUTTON_STYLE = /<Button\b(?:[^<>]|=>)*?\bstyle=\{styles\.(\w+)\}/g;

const tree = treeView(ROOT, [relative(ROOT, SRC)]);

const counts = {};
for (const file of tree.files(
  SRC,
  (rel) => /\.tsx$/.test(rel) && !rel.split('/').includes('node_modules')
)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
  const text = tree.text(file);
  const flexKeys = new Set([...text.matchAll(FLEX_KEY)].map((m) => m[1]));
  const hits = [...text.matchAll(BUTTON_STYLE)].filter((m) => flexKeys.has(m[1])).length;
  if (hits > 0) counts[rel] = hits;
}

const total = () => Object.values(counts).reduce((a, b) => a + b, 0);

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(counts, null, 2) + '\n');
  console.log(
    `button row sibling baseline written: ${total()} across ${Object.keys(counts).length} files`
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
    `button row sibling guard: ${total()} across ${Object.keys(counts).length} files, all at baseline.`
  );
  process.exit(0);
}

if (over.length > 0) {
  console.error('A Button sharing a row through a flex: 1 style above the baseline. Set equal');
  console.error('actions through ButtonRow from src/shared/ui, which stacks them when a share');
  console.error('cannot hold the longest word of a label.\n');
  for (const [file, n, allowed] of over) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
}
process.exit(
  settleRatchet({
    over,
    under,
    line: ([file, n, allowed]) => `  ${file}  ${n}, baseline ${allowed}`,
    writeCommand: 'npm run lint:button-row-siblings -- --write',
  })
);
