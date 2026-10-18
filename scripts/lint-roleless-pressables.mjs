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
// Counted: an opening `<TouchableOpacity`, `<Pressable`, `<PressTarget` or `<AnimatedPressable`
// tag, read to its closing `>`, that holds neither `accessibilityRole` nor a `{...props}` spread.
// A spread forwards the role from the caller, which the caller is counted for. An icon that takes
// the press itself, a tag whose name ends in `Icon` or `Icons` and that carries `onPress`, is a
// press target too.
//
// Not counted: `src/shared/ui/` and tests.
//
// Also refused, with no baseline and `src/shared/ui/` included: a press target with a role and no
// name. Its opening tag holds no `accessibilityLabel`, `aria-label` or spread, and nothing between
// it and its closing tag, a nested press target's own children aside, is a `Text` of any kind. A
// screen reader announces it as "button" and nothing else, which is what an icon-only control
// with a role and no label does.

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

const OPENING = /<(?:TouchableOpacity|Pressable|PressTarget|AnimatedPressable)(?=[\s/>])/g;
const ICON_OPENING = /<([A-Z]\w*Icons?)(?=[\s/>])/g;
const PRESSED = /\bonPress\b/;

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

const SPREAD = /\{\s*\.\.\.\w+\s*\}/;
const NAMED = /\baccessibilityLabel\b|\baria-label\b/;
const TEXT_CHILD = /<[\w.]*Text(?=[\s/>])/;
const PRESS_TAG = /<\/?(?:TouchableOpacity|Pressable|PressTarget|AnimatedPressable)(?=[\s/>])/g;

/**
 * The children of the press target opening at `start`, with any nested press target's own
 * children cut out, or null when its closing tag cannot be found. A self-closing tag has none.
 */
function ownChildren(text, start, tag) {
  if (tag.trimEnd().endsWith('/')) return '';
  const from = start + tag.length + 1;
  let depth = 1;
  let own = '';
  let ownFrom = from;
  PRESS_TAG.lastIndex = from;
  for (let m = PRESS_TAG.exec(text); m !== null; m = PRESS_TAG.exec(text)) {
    if (m[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return own + text.slice(ownFrom, m.index);
      if (depth === 1) ownFrom = m.index;
      continue;
    }
    const inner = openingTag(text, m.index);
    if (inner === null) return null;
    PRESS_TAG.lastIndex = m.index + inner.length + 1;
    if (inner.trimEnd().endsWith('/')) continue;
    if (depth === 1) own += text.slice(ownFrom, m.index);
    depth += 1;
  }
  return null;
}

/** The children of an icon that takes a press, up to its own closing tag. */
function iconChildren(text, start, tag, name) {
  if (tag.trimEnd().endsWith('/')) return '';
  const from = start + tag.length + 1;
  const end = text.indexOf(`</${name}>`, from);
  return end === -1 ? null : text.slice(from, end);
}

/** Every press target's opening tag, with a reader for its own children. */
function* pressTargets(text) {
  for (const match of text.matchAll(OPENING)) {
    const tag = openingTag(text, match.index);
    if (tag === null) continue;
    yield { at: match.index, tag, children: () => ownChildren(text, match.index, tag) };
  }
  for (const match of text.matchAll(ICON_OPENING)) {
    const tag = openingTag(text, match.index);
    if (tag === null || !PRESSED.test(tag)) continue;
    yield { at: match.index, tag, children: () => iconChildren(text, match.index, tag, match[1]) };
  }
}

/** The lines of press targets that carry a role and give a screen reader nothing to name them by. */
function unnamedIn(text) {
  const lines = [];
  for (const { at, tag, children } of pressTargets(text)) {
    if (!tag.includes('accessibilityRole')) continue;
    if (NAMED.test(tag) || SPREAD.test(tag)) continue;
    const own = children();
    if (own === null || TEXT_CHILD.test(own)) continue;
    lines.push(text.slice(0, at).split('\n').length);
  }
  return lines;
}

function rolelessIn(text) {
  let n = 0;
  for (const { tag } of pressTargets(text)) {
    if (tag.includes('accessibilityRole') || SPREAD.test(tag)) continue;
    n += 1;
  }
  return n;
}

const tree = treeView(ROOT, [relative(ROOT, SRC)]);

const counts = {};
const unnamed = [];
for (const file of tree.files(
  SRC,
  (rel) => /\.tsx?$/.test(rel) && !rel.split('/').includes('node_modules')
)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (!rel.startsWith('src/__tests__/')) {
    for (const line of unnamedIn(tree.text(file))) unnamed.push(`${rel}:${line}`);
  }
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

if (unnamed.length > 0) {
  console.error('A press target with a role and no name is announced as "button" alone. Give it');
  console.error(
    'an accessibilityLabel, or use IconButton from src/shared/ui, which requires one.\n'
  );
  for (const site of unnamed) console.error(`  ${site}`);
  process.exit(1);
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
