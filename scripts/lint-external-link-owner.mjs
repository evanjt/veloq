#!/usr/bin/env node
// Every page or app outside Veloq opens through `src/shared/app/openExternal.ts`,
// which sends a web page to the in-app browser, hands a store, mail or settings
// scheme to the system and opens a fallback when the system refuses one. A call
// to `openURL` or `openBrowserAsync` anywhere else under `src/` brings back a
// web page in the system browser, with no way back to the app, or a store link
// that does nothing on a device without the store. Tests may call either to
// mock it, and a string that merely names one is not a call.

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { treeView } from './lib/indexedSources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? resolve(here, '..') : resolve(process.argv[rootFlag + 1]);
const tree = treeView(root, ['src']);
const OWNER = 'src/shared/app/openExternal.ts';
const OPENERS = new Set(['openURL', 'openBrowserAsync']);
const failures = [];

function calledName(callee) {
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression))
    return callee.argumentExpression.text;
  return null;
}

function check(file, source) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isCallExpression(node) && OPENERS.has(calledName(node.expression))) {
      const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
      failures.push(`${relative(root, file)}:${line}: open it with openExternal from ${OWNER}`);
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
if (!files.some((file) => relative(root, file) === OWNER)) {
  console.error(`lint-external-link-owner: ${OWNER} not found`);
  process.exit(1);
}
for (const file of files) {
  if (relative(root, file) === OWNER) continue;
  const source = tree.text(file);
  if (!source || !/openURL|openBrowserAsync/.test(source)) continue;
  check(file, source);
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
