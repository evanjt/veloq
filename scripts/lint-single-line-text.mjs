#!/usr/bin/env node
// Text that carries information is never cut off. A single line that ends in
// an ellipsis turns a number into a different number and two names into the
// same name, so a value, a unit, a date or a control label goes through
// `FitText`, which shrinks it to fit, and a name the athlete gave goes through
// `NameText`, which wraps it to two lines and gives a screen reader the whole
// of it. Everything else wraps with no limit at all. Both live in
// `src/shared/ui`, and those two files are the only places a single-line limit
// is written as a matter of course.
//
// Counted, per file under `src`, tests aside: every `numberOfLines={1}`.
//
// The sites left are tab labels, animated text that cannot take either owner,
// and fixed boxes still being sized, so this is a ratchet in the shape of
// `lint-row-chevrons.mjs`. `scripts/single-line-text-baseline.json` holds the
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
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'single-line-text-baseline.json'));
const WRITE = process.argv.includes('--write');

const SCOPES = ['src'];

/** The two owners, which set the limit on behalf of every caller. */
const OWNERS = new Set(['src/shared/ui/FitText.tsx', 'src/shared/ui/NameText.tsx']);

/** A Text held to one line. */
const MARK = /numberOfLines=\{\s*1\s*\}/g;

const tree = treeView(ROOT, SCOPES);

const counts = {};
for (const scope of SCOPES) {
  for (const file of tree.files(
    join(ROOT, scope),
    (rel) =>
      /\.tsx?$/.test(rel) &&
      !rel.split('/').includes('node_modules') &&
      !rel.split('/').includes('__tests__')
  )) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (OWNERS.has(rel)) continue;
    const hits = (tree.text(file).match(MARK) || []).length;
    if (hits > 0) counts[rel] = hits;
  }
}

const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
const total = () => Object.values(counts).reduce((a, b) => a + b, 0);

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(sorted, null, 2) + '\n');
  console.log(
    `single-line text baseline written: ${total()} across ${Object.keys(counts).length} files`
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
    `single-line text guard: ${total()} across ${Object.keys(counts).length} files, all at baseline.`
  );
  process.exit(0);
}

if (over.length > 0) {
  console.error('A Text held to one line outside FitText and NameText. A value, unit, date or');
  console.error('control label takes FitText, a name the athlete gave takes NameText, and');
  console.error('anything else wraps with no line limit.\n');
  for (const [file, n, allowed] of over) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
}
if (under.length > 0) {
  console.error('\nThe tree has beaten its baseline. Lower it, so the ground stays taken:');
  for (const [file, n, allowed] of under) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
  console.error('\n  npm run lint:single-line-text -- --write');
}
process.exit(1);
