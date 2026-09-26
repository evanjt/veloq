#!/usr/bin/env node
// The app has one Button, at `src/shared/ui/Button.tsx`. The sweep of the call
// sites onto it was never done, so the shared `Button` is read in two files
// while `TouchableOpacity` is rendered 265 times across 101 files and the same
// tap gives a different shape, colour and feedback on each screen.
//
// Demanding zero would fail every commit, so this is a ratchet, the shape
// `lint-rgba-literals.mjs` and `lint-feature-imports.mjs` use.
// `scripts/hand-rolled-button-baseline.json` holds the count each file still
// carries. A file above its baseline fails, a file the baseline never listed
// fails, and a file the tree has already beaten fails with the number to paste
// back, so ground a sweep takes cannot be given away again.
//
// Counted: a rendered `<TouchableOpacity` or `<Pressable`, which is the shape a
// hand-rolled button takes. Not the imports: a file can import one and render
// several, and it is the rendered controls the sweep replaces.
//
// Not counted: `src/shared/ui/`, where `Button` and the press primitives are
// built; tests; and `src/features/maps/` overlays, whose press targets sit on a
// map surface rather than in the layout and belong to the press-feedback sweep.
//
// A press target that is not a button, a card or a row stays on `Pressable`.
// The ratchet does not know the difference, which is why it is a ceiling that
// falls rather than a rule that refuses: a sweep lowers the number for the
// controls it converted and leaves the rest standing.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'hand-rolled-button-baseline.json'));
const SRC = join(ROOT, 'src');
const WRITE = process.argv.includes('--write');

const EXEMPT = ['src/shared/ui/', 'src/__tests__/', 'src/features/maps/'];

/** A rendered press primitive, opening tag only. */
const RENDERED = /<(?:TouchableOpacity|Pressable)[\s/>]/g;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const counts = {};
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
  const hits = (readFileSync(file, 'utf8').match(RENDERED) || []).length;
  if (hits > 0) counts[rel] = hits;
}

const total = () => Object.values(counts).reduce((a, b) => a + b, 0);

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(counts, null, 2) + '\n');
  console.log(
    `hand-rolled button baseline written: ${total()} across ${Object.keys(counts).length} files`
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
    `hand-rolled button guard: ${total()} across ${Object.keys(counts).length} files, all at baseline.`
  );
  process.exit(0);
}

if (over.length > 0) {
  console.error('A hand-rolled button above the baseline. Use Button or ToggleButton from');
  console.error('src/shared/ui, or lower another file to pay for it.\n');
  for (const [file, n, allowed] of over) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
}
if (under.length > 0) {
  console.error('\nThe tree has beaten its baseline. Lower it, so the ground stays taken:');
  for (const [file, n, allowed] of under) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
  console.error('\n  npm run lint:hand-rolled-buttons -- --write');
}
process.exit(1);
