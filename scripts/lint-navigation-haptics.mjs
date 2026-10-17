#!/usr/bin/env node
// A press that only navigates fires no haptic. `src/shared/app/navigation.ts`
// is the one place every push and every back goes through, so a haptic there
// comes back on every navigating press at once. The module neither imports a
// haptics module nor calls through one; a comment that names a haptic is not
// a call.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { treeView } from './lib/indexedSources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? resolve(here, '..') : resolve(process.argv[rootFlag + 1]);
const tree = treeView(root, ['src']);
const MODULE = 'src/shared/app/navigation.ts';
const failures = [];

function isHapticsModule(node) {
  return node && ts.isStringLiteralLike(node) && /(^|\/|-)haptics$/.test(node.text);
}

const source = tree.text(join(root, MODULE));
if (!source) {
  console.error(`lint-navigation-haptics: ${MODULE} not found`);
  process.exit(1);
}

const parsed = ts.createSourceFile(MODULE, source, ts.ScriptTarget.Latest, true);
const report = (node, what) => {
  const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
  failures.push(`${MODULE}:${line}: ${what}; a press that only navigates fires no haptic`);
};

// Every name a haptics module is bound to, so a renamed namespace is still read.
const bound = new Set(['haptics', 'Haptics']);
const visit = (node) => {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    isHapticsModule(node.moduleSpecifier)
  ) {
    report(node, 'imports a haptics module');
    const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : undefined;
    if (bindings && ts.isNamespaceImport(bindings)) bound.add(bindings.name.text);
  } else if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
    isHapticsModule(node.arguments[0])
  ) {
    report(node, 'loads a haptics module');
  }
  ts.forEachChild(node, visit);
};
visit(parsed);

const calls = (node) => {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    bound.has(node.expression.expression.text)
  )
    report(node, `calls ${node.expression.getText(parsed)}`);
  ts.forEachChild(node, calls);
};
calls(parsed);

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
