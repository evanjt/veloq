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
// Rendered Touchable controls use the shared controls or pressable() instead.
//
// A press wrapper of its own skips that answer for every tag that renders it:
// one sprang a 1 to 3 % shrink with no ripple on Android and buzzed on
// touch-down, before a scroll could take the touch. So `AnimatedPressable` and
// `Animated.createAnimatedComponent(Pressable)` are refused outside the files
// that define the answer.

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
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !/\.d\.ts$/.test(name);
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

/** An icon glyph, `MaterialCommunityIcons` or `ChevronIcon`, named directly rather than as a member. */
function isIcon(node) {
  return ts.isIdentifier(node.tagName) && /Icons?$/.test(node.tagName.text);
}

function takesPress(node) {
  return node.attributes.properties.some(
    (prop) => ts.isJsxAttribute(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'onPress'
  );
}

/** `Animated.createAnimatedComponent(Pressable)`, or the bare imported name. */
function wrapsPressable(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : '';
  if (name !== 'createAnimatedComponent') return false;
  const [arg] = node.arguments;
  return arg !== undefined && ts.isIdentifier(arg) && arg.text === 'Pressable';
}

const failures = [];
const touchableFailures = [];
const wrapperFailures = [];
const iconFailures = [];
const touchableNames = new Set([
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'TouchableNativeFeedback',
]);
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).replace(/^src\//, '');
  if (DEFINES_IT.includes(rel)) continue;
  const source = tree.text(file);
  if (
    !source.includes('<Pressable') &&
    !source.includes('AnimatedPressable') &&
    !source.includes('createAnimatedComponent') &&
    !source.includes('onPress') &&
    ![...touchableNames].some((name) => source.includes(`<${name}`))
  )
    continue;
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const at = (node) =>
    `${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  const visit = (node) => {
    if (
      ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        tagName(node) === 'AnimatedPressable') ||
      wrapsPressable(node)
    ) {
      wrapperFailures.push(at(node));
    }
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
      touchableNames.has(tagName(node))
    ) {
      touchableFailures.push(
        `${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
      );
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      isIcon(node) &&
      takesPress(node) &&
      !declaredSilent(sf, node)
    ) {
      iconFailures.push(at(node));
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

if (touchableFailures.length > 0) {
  console.error(
    `Touchable tags rendered: ${touchableFailures.length}. Use Button, ToggleButton, IconButton or Pressable with pressable().`
  );
  for (const f of touchableFailures) console.error(`  ${f}`);
}

if (wrapperFailures.length > 0) {
  console.error(
    `Press wrappers that skip the platform answer: ${wrapperFailures.length}. Render a Pressable with pressable() and android_ripple={pressRipple} instead.`
  );
  for (const f of wrapperFailures) console.error(`  ${f}`);
}

if (iconFailures.length > 0) {
  console.error(
    `Icons that take a press themselves: ${iconFailures.length}. A glyph shows nothing when pressed; render IconButton from '@/shared/ui' instead.`
  );
  for (const f of iconFailures) console.error(`  ${f}`);
}

if (
  failures.length > 0 ||
  touchableFailures.length > 0 ||
  wrapperFailures.length > 0 ||
  iconFailures.length > 0
)
  process.exit(1);

console.log(
  'Press feedback guard: Pressable tags set feedback; no Touchable tags, press wrappers or pressed icons render.'
);
