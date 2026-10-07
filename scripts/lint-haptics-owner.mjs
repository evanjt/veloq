#!/usr/bin/env node
// Every haptic goes through `src/shared/ui/haptics.ts`, which owns the four
// interaction classes, fires on both platforms and swallows a rejected call.
// An import of `expo-haptics` anywhere else under `src/` brings back a call
// with its own platform gate, its own style and an unhandled rejection.
// Tests may import the package to mock it, and a string that merely names it
// is not an import.

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { treeView } from './lib/indexedSources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? resolve(here, '..') : resolve(process.argv[rootFlag + 1]);
const tree = treeView(root, ['src']);
const OWNER = 'src/shared/ui/haptics.ts';
const PACKAGE = 'expo-haptics';
const failures = [];

function isPackage(node) {
  return node && ts.isStringLiteralLike(node) && node.text === PACKAGE;
}

function check(file, source) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const report = (node) => {
    const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
    failures.push(`${relative(root, file)}:${line}: import haptics from src/shared/ui/haptics.ts`);
  };
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      isPackage(node.moduleSpecifier)
    )
      report(node);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      isPackage(node.arguments[0])
    )
      report(node);
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
if (!files.some((file) => relative(root, file) === OWNER)) {
  console.error(`lint-haptics-owner: ${OWNER} not found`);
  process.exit(1);
}
for (const file of files) {
  if (relative(root, file) === OWNER) continue;
  const source = tree.text(file);
  if (!source || !source.includes(PACKAGE)) continue;
  check(file, source);
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
