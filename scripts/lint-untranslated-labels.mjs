#!/usr/bin/env node
// A string literal a screen shows or a screen reader speaks, written into the JSX instead of
// drawn through `t()`, reads in English whatever the app language is.
//
// Counted under `src/features` and `src/app`: JSX text that holds a letter, and an
// `accessibilityLabel` or `accessibilityHint` whose value is a plain string. A value built from a
// template or a call is not counted, those are where `t()` runs.
//
// Not counted: tests, the debug screens, and `GlobalErrorBoundary.tsx`, whose English fallback
// has to render when the i18n instance itself has failed. Text with no letter in it (a bullet, a
// slash, a unit symbol) is not a sentence. `HRV` and `RHR` are not exempt: `metrics.hrv` and
// `metrics.rhr` exist and are translated.
//
// `scripts/untranslated-labels-baseline.json` holds the count each file still carries, so the
// number only falls. A file above its baseline or unlisted fails, and a file the tree has beaten
// fails with the flag to paste back.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'untranslated-labels-baseline.json'));
const WRITE = process.argv.includes('--write');

const SCOPES = ['src/features', 'src/app'];
const EXEMPT = [/\/__tests__\//, /\/debug/i, /GlobalErrorBoundary\.tsx$/];
const ATTRIBUTES = new Set(['accessibilityLabel', 'accessibilityHint']);

export function untranslatedIn(fileName, text) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let n = 0;
  const visit = (node) => {
    if (ts.isJsxText(node) && /\p{L}/u.test(node.text)) n += 1;
    if (ts.isJsxAttribute(node) && ATTRIBUTES.has(node.name.getText(source)) && node.initializer) {
      const init = node.initializer;
      const value = ts.isJsxExpression(init) ? init.expression : init;
      if (value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) {
        n += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return n;
}

const tree = treeView(ROOT, SCOPES);
const counts = {};
for (const scope of SCOPES) {
  for (const file of tree.files(join(ROOT, scope), (rel) => /\.tsx$/.test(rel))) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (EXEMPT.some((pattern) => pattern.test(`/${rel}`))) continue;
    const hits = untranslatedIn(rel, tree.text(file));
    if (hits > 0) counts[rel] = hits;
  }
}

const total = () => Object.values(counts).reduce((a, b) => a + b, 0);

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(counts, null, 2) + '\n');
  console.log(
    `untranslated label baseline written: ${total()} across ${Object.keys(counts).length} files`
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
    `untranslated label guard: ${total()} across ${Object.keys(counts).length} files, all at baseline.`
  );
  process.exit(0);
}

if (over.length > 0) {
  console.error('A string literal in JSX text or an accessibility label, above the baseline.');
  console.error('Draw it through t() and add the key to every locale.\n');
  for (const [file, n, allowed] of over) console.error(`  ${file}  ${n}, baseline ${allowed}`);
}
if (under.length > 0) {
  console.error('\nThe tree has beaten its baseline. Lower it, so the ground stays taken:');
  for (const [file, n, allowed] of under) console.error(`  ${file}  ${n}, baseline ${allowed}`);
  console.error('\n  npm run lint:untranslated-labels -- --write');
}
process.exit(1);
