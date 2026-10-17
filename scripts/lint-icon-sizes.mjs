#!/usr/bin/env node
// An icon is drawn at one of six sizes, read from `iconSize` in `src/theme`.
// The app drew seventeen, set as literals and as file-local constants, so one
// screen's glyph read larger than its neighbour's and nothing held the ladder.
//
// Counted: a rendered `<Icon` or `<MaterialCommunityIcons` whose `size` is a number, a
// constant, a type role's font size or any expression holding one, or which
// sets no size and so draws at the library default. The shared wrappers that
// draw one, `DisclosureChevron`, `DirectionArrow`, `SportIcons` and the two
// compass arrows, count the same way when given a size. Not counted: a size that
// reads `iconSize`, and a bare prop passed through from the caller, such as
// `size={size}`, since the caller is where that number is chosen. Tests are
// not counted.
//
// A ratchet in the shape of `lint-hand-rolled-buttons.mjs`.
// `scripts/icon-size-baseline.json` holds the count each file still carries.
// A file above its baseline fails, a file the baseline never listed fails, and
// a file the tree has already beaten fails with the command that lowers it.

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
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'icon-size-baseline.json'));
const SRC = join(ROOT, 'src');
const WRITE = process.argv.includes('--write');

const EXEMPT = ['src/__tests__/'];

const ICON =
  /<(MaterialCommunityIcons|Icon|DisclosureChevron|DirectionArrow|SportIcons|CompassArrow|StaticCompassArrow)\b/g;

/** A prop passed through untouched: `size`, `props.size`, `iconSize` as a prop. */
const PASS_THROUGH = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/;

/** The opening tag from `start`, to its `>` outside any brace. */
function tagAt(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && c === '>') return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** The `size` expression of a tag, `null` when it sets none. */
function sizeOf(tag) {
  const m = /\ssize=(\{|"|')/.exec(tag);
  if (!m) return null;
  if (m[1] !== '{') return '"';
  let depth = 1;
  let j = m.index + m[0].length;
  for (; j < tag.length && depth > 0; j++) {
    if (tag[j] === '{') depth++;
    else if (tag[j] === '}') depth--;
  }
  return tag.slice(m.index + m[0].length, j - 1).trim();
}

function offLadder(element, tag) {
  if (/\{\s*\.\.\./.test(tag) && !/\ssize=/.test(tag)) return false;
  const size = sizeOf(tag);
  if (size === null) return element === 'MaterialCommunityIcons' || element === 'Icon';
  if (size === '"') return true;
  if (/^iconSize\.[a-z]+$/.test(size)) return false;
  if (/\biconSize\.[a-z]+/.test(size) && !/\b\d/.test(size) && !/\b[A-Z][A-Z0-9_]+\b/.test(size)) {
    return false;
  }
  return !PASS_THROUGH.test(size) || size.startsWith('typography.');
}

const tree = treeView(ROOT, [relative(ROOT, SRC)]);

const counts = {};
for (const file of tree.files(
  SRC,
  // Only a .tsx file draws JSX, so a tag named in a .ts comment is not counted.
  (rel) => /\.tsx$/.test(rel) && !rel.split('/').includes('node_modules')
)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
  const text = tree.text(file);
  let hits = 0;
  for (const m of text.matchAll(ICON)) {
    if (offLadder(m[1], tagAt(text, m.index + m[0].length))) hits++;
  }
  if (hits > 0) counts[rel] = hits;
}

const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
const total = () => Object.values(counts).reduce((a, b) => a + b, 0);

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`icon size baseline written: ${total()} across ${Object.keys(counts).length} files`);
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
    `icon size guard: ${total()} across ${Object.keys(counts).length} files, all at baseline.`
  );
  process.exit(0);
}

if (over.length > 0) {
  console.error('An icon drawn at a size off the ladder. Read iconSize from @/theme, one of');
  console.error('xs 12, sm 16, md 20, lg 24, xl 32, xxl 48.\n');
  for (const [file, n, allowed] of over) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
}
if (under.length > 0) {
  console.error('\nThe tree has beaten its baseline. Lower it, so the ground stays taken:');
  for (const [file, n, allowed] of under) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
  console.error('\n  npm run lint:icon-sizes -- --write');
}
process.exit(1);
