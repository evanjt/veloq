#!/usr/bin/env node
// Every file and message that leaves the app goes through
// `src/features/settings/lib/shareFile.ts`, which owns where it can go: on
// Android a save to the device through the create-document screen beside the
// share chooser, on iOS the share sheet, which carries its own save target. It
// also owns the file's readable name and type and the iPad anchor. An import of
// `expo-sharing`, or a call of React Native's `Share.share`, anywhere else
// under `src/` brings back a share that skips them. Tests may import the
// package to mock it, and a string that merely names it is not an import.

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { treeView } from './lib/indexedSources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? resolve(here, '..') : resolve(process.argv[rootFlag + 1]);
const tree = treeView(root, ['src']);
const OWNER = 'src/features/settings/lib/shareFile.ts';
const PACKAGE = 'expo-sharing';
const RN = 'react-native';
const failures = [];

function isPackage(node) {
  return node && ts.isStringLiteralLike(node) && node.text === PACKAGE;
}

/** The local names `Share` and the React Native namespace go by in `parsed`. */
function reactNativeNames(parsed) {
  const share = new Set();
  const namespaces = new Set();
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const spec = statement.moduleSpecifier;
    if (!ts.isStringLiteralLike(spec) || spec.text !== RN) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    else
      for (const element of bindings.elements)
        if ((element.propertyName ?? element.name).text === 'Share') share.add(element.name.text);
  }
  return { share, namespaces };
}

/** Whether `node` is `Share.share`, or `RN.Share.share` through a namespace import. */
function isTextShare(node, names) {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'share') return false;
  const target = node.expression;
  if (ts.isIdentifier(target)) return names.share.has(target.text);
  return (
    ts.isPropertyAccessExpression(target) &&
    target.name.text === 'Share' &&
    ts.isIdentifier(target.expression) &&
    names.namespaces.has(target.expression.text)
  );
}

function check(file, source) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names = reactNativeNames(parsed);
  const report = (node) => {
    const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
    failures.push(
      `${relative(root, file)}:${line}: share through src/features/settings/lib/shareFile.ts`
    );
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
    else if (ts.isCallExpression(node) && isTextShare(node.expression, names)) report(node);
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
  console.error(`lint-sharing-owner: ${OWNER} not found`);
  process.exit(1);
}
for (const file of files) {
  if (relative(root, file) === OWNER) continue;
  const source = tree.text(file);
  if (!source || !(source.includes(PACKAGE) || source.includes('Share'))) continue;
  check(file, source);
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
