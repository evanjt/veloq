#!/usr/bin/env node
// A Jest worker reads its time zone once, when the process starts. Assigning
// `process.env.TZ` inside a suite changes neither `Date` nor `Intl`, so a test
// that does it runs in the machine's own zone and passes on a UTC runner
// whatever the code under test does. A suite that needs another zone installs
// a fixed offset with `atUtcOffset` or `installUtcOffset` from
// `src/__tests__/__shared__/fixedOffsetDate.ts`.

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);

const tree = treeView(ROOT, ['src']);

const files = tree.files(join(ROOT, 'src'), (rel) => {
  const parts = rel.split('/');
  return /\.[jt]sx?$/.test(rel) && parts.includes('__tests__') && !parts.includes('node_modules');
});

const isEnv = (node) =>
  ts.isPropertyAccessExpression(node) &&
  node.name.text === 'env' &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'process';

// `process.env.TZ` and `process.env['TZ']`.
function isTimezoneEnv(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text === 'TZ' && isEnv(node.expression);
  if (ts.isElementAccessExpression(node)) {
    return (
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'TZ' &&
      isEnv(node.expression)
    );
  }
  return false;
}

const failures = [];

for (const file of files) {
  const full = file;
  const kind = /x$/.test(file) ? ts.ScriptKind.TSX : /\.js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(full, tree.text(file), ts.ScriptTarget.Latest, true, kind);
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      isTimezoneEnv(node.left)
    ) {
      failures.push(`${relative(ROOT, full)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (failures.length > 0) {
  console.error(
    `Tests that assign process.env.TZ: ${failures.length}. The Jest worker has already read its zone, so the assignment changes nothing.`
  );
  console.error(
    'Use atUtcOffset or installUtcOffset from src/__tests__/__shared__/fixedOffsetDate.ts.\n'
  );
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Test timezone guard: no test assigns process.env.TZ.');
