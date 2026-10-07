#!/usr/bin/env node
// A press target with no `accessibilityRole` is announced by a screen reader as a plain element,
// with no hint that it can be pressed. `lint-source-rules.mjs` holds `src/shared/ui` at zero; the
// rest of `src/` was never counted, so the number could only grow.
//
// Demanding zero would fail every commit, so this is a ratchet in the shape of
// `lint-hand-rolled-buttons.mjs`. `scripts/roleless-pressable-baseline.json` holds the count each
// file still carries. A file above its baseline fails, a file the baseline never listed fails, and
// a file the tree has already beaten fails with the flag to paste back.
//
// Counted: an opening `<TouchableOpacity`, `<Pressable` or `<AnimatedPressable` tag, read to its
// closing `>`, that holds neither `accessibilityRole` nor a `{...props}` spread. A spread forwards
// the role from the caller, which the caller is counted for.
//
// Not counted: `src/shared/ui/` and tests.

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
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'roleless-pressable-baseline.json'));
const SRC = join(ROOT, 'src');
const WRITE = process.argv.includes('--write');

const EXEMPT = ['src/shared/ui/', 'src/__tests__/'];

const OPENING = /<(?:TouchableOpacity|Pressable|AnimatedPressable)(?=[\s/>])/g;

/** The opening tag from `start` to its closing `>`, which is the first one outside a brace. */
function openingTag(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0 && text[i - 1] !== '=') return text.slice(start, i);
  }
  return null;
}

function rolelessIn(text) {
  let n = 0;
  for (const match of text.matchAll(OPENING)) {
    const tag = openingTag(text, match.index);
    if (tag === null) continue;
    if (tag.includes('accessibilityRole') || /\{\s*\.\.\.\w+\s*\}/.test(tag)) continue;
    n += 1;
  }
  return n;
}

const tree = treeView(ROOT, [relative(ROOT, SRC)]);

const counts = {};
for (const file of tree.files(
  SRC,
  (rel) => /\.tsx?$/.test(rel) && !rel.split('/').includes('node_modules')
)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
  const hits = rolelessIn(tree.text(file));
  if (hits > 0) counts[rel] = hits;
}

const total = () => Object.values(counts).reduce((a, b) => a + b, 0);

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(counts, null, 2) + '\n');
  console.log(
    `role-less pressable baseline written: ${total()} across ${Object.keys(counts).length} files`
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
    `role-less pressable guard: ${total()} across ${Object.keys(counts).length} files, all at baseline.`
  );
  process.exit(0);
}

if (over.length > 0) {
  console.error('A pressable with no accessibilityRole above the baseline. Give it a role and a');
  console.error('label, or use Button from src/shared/ui.\n');
  for (const [file, n, allowed] of over) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
}
if (under.length > 0) {
  console.error('\nThe tree has beaten its baseline. Lower it, so the ground stays taken:');
  for (const [file, n, allowed] of under) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
  console.error('\n  npm run lint:roleless-pressables -- --write');
}
process.exit(1);
