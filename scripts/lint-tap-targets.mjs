#!/usr/bin/env node
// A pressable with an explicitly undersized axis, or one sized by vertical
// padding no thicker than spacing.xs, needs hit slop or a minimum height to
// reach the platform tap-target floor. This checks styles passed to
// pressable(), and refuses a hit slop written as a number: a literal says
// nothing about the size it reaches, so it drifts under the floor as the
// control or the platform minimum changes. Slop comes from slopToMinTapTarget,
// which owns that sum. A Text that takes a press itself is drawn at its line
// height, so only the shared link component may write one. A control that
// takes a press never draws one platform's minimum as a literal size: 44 on
// Android is 4 short of its 48, so a target is drawn at a control height and
// lifted by slop, or sized from layout.minTapTarget.

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
      if (node.initializer && ts.isAsExpression(node.initializer))
        object = node.initializer.expression;
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
const platformMinimums = [
  numberIn(platformTargets, 'ios'),
  numberIn(platformTargets, 'android'),
].filter((value) => value !== undefined);
const floor = Math.max(0, ...platformMinimums);
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

const thinPadding = numberIn(objectFor(spacingSource, 'spacing'), 'xs');
if (thinPadding === undefined) throw new Error('Tap target guard could not read spacing.xs');

// The one file allowed a Text with onPress: the link component, whose inline
// form sits inside a sentence and so is exempt from the target size.
const LINK_COMPONENT = 'src/shared/ui/TextLink.tsx';

const SIZE_AXES = ['width', 'height', 'minWidth', 'minHeight'];
const PADDING_KEYS = ['padding', 'paddingVertical', 'paddingTop', 'paddingBottom'];

function properties(expr, styleObjects, constants) {
  if (ts.isArrayLiteralExpression(expr)) {
    return expr.elements.flatMap((part) => properties(part, styleObjects, constants));
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const owner = styleObjects.get(expr.expression.getText());
    const property = owner?.properties.find(
      (part) => ts.isPropertyAssignment(part) && part.name.getText() === expr.name.text
    );
    return property && ts.isPropertyAssignment(property)
      ? properties(property.initializer, styleObjects, constants)
      : [];
  }
  if (!ts.isObjectLiteralExpression(expr)) return [];
  return expr.properties.flatMap((part) => {
    if (!ts.isPropertyAssignment(part)) return [];
    const axis = part.name.getText();
    if (!SIZE_AXES.includes(axis) && !PADDING_KEYS.includes(axis)) return [];
    const value = numeric(part.initializer, constants);
    return value === undefined ? [] : [{ axis, value }];
  });
}

// The components that take a press, whose style is checked for a literal
// platform minimum even when it is not passed through pressable().
const PRESS_TAGS = ['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'IconButton'];

// Size axes written as one platform's minimum, a numeric literal or a local
// numeric constant, anywhere a style expression can reach: a style object or
// array, a conditional entry, or a pressed-state function.
function literalMinimums(expr, styleObjects, constants) {
  if (!expr) return [];
  const again = (part) => literalMinimums(part, styleObjects, constants);
  if (ts.isParenthesizedExpression(expr)) return again(expr.expression);
  if (ts.isArrayLiteralExpression(expr)) return expr.elements.flatMap(again);
  if (ts.isCallExpression(expr)) return expr.arguments.flatMap(again);
  if (ts.isConditionalExpression(expr)) return [...again(expr.whenTrue), ...again(expr.whenFalse)];
  if (ts.isBinaryExpression(expr)) return [...again(expr.left), ...again(expr.right)];
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    return ts.isBlock(expr.body) ? [] : again(expr.body);
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const owner = styleObjects.get(expr.expression.getText());
    const property = owner?.properties.find(
      (part) => ts.isPropertyAssignment(part) && part.name.getText() === expr.name.text
    );
    return property && ts.isPropertyAssignment(property) ? again(property.initializer) : [];
  }
  if (!ts.isObjectLiteralExpression(expr)) return [];
  return expr.properties.flatMap((part) => {
    if (!ts.isPropertyAssignment(part) || !SIZE_AXES.includes(part.name.getText())) return [];
    const value = part.initializer;
    const literal = ts.isNumericLiteral(value)
      ? Number(value.text)
      : ts.isIdentifier(value)
        ? constants.get(value.text)
        : undefined;
    return literal !== undefined && platformMinimums.includes(literal)
      ? [`${part.name.getText()} ${literal}`]
      : [];
  });
}

