#!/usr/bin/env node
// A press has to look like something. `Button` carries the platform's answer,
// a ripple on Android and a fade on iOS, and everything else drew its own or
// drew nothing: 48 files rendered a `Pressable` with no `pressed` style and no
// `android_ripple`, so 100 taps across the app changed nothing on screen.
//
// `pressable()` from `src/shared/ui/pressFeedback.ts` is that answer for a
// `Pressable`. A tag is accepted when its `style` is a function of the press
// state, when it passes `android_ripple`, or when it is the helper. A tag
// inside `pressFeedback.ts` or `Button.tsx` is where the answer is written.
//
// A press that is not a control says so: a scrim that dismisses a sheet and a
// card that swallows the tap behind it are both `Pressable` and neither is a
// button. `// press-feedback: none, <why>` above the tag is that statement,
// and the reason is for the next reader rather than for this script.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);
const SRC = join(ROOT, 'src');

/** Where the feedback itself is defined, so they answer for themselves. */
const DEFINES_IT = ['shared/ui/pressFeedback.ts', 'shared/ui/Button.tsx'];

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__') continue;
      out.push(...walk(full));
      continue;
    }
    if (!/\.tsx$/.test(entry.name) || /\.(test|spec)\.tsx$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
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

function saysWhatAPressLooksLike(node) {
  for (const prop of node.attributes.properties) {
    if (!ts.isJsxAttribute(prop) || !ts.isIdentifier(prop.name)) continue;
    const name = prop.name.text;
    if (name === 'android_ripple') return true;
    if (name !== 'style') continue;
    const value = prop.initializer;
    if (!value || !ts.isJsxExpression(value) || !value.expression) continue;
    const expr = value.expression;
    // A function of the press state, whether written out or from the helper.
    if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return true;
    if (ts.isCallExpression(expr)) return true;
  }
  return false;
}

const failures = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).replace(/^src\//, '');
  if (DEFINES_IT.includes(rel)) continue;
  const source = readFileSync(file, 'utf8');
  if (!source.includes('<Pressable')) continue;
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
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (failures.length > 0) {
  console.error(
    `Presses that show nothing: ${failures.length}. A Pressable with no pressed style and no ripple answers a tap with no change on screen.`
  );
  console.error("Wrap the style in pressable() from '@/shared/ui'.\n");
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Press feedback guard: every Pressable under src/ says what a press looks like.');
