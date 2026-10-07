#!/usr/bin/env node

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { treeView } from './lib/indexedSources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? resolve(here, '..') : resolve(process.argv[rootFlag + 1]);
const tree = treeView(root, ['src']);
const methods = new Set(['minDuration', 'activateAfterLongPress']);
const failures = [];

function numericLiteral(node) {
  if (ts.isParenthesizedExpression(node)) return numericLiteral(node.expression);
  if (ts.isPrefixUnaryExpression(node)) return numericLiteral(node.operand);
  return ts.isNumericLiteral(node);
}

function check(file, source) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const report = (node) => {
    const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
    failures.push(`${relative(root, file)}:${line}: use a named hold duration`);
  };
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.text === 'delayLongPress') {
      const value = node.initializer;
      if (value && ts.isStringLiteral(value) && /^\d+$/.test(value.text)) report(node);
      if (
        value &&
        ts.isJsxExpression(value) &&
        value.expression &&
        numericLiteral(value.expression)
      )
        report(node);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      methods.has(node.expression.name.text) &&
      node.arguments[0] &&
      numericLiteral(node.arguments[0])
    ) {
      report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
}

const files = tree.files(
  join(root, 'src'),
  (file) =>
    /\.tsx?$/.test(file) &&
    !/\.(d|test|spec)\.tsx?$/.test(file) &&
    !file.includes('/__tests__/') &&
    !file.includes('/__mocks__/')
);
if (files.length === 0) {
  console.error('lint-hold-durations: no source files found');
  process.exit(1);
}
for (const file of files) {
  const source = tree.text(file);
  if (!source || !/(delayLongPress|minDuration|activateAfterLongPress)/.test(source)) continue;
  check(file, source);
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