// The vertical padding the style resolves to, the later entry winning as it
// does in a style array, or undefined when the style declares none.
function verticalPadding(entries) {
  const last = new Map(entries.map(({ axis, value }) => [axis, value]));
  if (!PADDING_KEYS.some((key) => last.has(key))) return undefined;
  const base = last.get('paddingVertical') ?? last.get('padding') ?? 0;
  return Math.max(last.get('paddingTop') ?? base, last.get('paddingBottom') ?? base);
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

// A hit slop counts as literal when it is a number, a local numeric constant,
// or an object with any side given as one.
function literalSlop(expr, objects, constants) {
  if (ts.isParenthesizedExpression(expr)) return literalSlop(expr.expression, objects, constants);
  if (ts.isNumericLiteral(expr)) return true;
  if (ts.isIdentifier(expr)) {
    if (constants.has(expr.text)) return true;
    const object = objects.get(expr.text);
    return object ? literalSlop(object, objects, constants) : false;
  }
  if (!ts.isObjectLiteralExpression(expr)) return false;
  return expr.properties.some(
    (part) =>
      ts.isPropertyAssignment(part) &&
      (ts.isNumericLiteral(part.initializer) ||
        (ts.isIdentifier(part.initializer) && constants.has(part.initializer.text)))
  );
}

const failures = [];
const literalSlops = [];
const literalTargets = [];
const files = tree.files(
  join(root, 'src'),
  (path) => path.endsWith('.tsx') && !path.includes('/__tests__/')
);
if (!files.length) throw new Error('Tap target guard found no TSX files');
for (const file of files) {
  const source = tree.text(file);
  if (
    !source?.includes('pressable(') &&
    !source?.includes('hitSlop') &&
    !source?.includes('onPress')
  )
    continue;
  const linkComponent = relative(root, file) === LINK_COMPONENT;
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const { objects, constants } = styleObjectsIn(parsed);
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const props = node.attributes.properties;
      const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
      const pressed = props.some((part) => ts.isJsxAttribute(part) && part.name.text === 'onPress');
      if (pressed && node.tagName.getText(parsed) === 'Text' && !linkComponent) {
        failures.push(`${relative(root, file)}:${line}: text onPress`);
      }
      const slopProp = props.find(
        (part) => ts.isJsxAttribute(part) && part.name.text === 'hitSlop'
      );
      const slop = Boolean(slopProp);
      const slopValue =
        slopProp?.initializer && ts.isJsxExpression(slopProp.initializer)
          ? slopProp.initializer.expression
          : undefined;
      if (slopValue && literalSlop(slopValue, objects, constants)) {
        const slopLine = parsed.getLineAndCharacterOfPosition(slopProp.getStart(parsed)).line + 1;
        literalSlops.push(`${relative(root, file)}:${slopLine}: literal hitSlop`);
      }
      const style = props.find((part) => ts.isJsxAttribute(part) && part.name.text === 'style');
      const value = style?.initializer;
      const call = value && ts.isJsxExpression(value) ? value.expression : undefined;
      const takesPress = pressed || PRESS_TAGS.includes(node.tagName.getText(parsed));
      const pressStyle =
        call && ts.isCallExpression(call) && call.expression.getText(parsed) === 'pressable';
      if (call && (takesPress || pressStyle)) {
        const literals = literalMinimums(call, objects, constants);
        if (literals.length) {
          literalTargets.push(`${relative(root, file)}:${line}: ${literals.join(', ')}`);
        }
      }
      if (
        call &&
        ts.isCallExpression(call) &&
        call.expression.getText(parsed) === 'pressable' &&
        !slop
      ) {
        const entries = call.arguments.flatMap((arg) => properties(arg, objects, constants));
        const sizes = entries.filter(({ axis }) => SIZE_AXES.includes(axis));
        const small = sizes.filter(({ axis, value }) => {
          if (value >= floor) return false;
          const peer = axis.startsWith('min')
            ? `${axis[3].toLowerCase()}${axis.slice(4)}`
            : `min${axis[0].toUpperCase()}${axis.slice(1)}`;
          return !sizes.some((other) => other.axis === peer && other.value >= floor);
        });
        const tall = sizes.some(
          ({ axis, value }) => (axis === 'height' || axis === 'minHeight') && value >= floor
        );
        const padding = verticalPadding(entries);
        const reasons = small.map(({ axis }) => axis);
        if (!tall && padding !== undefined && padding <= thinPadding) reasons.push('padding');
        if (reasons.length) failures.push(`${relative(root, file)}:${line}: ${reasons.join(', ')}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
}

if (failures.length) {
  console.error(
    `Pressable axes below the ${floor} point tap-target floor without hitSlop, or a Text with onPress outside ${LINK_COMPONENT}:`
  );
  for (const failure of failures) console.error(`  ${failure}`);
}
if (literalSlops.length) {
  console.error('Hit slop written as a number; compute it with slopToMinTapTarget:');
  for (const failure of literalSlops) console.error(`  ${failure}`);
}
if (literalTargets.length) {
  console.error(
    'A control drawn at a literal platform minimum; draw it at a control height with slopToMinTapTarget, or size it from layout.minTapTarget:'
  );
  for (const failure of literalTargets) console.error(`  ${failure}`);
}
if (failures.length || literalSlops.length || literalTargets.length) process.exit(1);
console.log(
  'Tap target guard: explicit pressable dimensions and thin padding reach the platform floor, every hit slop is computed, and no control draws a literal platform minimum.'
);
