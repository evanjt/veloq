#!/usr/bin/env node
// `colors` holds the light theme and `darkColors` the dark one. A style or a
// prop that names `colors.actionPrimary` draws the light primary in both themes, and
// on the dark grounds the light primary sits under the 3:1 a mark owes. A
// `brand.<step>` read is the same hazard by a second route: a ramp step is one
// value in both themes, so it answers to no theme at all.
//
// The `dark-counterpart` rule in `lint-source-rules.mjs` sees only a style
// property in a file that reads `isDark`, so an icon's `color` prop, an SVG
// stroke or a file with no `isDark` passes it. This counts every read.
//
// Not counted: a read paired with its dark value in one conditional,
// `isDark ? darkColors.actionPrimary : colors.actionPrimary`; anything under `src/theme/`,
// which is the owner; and tests.
//
// Demanding zero would fail every commit, so this is a ratchet, the shape
// `lint-hand-rolled-buttons.mjs` uses. `scripts/light-only-role-baseline.json`
// holds the count each file still carries, per kind. A file above its baseline
// fails, a file the baseline never listed fails, and a file the tree has
// already beaten fails with the number to paste back.
//
// Usage: node scripts/lint-light-only-roles.mjs [--root <dir>] [--baseline <file>] [--write]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'light-only-role-baseline.json'));
const SRC = join(ROOT, 'src');
const WRITE = process.argv.includes('--write');

const EXEMPT = ['src/theme/', 'src/__tests__/', 'src/__mocks__/'];

/** What each kind counts, for the report. */
const KINDS = {
  primary: 'colors.actionPrimary read with no dark pair',
  brand: 'brand.<step> read outside src/theme',
};

/** The local names a file imports `colors` and `brand` under, from the theme. */
function themeImports(sf) {
  const names = { colors: null, darkColors: null, brand: null };
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const from = statement.moduleSpecifier.text;
    if (!/(^@\/theme$|\/theme(\/colors)?$)/.test(from)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (imported in names) names[imported] = element.name.text;
    }
  }
  return names;
}

const unwrap = (node) => {
  let at = node;
  while (at.parent && ts.isParenthesizedExpression(at.parent)) at = at.parent;
  return at;
};

/** Whether a light read sits in a conditional whose other branch is the dark one. */
function pairedWithDark(access, darkName) {
  const self = unwrap(access);
  const cond = self.parent;
  if (!darkName || !cond || !ts.isConditionalExpression(cond)) return false;
  const other = cond.whenTrue === self ? cond.whenFalse : cond.whenTrue;
  let inner = other;
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
  return (
    ts.isPropertyAccessExpression(inner) &&
    ts.isIdentifier(inner.expression) &&
    inner.expression.text === darkName &&
    inner.name.text === access.name.text
  );
}

function countReads(text) {
  const sf = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = themeImports(sf);
  const counts = { primary: 0, brand: 0 };
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const object = node.expression.text;
      if (
        object === names.colors &&
        node.name.text === 'actionPrimary' &&
        !pairedWithDark(node, names.darkColors)
      ) {
        counts.primary++;
      }
      if (object === names.brand) counts.brand++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return counts;
}

const tree = treeView(ROOT, [relative(ROOT, SRC)]);
const counts = { primary: {}, brand: {} };
for (const file of tree.files(
  SRC,
  (rel) => /\.tsx?$/.test(rel) && !rel.split('/').includes('node_modules')
)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
  const found = countReads(tree.text(file));
  for (const kind of Object.keys(KINDS)) {
    if (found[kind] > 0) counts[kind][rel] = found[kind];
  }
}

const total = (kind) => Object.values(counts[kind]).reduce((a, b) => a + b, 0);
const summary = () =>
  Object.keys(KINDS)
    .map((kind) => `${kind} ${total(kind)} across ${Object.keys(counts[kind]).length} files`)
    .join(', ');

if (WRITE) {
  const sorted = Object.fromEntries(
    Object.keys(KINDS).map((kind) => [
      kind,
      Object.fromEntries(Object.entries(counts[kind]).sort(([a], [b]) => a.localeCompare(b))),
    ])
  );
  writeFileSync(BASELINE_FILE, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`light-only role baseline written: ${summary()}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
const over = [];
const under = [];
for (const kind of Object.keys(KINDS)) {
  const allowedByFile = baseline[kind] ?? {};
  for (const [file, n] of Object.entries(counts[kind])) {
    const allowed = allowedByFile[file] ?? 0;
    if (n > allowed) over.push([kind, file, n, allowed]);
    else if (n < allowed) under.push([kind, file, n, allowed]);
  }
  for (const file of Object.keys(allowedByFile)) {
    if (!(file in counts[kind])) under.push([kind, file, 0, allowedByFile[file]]);
  }
}

if (over.length === 0 && under.length === 0) {
  console.log(`light-only role guard: ${summary()}, all at baseline.`);
  process.exit(0);
}

if (over.length > 0) {
  console.error('A light-only colour above the baseline. Read the role through the theme');
  console.error('palette, `themePalette(isDark).primary` or `useTheme().palette`, and a link');
  console.error('or a label through its text role.\n');
  for (const [kind, file, n, allowed] of over) {
    console.error(`  ${file}  ${n}, baseline ${allowed}  (${KINDS[kind]})`);
  }
}
if (under.length > 0) {
  console.error('\nThe tree has beaten its baseline. Lower it, so the ground stays taken:');
  for (const [kind, file, n, allowed] of under) {
    console.error(`  ${file}  ${n}, baseline ${allowed}  (${KINDS[kind]})`);
  }
  console.error('\n  npm run lint:light-only-roles -- --write');
}
process.exit(1);
