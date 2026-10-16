#!/usr/bin/env node
// Every modal opens through `src/shared/ui/FullWindowModal.tsx`. The stack
// beneath a banner in the top slot sees no top inset, since the banner has
// already cleared the status bar, and a modal covers the banner and the status
// bar both. A bare `Modal` from react-native inherits the stack's inset, so its
// close control and its first row draw under the status bar whenever a banner
// shows. The owner gives its subtree the device's insets. Tests may import it.

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { treeView } from './lib/indexedSources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? resolve(here, '..') : resolve(process.argv[rootFlag + 1]);
const tree = treeView(root, ['src']);
const OWNER = 'src/shared/ui/FullWindowModal.tsx';
const failures = [];

function check(file, source) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== 'react-native') continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (imported !== 'Modal' || element.isTypeOnly) continue;
      const line = parsed.getLineAndCharacterOfPosition(statement.getStart(parsed)).line + 1;
      failures.push(
        `${relative(root, file)}:${line}: open modals through FullWindowModal (${OWNER}), not Modal from react-native`
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
  console.error(`lint-modal-owner: ${OWNER} not found`);
  process.exit(1);
}
for (const file of files) {
  if (relative(root, file) === OWNER) continue;
  const source = tree.text(file);
  if (!source || !source.includes('Modal')) continue;
  check(file, source);
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
