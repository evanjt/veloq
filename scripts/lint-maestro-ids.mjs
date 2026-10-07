#!/usr/bin/env node
// Every `id:` a Maestro flow asserts has to resolve to a `testID` the tree
// renders. A flow that names an id nothing renders fails at that step and every
// step after it never runs, so one stale assertion silently retires the rest of
// the flow. Nothing else notices: `.maestro` is not typechecked, the flows run
// on a device no CI runs, and a green `npm test` says nothing about them. It has
// happened: a rename moved a `testID` across fourteen files, touched no flow,
// and the flow failed before the two things it existed to check for eight days.
//
// Resolving is not a substring search. A templated id, `strength-period-${p.id}`
// over four periods, produces four ids and none of them appears in `src` as a
// literal, so a plain check flags the correct id as loudly as the wrong one.
// Each template becomes a pattern instead: the literal parts have to match and
// `${...}` stands for a non-empty run that carries no hyphen boundary of its
// own choosing. An id resolves if it equals a literal `testID` or matches a
// pattern.
//
// What cannot be read stays in `scripts/maestro-id-baseline.json`, the ratchet
// shape `lint-rgba-literals.mjs` and `lint-feature-imports.mjs` use: an
// unresolved id the baseline never listed fails, and an id the tree has already
// beaten fails with the line to delete, so ground a sweep takes is not given
// back.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};
const ROOT = flagValue('--root', resolve(HERE, '..'));
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'maestro-id-baseline.json'));
const SRC = join(ROOT, 'src');
const FLOWS = join(ROOT, '.maestro');

const tree = treeView(ROOT, [relative(ROOT, SRC), relative(ROOT, FLOWS)]);

function walk(dir, test) {
  return tree.files(dir, (rel) => test(rel.slice(rel.lastIndexOf('/') + 1)));
}

/** Every `testID` the tree renders, as literals and as patterns. */
export function collectTestIds(files) {
  const literals = new Set();
  const patterns = [];
  const unreadable = [];

  for (const file of files) {
    const source = tree.text(file);

    // `testID="a-literal"`, and the props that carry one down to it:
    // `containerTestID`, `rowTestID` and the rest all end in the same word.
    for (const m of source.matchAll(/\b\w*[Tt]estID="([^"]+)"/g)) literals.add(m[1]);

    // A bare `testID: 'a-literal'` in a props object or a constants table.
    for (const m of source.matchAll(/\b\w*[Tt]estID:\s*(?:'([^']+)'|"([^"]+)")/g)) {
      literals.add(m[1] ?? m[2]);
    }

    // `testID={...}` holds an expression, not just a literal: a ternary picking
    // between two ids, a concatenation, a template. Take every string it
    // mentions rather than trying to evaluate it, because every id the
    // expression can produce is one of them.
    for (const expression of bracedTestIdProps(source)) {
      for (const m of expression.matchAll(/'([^']+)'|"([^"]+)"/g)) literals.add(m[1] ?? m[2]);
      for (const m of expression.matchAll(/`([^`]+)`/g)) {
        const pattern = templateToPattern(m[1]);
        if (pattern) patterns.push({ pattern, source: m[1], file });
        else unreadable.push({ source: m[1], file });
      }
    }
  }

  return { literals, patterns, unreadable };
}

/** Every `…testID={…}` expression in a file, brace-balanced. */
export function bracedTestIdProps(source) {
  const found = [];
  for (const m of source.matchAll(/\b(\w*[Tt]estID)=\{/g)) {
    found.push(...braced(source.slice(m.index), `${m[1]}={`).slice(0, 1));
  }
  return found;
}

/** Each `{...}` expression opened by `open`, brace-balanced. */
export function braced(source, open) {
  const found = [];
  let at = source.indexOf(open);
  while (at !== -1) {
    let depth = 0;
    let i = at + open.length - 1;
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    found.push(source.slice(at + open.length, i));
    at = source.indexOf(open, i === source.length ? at + open.length : i);
  }
  return found;
}

/** A template has to be anchored by this much literal text to discriminate. */
const MIN_ANCHOR = 4;

/**
 * A template literal as a regex over the ids it can produce, or `null` when it
 * cannot discriminate.
 *
 * `${...}` becomes `[^\s]+`, a non-empty run: an interpolated id, index or
 * label never contains whitespace, and nothing weaker would distinguish
 * `activity-card-x-distance` from `activity-card-x-duration`.
 *
 * A template that opens with an interpolation is refused. `${testID}-${id}`
 * is a component composing an id its parent passed in, so it has no prefix of
 * its own and its pattern would match nearly every id in the tree, resolving
 * the wrong ones as readily as the right ones. A pattern that resolves
 * everything resolves nothing, and the honest answer is that this template
 * cannot be checked from here: the ids it produces are the parent's, and the
 * parent's own literal is what the guard sees.
 */
export function templateToPattern(template) {
  if (template.startsWith('${')) return null;

  const literalParts = template.split(/\$\{[^}]*\}/);
  const anchor = literalParts.join('').length;
  if (anchor < MIN_ANCHOR) return null;

  const escaped = literalParts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('[^\\s]+')}$`);
}

/** Every `id:` the flows assert, with the flows that assert it. */
export function collectFlowIds(files) {
  const byId = new Map();
  for (const file of files) {
    for (const m of tree.text(file).matchAll(/^\s*id:\s*"([^"]+)"/gm)) {
      if (!byId.has(m[1])) byId.set(m[1], new Set());
      byId.get(m[1]).add(file);
    }
  }
  return byId;
}

export function resolvesInTree(id, { literals, patterns }) {
  return literals.has(id) || patterns.some((p) => p.pattern.test(id));
}

function main() {
  const rendered = collectTestIds(walk(SRC, (n) => /\.tsx?$/.test(n) && !n.endsWith('.d.ts')));
  const asserted = collectFlowIds(walk(FLOWS, (n) => /\.ya?ml$/.test(n)));

  const unresolved = [...asserted.keys()].filter((id) => !resolvesInTree(id, rendered)).sort();

  const baseline = existsSync(BASELINE_FILE)
    ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
    : { unresolved: [] };
  const allowed = new Set(baseline.unresolved ?? []);

  if (process.argv.includes('--write-baseline')) {
    writeFileSync(BASELINE_FILE, `${JSON.stringify({ unresolved }, null, 2)}\n`);
    console.log(`maestro id guard: baseline written, ${unresolved.length} unresolved`);
    return;
  }

  const added = unresolved.filter((id) => !allowed.has(id));
  const beaten = [...allowed].filter((id) => !unresolved.includes(id)).sort();

  if (added.length > 0) {
    console.error('A Maestro flow asserts an id the tree does not render:');
    for (const id of added) {
      const flows = [...asserted.get(id)].map((f) => relative(ROOT, f)).sort();
      console.error(`  ${id}\n    asserted by ${flows.join(', ')}`);
    }
    console.error('\nRename the flow to the id the component renders, or render the id.');
    console.error('A flow fails at the step that names it and runs nothing after.');
    process.exit(1);
  }

  if (beaten.length > 0) {
    console.error('Ids the baseline still lists that the tree now renders. Delete them:');
    for (const id of beaten) console.error(`  ${id}`);
    console.error(`\nFrom ${relative(ROOT, BASELINE_FILE)}, or the ground is given back.`);
    process.exit(1);
  }

  console.log(
    `maestro id guard: ${asserted.size} ids asserted, ${unresolved.length} unresolved at baseline.`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
