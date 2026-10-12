#!/usr/bin/env node
// Every snackbar goes through `src/shared/ui/Notice.tsx`. A snackbar rendered
// on its own is not announced on iOS, which ignores the live region it
// carries, and its action times out before a screen reader can reach it. The
// owner announces every notice and holds one with an action open under a
// screen reader, so `Snackbar` is imported from react-native-paper nowhere
// else. Tests may import it.

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { treeView } from './lib/indexedSources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? resolve(here, '..') : resolve(process.argv[rootFlag + 1]);
const tree = treeView(root, ['src']);
const OWNER = 'src/shared/ui/Notice.tsx';
const failures = [];

function check(file, source) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const at = (node) =>
    `${relative(root, file)}:${parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1}`;
  for (const statement of parsed.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react-native-paper'
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      if (new RegExp(`\\b${bindings.name.text}\\.Snackbar\\b`).test(source)) {
        failures.push(`${at(statement)}: show a notice through ${OWNER}, not a Paper Snackbar`);
      }
      continue;
    }
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === 'Snackbar') {
        failures.push(`${at(element)}: show a notice through ${OWNER}, not a Paper Snackbar`);
      }
    }
  }
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
  console.error(`lint-notice-owner: ${OWNER} not found`);
  process.exit(1);
}
for (const file of files) {
  if (relative(root, file) === OWNER) continue;
  const source = tree.text(file);
  if (!source || !/Snackbar/.test(source)) continue;
  check(file, source);
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
