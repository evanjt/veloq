#!/usr/bin/env node
// A press has to look like something. `Button` carries the platform's answer,
// a ripple on Android and a fade on iOS, and everything else drew its own or
// drew nothing: 48 files rendered a `Pressable` with no `pressed` style and no
// `android_ripple`, so 100 taps across the app changed nothing on screen.
//
// `pressable()` from `src/shared/ui/pressFeedback.ts` is that answer for a
// `Pressable`. A tag is accepted when it passes `android_ripple` or when its
// style calls the helper. A hand-written function of the press state is not
// accepted, because it gives the press its own look. The helper styles iOS
// only, so a tag that uses it also passes `android_ripple` with `pressRipple`,
// or Android shows nothing. A tag inside `pressFeedback.ts` or
// `Button.tsx` is where the answer is written.
//
// A press that is not a control says so: a scrim that dismisses a sheet and a
// card that swallows the tap behind it are both `Pressable` and neither is a
// button. `// press-feedback: none, <why>` above the tag is that statement,
// and the reason is for the next reader rather than for this script.
// A TouchableOpacity tag sets activeOpacity or spreads props until its migration.

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);
const SRC = join(ROOT, 'src');

/** Where the feedback itself is defined, so they answer for themselves. */
const DEFINES_IT = ['shared/ui/pressFeedback.ts', 'shared/ui/Button.tsx'];

const tree = treeView(ROOT, [relative(ROOT, SRC)]);

function walk(dir) {
  return tree.files(dir, (rel) => {
    const parts = rel.split('/');
    const name = parts[parts.length - 1];
    if (parts.slice(0, -1).some((part) => part === '__tests__' || part === '__mocks__'))
      return false;
    return /\.tsx$/.test(name) && !/\.(test|spec)\.tsx$/.test(name);
  });
}

/** The opening tag's name, `Pressable` or `Animated.Pressable`. */
function tagName(node) {
  const tag = node.tagName;
  if (ts.isIdentifier(tag)) return tag.text;
  if (ts.isPropertyAccessExpression(tag)) return tag.name.text;
  return '';
}

/** `press-feedback: none, ...` in a comment on the line above the tag. */
function declaredSilent(sf, node) {
  const text = sf.getFullText();
  const start = node.getStart(sf);
  const lineStart = text.lastIndexOf('\n', start - 1);
  const previous = text.lastIndexOf('\n', lineStart - 1);
  return /press-feedback:\s*none/.test(text.slice(previous + 1, lineStart + 1));
}

/** Whether an expression calls `pressable(...)` anywhere inside it. */
function callsHelper(expr) {
  let found = false;
  const look = (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'pressable'
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(n, look);
  };
  look(expr);
  return found;
}

function saysWhatAPressLooksLike(node) {
  const hasRipple = node.attributes.properties.some(
    (prop) =>
      ts.isJsxAttribute(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'android_ripple'
  );
  for (const prop of node.attributes.properties) {
    if (!ts.isJsxAttribute(prop) || !ts.isIdentifier(prop.name)) continue;
    const name = prop.name.text;
    if (name === 'android_ripple') return true;
    if (name !== 'style') continue;
    const value = prop.initializer;
    if (!value || !ts.isJsxExpression(value) || !value.expression) continue;
    const expr = value.expression;
    if (callsHelper(expr)) return hasRipple;
  }
  return false;
}

function setsTouchableOpacity(node) {
  return node.attributes.properties.some(
    (prop) =>
      ts.isJsxSpreadAttribute(prop) ||
      (ts.isJsxAttribute(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === 'activeOpacity')
  );
}

const failures = [];
const opacityFailures = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).replace(/^src\//, '');
  if (DEFINES_IT.includes(rel)) continue;
  const source = tree.text(file);
  if (!source.includes('<Pressable') && !source.includes('<TouchableOpacity')) continue;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      tagName(node) === 'Pressable' &&
      !saysWhatAPressLooksLike(node) &&
      !declaredSilent(sf, node)
    ) {
      failures.push(
        `${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
      );
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      tagName(node) === 'TouchableOpacity' &&
      !setsTouchableOpacity(node)
    ) {
      opacityFailures.push(
        `${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (failures.length > 0) {
  console.error(
    `Presses that show nothing: ${failures.length}. A Pressable with no pressed style and no ripple answers a tap with no change on screen.`
  );
  console.error(
    "Wrap the style in pressable() and add android_ripple={pressRipple}, both from '@/shared/ui'.\n"
  );
  for (const f of failures) console.error(`  ${f}`);
}

if (opacityFailures.length > 0) {
  console.error(`TouchableOpacity tags with no activeOpacity: ${opacityFailures.length}.`);
  for (const f of opacityFailures) console.error(`  ${f}`);
}

if (failures.length > 0 || opacityFailures.length > 0) process.exit(1);

console.log('Press feedback guard: Pressable and TouchableOpacity tags set feedback.');
