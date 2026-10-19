#!/usr/bin/env node
// Every Skia canvas draws through `src/shared/ui/SkiaCanvas.tsx`. On Android a
// canvas draws into a texture its own size in physical pixels, and a side past
// the GPU's texture limit aborts the render thread with "Invalid
// GrBackendTexture", which kills the app. A canvas sized from layout or data
// can reach that size, so the owner caps both sides under the limit. A bare
// `Canvas` from @shopify/react-native-skia has no cap. Tests may import it.

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { treeView } from './lib/indexedSources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? resolve(here, '..') : resolve(process.argv[rootFlag + 1]);
const tree = treeView(root, ['src']);
const OWNER = 'src/shared/ui/SkiaCanvas.tsx';
const SKIA = '@shopify/react-native-skia';
const failures = [];

function check(file, source) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== SKIA) continue;
    if (statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (imported !== 'Canvas' || element.isTypeOnly) continue;
      const line = parsed.getLineAndCharacterOfPosition(statement.getStart(parsed)).line + 1;
      failures.push(
        `${relative(root, file)}:${line}: draw through Canvas from ${OWNER}, which caps it under the GPU texture limit, not Canvas from ${SKIA}`
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
  console.error(`lint-canvas-owner: ${OWNER} not found`);
  process.exit(1);
}
for (const file of files) {
  if (relative(root, file) === OWNER) continue;
  const source = tree.text(file);
  if (!source || !source.includes(SKIA)) continue;
  check(file, source);
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
