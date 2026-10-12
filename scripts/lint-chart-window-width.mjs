#!/usr/bin/env node
// A chart, an insight sheet's content or a tour slide is drawn inside a box it
// is given: a sheet, a card, a column. On a tablet a form sheet is a centred
// panel far narrower than the window, so a width worked out from
// `useWindowDimensions` draws past the box's edge and cuts off whatever sits at
// the right. Such a component measures its box with `useMeasuredWidth` from
// `src/shared/charts`.
//
// The guard reads the files that hold those components, by name: under
// `src/features/**/components/`, a `*Chart*.tsx`, a `*Content.tsx` or a
// `*Slide.tsx`. It fails on a `useWindowDimensions()` whose `width` is read,
// destructured or through the returned object. A height is left alone. A file
// that is genuinely sized by the window is listed in ALLOWED with the reason.

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);
const FEATURES = join(ROOT, 'src', 'features');

const ALLOWED = new Map([
  [
    'src/features/settings/components/whatsNew/WhatsNewSlide.tsx',
    'a page of the tour pager, which steps by the window width less its padding',
  ],
]);

const BOXED_NAME = /(Chart[^/]*|Content|Slide)\.tsx$/;

const tree = treeView(ROOT, ['src/features']);

function boxedFiles() {
  return tree.files(FEATURES, (rel) => {
    const parts = rel.split('/');
    const dirs = parts.slice(0, -1);
    if (dirs.some((part) => part === '__tests__' || part === '__mocks__')) return false;
    if (!dirs.includes('components')) return false;
    const name = parts[parts.length - 1];
    return BOXED_NAME.test(name) && !/\.(test|spec)\.tsx$/.test(name);
  });
}

function isWindowDimensionsCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'useWindowDimensions';
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'useWindowDimensions';
}

function bindsWidth(pattern) {
  return pattern.elements.some((element) => {
    const key = element.propertyName ?? element.name;
    return ts.isIdentifier(key) && key.text === 'width';
  });
}

function widthReadsOf(sf, name) {
  let found = false;
  const visit = (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name &&
      node.name.text === 'width'
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function windowWidthReads(file) {
  const sf = ts.createSourceFile(
    file,
    tree.text(file),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const hits = [];
  const visit = (node) => {
    if (isWindowDimensionsCall(node)) {
      const parent = node.parent;
      let readsWidth = false;
      if (ts.isPropertyAccessExpression(parent) && parent.name.text === 'width') {
        readsWidth = true;
      } else if (ts.isVariableDeclaration(parent)) {
        if (ts.isObjectBindingPattern(parent.name)) readsWidth = bindsWidth(parent.name);
        else if (ts.isIdentifier(parent.name)) readsWidth = widthReadsOf(sf, parent.name.text);
      }
      if (readsWidth) hits.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

const failures = [];
for (const file of boxedFiles()) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (ALLOWED.has(rel)) continue;
  for (const line of windowWidthReads(file)) failures.push(`${rel}:${line}`);
}

if (failures.length > 0) {
  console.error(
    `Charts sized from the window: ${failures.length}. A sheet, card or column narrower than the window cuts off what is drawn past its edge.`
  );
  console.error('Measure the box with useMeasuredWidth() from src/shared/charts instead.\n');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Chart window width guard: every chart under src/features sizes from its box.');
