#!/usr/bin/env node
// A value the data does not carry prints `ABSENT` from `src/shared/format/absent.ts`.
//
// The app printed two marks for a missing figure, a hyphen in some places and
// two in others, and TalkBack and VoiceOver announce a lone hyphen as "minus",
// so a missing heart rate read as a negative one. Each new site wrote its own
// literal. This refuses a bare '-' or '--' string literal where it becomes the
// value a screen shows: a JSX child or attribute, a returned value, an arrow's
// body, an object property or a variable, reached directly or through a
// conditional or a `??` / `||` fallback. A hyphen used as a separator, in a
// comparison, a call argument or a concatenation is left alone, and so is a
// template literal, where a hyphen is a sign.
//
// `src/shared/format/` owns the mark and is exempt, and so are tests.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { refuseEmptyListing, treeSources } from './lib/indexedSources.mjs';

// `--root` points the guard at another tree, so the rule itself can be tested.
const rootFlag = process.argv.indexOf('--root');
const ROOT =
  rootFlag === -1
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.argv[rootFlag + 1]);

const OWNER = 'src/shared/format/';
const MARKS = new Set(['-', '--']);

function isExempt(rel) {
  return rel.startsWith(OWNER) || /(^|\/)__tests__\//.test(rel) || /\.test\.tsx?$/.test(rel);
}

/** The node a literal's value lands in, past wrappers that pass it through unchanged. */
function landing(node) {
  let child = node;
  let parent = node.parent;
  for (;;) {
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent)
    ) {
      child = parent;
      parent = parent.parent;
      continue;
    }
    if (ts.isConditionalExpression(parent) && parent.condition !== child) {
      child = parent;
      parent = parent.parent;
      continue;
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.right === child &&
      (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      child = parent;
      parent = parent.parent;
      continue;
    }
    return { child, parent };
  }
}

function isDisplayed(child, parent) {
  if (ts.isJsxExpression(parent) || ts.isJsxAttribute(parent)) return true;
  if (ts.isReturnStatement(parent)) return true;
  if (ts.isArrowFunction(parent) && parent.body === child) return true;
  if (ts.isPropertyAssignment(parent) && parent.initializer === child) return true;
  if (ts.isVariableDeclaration(parent) && parent.initializer === child) return true;
  return false;
}

const offenders = [];

function check(rel, text) {
  const source = ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const lines = text.split('\n');
  const report = (node) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    offenders.push(`${rel}:${line + 1}: ${lines[line].trim()}`);
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) && MARKS.has(node.text)) {
      const { child, parent } = landing(node);
      if (isDisplayed(child, parent)) report(node);
    }
    // A JSX element whose only child is the mark written as text.
    if (ts.isJsxElement(node)) {
      const children = node.children.filter(
        (c) => !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces)
      );
      const only = children.length === 1 ? children[0] : null;
      if (only && ts.isJsxText(only) && MARKS.has(only.text.trim())) report(only);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const sources = treeSources(ROOT, ['src']);
refuseEmptyListing(sources, 'lint-absent-mark');
for (const [rel, bytes] of sources) {
  if (!/\.tsx?$/.test(rel) || isExempt(rel)) continue;
  check(rel, bytes.toString('utf8'));
}

if (offenders.length > 0) {
  console.error('A missing value prints `ABSENT` from src/shared/format/absent.ts, not its own');
  console.error('hyphen: a screen reader announces a lone hyphen as "minus".');
  console.error('');
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
