#!/usr/bin/env node
// A `Dimensions.get('window')` read at module scope holds whatever the window
// was when the bundle first evaluated. The Android manifest handles rotation,
// split-screen and an unfold in place rather than by restarting, so the
// process survives those and the constant does not. Eleven files did this and
// every one of them fixed a page width, a map height or a swipe threshold to
// the launch orientation.
//
// `useWindowDimensions` re-renders on a change and is the read to use inside a
// component. A read inside a function body is left alone: an event handler
// measuring on demand is correct, and the hook cannot be called there anyway.

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);
const SRC = join(ROOT, 'src');

const tree = treeView(ROOT, ['src']);

function walk(dir) {
  return tree.files(dir, (rel) => {
    const parts = rel.split('/');
    const name = parts[parts.length - 1];
    if (parts.slice(0, -1).some((part) => part === '__tests__' || part === '__mocks__')) return false;
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !/\.d\.ts$/.test(name);
  });
}

function isDimensionsGet(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'Dimensions' &&
    node.expression.name.text === 'get'
  );
}

// Anything with its own body defers the read until it runs, so a call inside
// one is at call time and not at load time.
function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function moduleScopeReads(file) {
  const src = tree.text(file);
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const hits = [];
  const visit = (node, inFunction) => {
    if (isDimensionsGet(node) && !inFunction) {
      hits.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    }
    ts.forEachChild(node, (child) => visit(child, inFunction || isFunctionLike(child)));
  };
  visit(sf, false);
  return hits;
}

const failures = [];
for (const file of walk(SRC)) {
  for (const line of moduleScopeReads(file)) {
    failures.push(`${relative(ROOT, file)}:${line}`);
  }
}

if (failures.length > 0) {
  console.error(
    `Window dimensions read at module scope: ${failures.length}. The value never updates after a rotation, a split-screen resize or an unfold.`
  );
  console.error('Read useWindowDimensions() inside the component instead.\n');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Window dimensions guard: no module-scope reads under src/.');
