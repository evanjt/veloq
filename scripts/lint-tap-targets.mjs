#!/usr/bin/env node
// A pressable with an explicitly undersized axis needs hit slop to reach the
// platform tap-target floor. This checks styles passed to pressable().

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { treeView } from './lib/indexedSources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? join(here, '..') : resolve(process.argv[rootFlag + 1]);
const tree = treeView(root, ['src']);
const spacingSource = tree.text(join(root, 'src/theme/spacing.ts'));
if (!spacingSource) throw new Error('Tap target guard could not read src/theme/spacing.ts');

function objectFor(source, name) {
  const file = ts.createSourceFile('spacing.ts', source, ts.ScriptTarget.Latest, true);
  let object;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) {
      if (node.initializer && ts.isAsExpression(node.initializer)) object = node.initializer.expression;
      else object = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return object && ts.isObjectLiteralExpression(object) ? object : undefined;
}

function numberIn(object, key) {
  if (!object) return undefined;
  const property = object.properties.find(
    (part) => ts.isPropertyAssignment(part) && part.name.getText() === key
  );
  if (!property || !ts.isPropertyAssignment(property)) return undefined;
  return ts.isNumericLiteral(property.initializer) ? Number(property.initializer.text) : undefined;
}

const platformTargets = objectFor(spacingSource, 'MIN_TAP_TARGET');
const floor = Math.max(numberIn(platformTargets, 'ios') ?? 0, numberIn(platformTargets, 'android') ?? 0);
if (!floor) throw new Error('Tap target guard could not read the platform minimum');

function numeric(node, constants) {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isIdentifier(node)) return constants.get(node.text);
  if (ts.isPropertyAccessExpression(node)) {
    const owner = node.expression.getText();
    if (owner === 'layout' && node.name.text === 'minTapTarget') return floor;
    if (owner === 'spacing' || owner === 'controlHeight') {
      return numberIn(objectFor(spacingSource, owner), node.name.text);
    }
  }
  if (ts.isBinaryExpression(node)) {
    const left = numeric(node.left, constants);
    const right = numeric(node.right, constants);
    if (left === undefined || right === undefined) return undefined;
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
    if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right;
  }
  return undefined;
}

function dimensions(expr, styleObjects, constants) {
  if (ts.isArrayLiteralExpression(expr)) {
    return expr.elements.flatMap((part) => dimensions(part, styleObjects, constants));
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const owner = styleObjects.get(expr.expression.getText());
    const property = owner?.properties.find(
      (part) => ts.isPropertyAssignment(part) && part.name.getText() === expr.name.text
    );
    return property && ts.isPropertyAssignment(property)
      ? dimensions(property.initializer, styleObjects, constants)
      : [];
  }
  if (!ts.isObjectLiteralExpression(expr)) return [];
  return expr.properties.flatMap((part) => {
    if (!ts.isPropertyAssignment(part)) return [];
    const axis = part.name.getText();
    if (!['width', 'height', 'minWidth', 'minHeight'].includes(axis)) return [];
    const value = numeric(part.initializer, constants);
    return value === undefined ? [] : [{ axis, value }];
  });
}

function styleObjectsIn(file) {
  const objects = new Map();
  const constants = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const value = node.initializer;
      if (value && ts.isNumericLiteral(value)) constants.set(node.name.text, Number(value.text));
      const object =
        value && ts.isCallExpression(value) && value.arguments.length === 1
          ? value.arguments[0]
          : value;
      if (object && ts.isObjectLiteralExpression(object)) objects.set(node.name.text, object);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { objects, constants };
}

const failures = [];
const files = tree.files(
  join(root, 'src'),
  (path) => path.endsWith('.tsx') && !path.includes('/__tests__/')
);
if (!files.length) throw new Error('Tap target guard found no TSX files');
for (const file of files) {
  const source = tree.text(file);
  if (!source?.includes('pressable(')) continue;
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const { objects, constants } = styleObjectsIn(parsed);
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const props = node.attributes.properties;
      const slop = props.some((part) => ts.isJsxAttribute(part) && part.name.text === 'hitSlop');
      const style = props.find((part) => ts.isJsxAttribute(part) && part.name.text === 'style');
      const value = style?.initializer;
      const call = value && ts.isJsxExpression(value) ? value.expression : undefined;
      if (call && ts.isCallExpression(call) && call.expression.getText(parsed) === 'pressable' && !slop) {
        const sizes = call.arguments.flatMap((arg) => dimensions(arg, objects, constants));
        const small = sizes.filter(({ axis, value }) => {
          if (value >= floor) return false;
          const peer = axis.startsWith('min')
            ? `${axis[3].toLowerCase()}${axis.slice(4)}`
            : `min${axis[0].toUpperCase()}${axis.slice(1)}`;
          return !sizes.some((other) => other.axis === peer && other.value >= floor);
        });
        if (small.length) {
          const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
          failures.push(`${relative(root, file)}:${line}: ${small.map(({ axis }) => axis).join(', ')}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
}

if (failures.length) {
  console.error(`Pressable axes below the ${floor} point tap-target floor without hitSlop:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log('Tap target guard: explicit pressable dimensions reach the platform floor.');
