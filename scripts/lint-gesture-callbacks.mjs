#!/usr/bin/env node
// Every function a worklet hands to the JS thread through `runOnJS` or
// `scheduleOnRN` is a relay from `useGestureCallback`. The UI runtime keeps
// whatever a worklet captured for as long as it keeps the worklet, which
// outlives the screen, so a callback passed directly keeps the closed screen
// and everything it read. The relay lets go on unmount. The argument has to be
// a name bound in the same file to a `useGestureCallback(...)` call.

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { treeView } from './lib/indexedSources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? resolve(here, '..') : resolve(process.argv[rootFlag + 1]);
const tree = treeView(root, ['src']);
const BRIDGES = new Set(['runOnJS', 'scheduleOnRN']);
const OWNER = 'useGestureCallback';
const failures = [];

function isOwnerCall(node) {
  return (
    node &&
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === OWNER
  );
}

function check(file, source) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const relays = new Set();
  const bridged = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isOwnerCall(node.initializer)
    )
      relays.add(node.name.text);
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      BRIDGES.has(node.expression.text)
    )
      bridged.push(node);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  for (const call of bridged) {
    const arg = call.arguments[0];
    if (arg && ts.isIdentifier(arg) && relays.has(arg.text)) continue;
    const line = parsed.getLineAndCharacterOfPosition(call.getStart(parsed)).line + 1;
    failures.push(
      `${relative(root, file)}:${line}: pass ${call.expression.text} a relay from ${OWNER}, not the callback itself`
    );
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
for (const file of files) {
  const source = tree.text(file);
  if (!source || !/\b(runOnJS|scheduleOnRN)\(/.test(source)) continue;
  check(file, source);
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
