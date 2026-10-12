#!/usr/bin/env node
// Every switch is drawn through `src/shared/ui/Switch.tsx`, or `SwitchRow`
// beside it, which take their colours from the theme and require a name. A
// `Switch` imported from `react-native` or `react-native-paper` anywhere else
// under `src/` brings back a switch that draws its own colours, so an off track
// falls under 3:1, or carries no name, so a screen reader reads "switch, off".
// Tests may import either to drive the control.

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { treeView } from './lib/indexedSources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? resolve(here, '..') : resolve(process.argv[rootFlag + 1]);
const tree = treeView(root, ['src']);
const OWNER = 'src/shared/ui/Switch.tsx';
const PACKAGES = new Set(['react-native', 'react-native-paper']);
const failures = [];

function importsSwitch(node) {
  const specifier = node.moduleSpecifier;
  if (!specifier || !ts.isStringLiteralLike(specifier) || !PACKAGES.has(specifier.text)) {
    return false;
  }
  const named = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
  if (!named || !('elements' in named)) return false;
  return named.elements.some((element) => (element.propertyName ?? element.name).text === 'Switch');
}

function check(file, source) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  for (const node of parsed.statements) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && importsSwitch(node)) {
      const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
      failures.push(
        `${relative(root, file)}:${line}: draw a switch with Switch or SwitchRow from src/shared/ui`
      );
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
  console.error(`lint-switch-owner: ${OWNER} not found`);
  process.exit(1);
}
for (const file of files) {
  if (relative(root, file) === OWNER) continue;
  const source = tree.text(file);
  if (!source || !source.includes('Switch')) continue;
  check(file, source);
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
