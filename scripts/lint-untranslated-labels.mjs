#!/usr/bin/env node
// A string literal a screen shows or a screen reader speaks, written into the JSX instead of
// drawn through `t()`, reads in English whatever the app language is.
//
// Refused under `src/features` and `src/app`: JSX text that holds a letter, a string or template
// literal placed as a JSX child (directly, or as a branch of `?:`, `&&`, `||`, `??` or `+`) whose
// fixed text holds one, and a plain string holding one as the value of an attribute a component
// shows or speaks: `accessibilityLabel`, `accessibilityHint`, `label`, `title`, `subtitle`,
// `placeholder`, `message` or `description`. A call is not counted, that is where `t()` runs. Units and abbreviations are not exempt:
// `units.*` and `metrics.*` hold them, and several read differently in other languages.
//
// Not counted: tests, the debug screens listed below by name, and `GlobalErrorBoundary.tsx`,
// whose English fallback has to render when the i18n instance itself has failed. Text with no
// letter in it (a bullet, a slash, an arrow) is not a sentence, and a proper name or symbol listed
// below is written the same in every language, so it is removed before the letter is looked for.

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);

const SCOPES = ['src/features', 'src/app'];
const EXEMPT = [/\/__tests__\//, /\/GlobalErrorBoundary\.tsx$/];
const ATTRIBUTES = new Set([
  'accessibilityLabel',
  'accessibilityHint',
  'label',
  'title',
  'subtitle',
  'placeholder',
  'message',
  'description',
]);

// Screens only the developer switch reaches, which stay in English in every locale.
const DEBUG_SCREENS = [
  'src/app/debug.tsx',
  'src/features/insights/components/InsightDebugPanel.tsx',
  'src/features/routes/components/DebugInfoPanel.tsx',
  'src/features/routes/components/SyncDebugSection.tsx',
];

// Names and symbols a translation keeps as written, each with the reason.
const KEPT_AS_WRITTEN = new Map([
  ['Veloq', 'the app name'],
  ['VELOQ', 'the app name set as a capitalised section label'],
  ['intervals.icu', 'the data service, which writes its name in lower case'],
  ['INTERVALS.ICU', 'the data service set as a capitalised section label'],
  ['Garmin', 'a device maker named in the data attribution'],
  ['Strava', 'a service named in the data attribution'],
  ['Polar', 'a device maker named in the data attribution'],
  ['Wahoo', 'a device maker named in the data attribution'],
  ["D'", 'the critical speed model parameter, written the same in the literature'],
  ['R²', 'the coefficient of determination, a mathematical symbol'],
  ['GPX', 'a file format name'],
  ['GeoJSON', 'a file format name'],
  ['Z', 'the training zone prefix of Z1 to Z7, which the data service writes in every language'],
]);

// Longest first, so a name that contains a shorter one is removed whole.
const NAMES = [...KEPT_AS_WRITTEN.keys()].sort((a, b) => b.length - a.length);

function readsAsWords(literal) {
  let rest = literal;
  for (const name of NAMES) rest = rest.split(name).join(' ');
  return /\p{L}/u.test(rest);
}

/** The fixed text a JSX child expression renders, through the operators that pass it along. */
function literalParts(expression) {
  if (!expression) return [];
  if (ts.isParenthesizedExpression(expression)) return literalParts(expression.expression);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return [expression.text];
  }
  if (ts.isTemplateExpression(expression)) {
    return [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)];
  }
  if (ts.isConditionalExpression(expression)) {
    return [...literalParts(expression.whenTrue), ...literalParts(expression.whenFalse)];
  }
  if (ts.isBinaryExpression(expression) && PASSING.has(expression.operatorToken.kind)) {
    return [...literalParts(expression.left), ...literalParts(expression.right)];
  }
  return [];
}

const PASSING = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.PlusToken,
]);

export function untranslatedIn(fileName, text) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const hits = [];
  const hit = (node, literal) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    hits.push({ line, literal });
  };
  const visit = (node) => {
    if (ts.isJsxText(node) && readsAsWords(node.text)) hit(node, node.text.trim());
    if (
      ts.isJsxExpression(node) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      for (const literal of literalParts(node.expression)) {
        if (readsAsWords(literal)) hit(node, literal);
      }
    }
    if (ts.isJsxAttribute(node) && ATTRIBUTES.has(node.name.getText(source)) && node.initializer) {
      const init = node.initializer;
      const value = ts.isJsxExpression(init) ? init.expression : init;
      if (
        value &&
        (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) &&
        readsAsWords(value.text)
      ) {
        hit(node, value.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

const tree = treeView(ROOT, SCOPES);
const debugScreens = new Set(DEBUG_SCREENS);
const failures = [];
const seenDebug = new Set();
for (const scope of SCOPES) {
  for (const file of tree.files(join(ROOT, scope), (rel) => /\.tsx$/.test(rel))) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (debugScreens.has(rel)) {
      seenDebug.add(rel);
      continue;
    }
    if (EXEMPT.some((pattern) => pattern.test(`/${rel}`))) continue;
    for (const { line, literal } of untranslatedIn(rel, tree.text(file))) {
      failures.push(`  ${rel}:${line}  ${JSON.stringify(literal)}`);
    }
  }
}
const staleDebug = DEBUG_SCREENS.filter((rel) => !seenDebug.has(rel));

if (failures.length === 0 && staleDebug.length === 0) {
  console.log('untranslated label guard: no English literal in JSX outside the debug screens.');
  process.exit(0);
}
if (failures.length > 0) {
  console.error('A string literal in JSX text or an accessibility label.');
  console.error('Draw it through t() and add the key to every locale.\n');
  for (const failure of failures) console.error(failure);
}
if (staleDebug.length > 0) {
  console.error(
    '\nA debug screen listed in scripts/lint-untranslated-labels.mjs that the tree lacks:'
  );
  for (const rel of staleDebug) console.error(`  ${rel}`);
}
process.exit(1);
