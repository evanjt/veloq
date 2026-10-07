#!/usr/bin/env node
// An engine read hands a thrown `VeloqError` back, never an empty value.
//
// A `catch` that answers `[]`, `{}`, `''`, `0`, `null` or `undefined` makes a
// failed read indistinguishable from a read that found nothing. The caller
// then shows a 0 B cache, an empty list or "nothing to fetch", and the failure
// is recorded nowhere. `src/shared/native/engineError.ts` gives every caller
// the tag to branch on instead, so the client lets the error through.
//
// A write that answers `false` is left alone, since `false` already reads as
// failure, and so is a bare `return;` from a write with nothing to give back.
// A site whose empty answer is the honest one, an optional capability or a
// best-effort probe whose caller has no failure to show, says why on a
// `// empty-on-error: <reason>` comment inside the `catch` or on the line above
// it, and the reason cannot be blank.
//
// The rule holds in the client, its delegates and every feature hook, since a
// hook that catches the throw and answers empty hides the failure from the
// screen the same way.
//
// The rule covers both shapes: `try { ... } catch { return []; }` and a
// promise's `.catch(() => [])`.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { treeSources } from './lib/indexedSources.mjs';

// `--root` points the guard at another tree, so the rule itself can be tested.
const rootFlag = process.argv.indexOf('--root');
const ROOT =
  rootFlag === -1
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.argv[rootFlag + 1]);

const CLIENT = 'modules/veloqrs/src/EngineClient.ts';
const DELEGATES = 'modules/veloqrs/src/delegates';

const HOOKS = 'src';
// Hooks that answered empty before the rule reached them, by file and count. A
// file above its count fails, and a file below it fails too, so the count only
// ever moves down. The client and delegates carry no allowance.
const baselineFlag = process.argv.indexOf('--baseline');
const BASELINE_FILE =
  baselineFlag === -1
    ? join(dirname(fileURLToPath(import.meta.url)), 'engine-read-empty-baseline.json')
    : resolve(process.argv[baselineFlag + 1]);
const HOOK_FILE = /^src\/(?:.*\/)?hooks\/[^/]+\.tsx?$/;
// A lib file is held to the rule when it reaches the engine itself.
const LIB_FILE = /^src\/(?:.*\/)?lib\/[^/]+\.tsx?$/;
const ENGINE_IMPORT = /from\s+'@\/shared\/native\/engine'/;

const MARKER = /\/\/\s*empty-on-error:\s*(\S.*)?$/;

/** The empty answer `node` spells, or null when it is anything else. */
function emptyValue(node) {
  if (!node) return null;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  if (ts.isArrayLiteralExpression(node) && node.elements.length === 0) return '[]';
  if (ts.isObjectLiteralExpression(node) && node.properties.length === 0) return '{}';
  if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === '') {
    return "''";
  }
  if (ts.isNumericLiteral(node) && Number(node.text) === 0) return '0';
  if (node.kind === ts.SyntaxKind.NullKeyword) return 'null';
  if (ts.isIdentifier(node) && node.text === 'undefined') return 'undefined';
  if (ts.isVoidExpression(node)) return 'undefined';
  return null;
}

/** Every `return` in `body` that belongs to it rather than to a nested function. */
function ownReturns(body) {
  const out = [];
  const visit = (node) => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isReturnStatement(node)) out.push(node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return out;
}

const offenders = [];
const markersWithoutReason = [];

function check(rel, text) {
  const source = ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const lines = text.split('\n');
  const lineOf = (pos) => source.getLineAndCharacterOfPosition(pos).line;

  // A marker on the line above `startLine`, or on any line from there to `endLine`.
  const marked = (startLine, endLine) => {
    for (let i = Math.max(0, startLine - 1); i <= endLine; i++) {
      const m = MARKER.exec(lines[i] ?? '');
      if (!m) continue;
      if (!m[1]) {
        markersWithoutReason.push(`${rel}:${i + 1}`);
        return false;
      }
      return true;
    }
    return false;
  };

  const report = (node, value, scopeStart, scopeEnd) => {
    if (marked(lineOf(scopeStart), lineOf(scopeEnd))) return;
    const line = lineOf(node.getStart(source));
    offenders.push({ at: `${rel}:${line + 1}`, value, text: lines[line].trim() });
  };

  const visit = (node) => {
    if (ts.isCatchClause(node)) {
      for (const ret of ownReturns(node.block)) {
        const value = emptyValue(ret.expression);
        if (value) report(ret, value, node.getStart(source), node.getEnd());
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'catch' &&
      node.arguments.length > 0
    ) {
      const handler = node.arguments[0];
      if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
        const start = node.expression.name.getStart(source);
        if (!ts.isBlock(handler.body)) {
          const value = emptyValue(handler.body);
          if (value) report(handler.body, value, start, handler.getEnd());
        } else {
          for (const ret of ownReturns(handler.body)) {
            const value = emptyValue(ret.expression);
            if (value) report(ret, value, start, handler.getEnd());
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  checkDroppedQueryError(source, rel, lines, marked, report);
}

/**
 * A hook that runs a `useQuery` and answers `data ?? <empty>` while never
 * naming the query's `error`, so a throw reads as nothing there. The query
 * result is either a variable (`query.data`) or destructured (`{ data }`).
 */
function checkDroppedQueryError(source, rel, lines, marked, report) {
  const lineOf = (pos) => source.getLineAndCharacterOfPosition(pos).line;
  const isQueryCall = (node) =>
    !!node &&
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    /^use\w*Query$/.test(node.expression.text);
  const ERROR_FIELDS = new Set(['error', 'isError', 'status']);

  const checkFunction = (fn) => {
    const results = new Set();
    let dataName = null;
    let errorKept = false;
    const collect = (node) => {
      if (ts.isVariableDeclaration(node) && isQueryCall(node.initializer)) {
        if (ts.isIdentifier(node.name)) results.add(node.name.text);
        if (ts.isObjectBindingPattern(node.name)) {
          for (const el of node.name.elements) {
            const field = (el.propertyName ?? el.name).getText(source);
            if (field === 'data' && ts.isIdentifier(el.name)) dataName = el.name.text;
            if (ERROR_FIELDS.has(field) || el.dotDotDotToken) errorKept = true;
          }
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(fn.body);
    if (results.size === 0 && dataName === null) return;

    // A result used whole travels with its error, as `...query` or `query.error` do.
    const bodyText = fn.body.getText(source);
    for (const name of results) {
      const keeps = new RegExp(
        `\\.\\.\\.${name}\\b|\\b${name}\\.(?:${[...ERROR_FIELDS].join('|')})\\b`
      );
      if (keeps.test(bodyText)) errorKept = true;
    }
    if (errorKept) return;

    const visit = (node) => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        const left = node.left;
        const readsData =
          (ts.isPropertyAccessExpression(left) &&
            ts.isIdentifier(left.expression) &&
            results.has(left.expression.text) &&
            left.name.text === 'data') ||
          (ts.isIdentifier(left) && left.text === dataName);
        const orEmpty = emptyValue(node.right) || ts.isIdentifier(node.right);
        if (readsData && orEmpty && !marked(lineOf(fn.getStart(source)), lineOf(node.getEnd()))) {
          report(node, 'data ??', node.getStart(source), node.getEnd());
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(fn.body);
  };

  const walk = (node) => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)) &&
      node.body &&
      ts.isBlock(node.body)
    ) {
      checkFunction(node);
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
}

const sources = treeSources(ROOT, [CLIENT, DELEGATES, HOOKS]);
if (!sources.has(CLIENT)) {
  console.error(`lint-engine-read-empty: ${CLIENT} is not in the tree, so nothing was checked.`);
  process.exit(1);
}
for (const [rel, bytes] of sources) {
  const text = bytes.toString('utf8');
  const inScope =
    rel === CLIENT ||
    rel.startsWith(`${DELEGATES}/`) ||
    HOOK_FILE.test(rel) ||
    (LIB_FILE.test(rel) && ENGINE_IMPORT.test(text));
  if (!inScope || !/\.tsx?$/.test(rel)) continue;
  check(rel, text);
}

const baseline = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : {};
const found = {};
for (const o of offenders) {
  const file = o.at.slice(0, o.at.lastIndexOf(':'));
  found[file] = (found[file] ?? 0) + 1;
}
const allowed = new Set();
const stale = [];
for (const [file, count] of Object.entries(baseline)) {
  if ((found[file] ?? 0) < count) stale.push(`${file}  ${found[file] ?? 0}, baseline ${count}`);
  if ((found[file] ?? 0) <= count) allowed.add(file);
}
for (let i = offenders.length - 1; i >= 0; i--) {
  if (allowed.has(offenders[i].at.slice(0, offenders[i].at.lastIndexOf(':'))))
    offenders.splice(i, 1);
}
if (stale.length > 0) {
  console.error('The tree has beaten the empty-on-error baseline. Lower it in');
  console.error('scripts/engine-read-empty-baseline.json:');
  for (const line of stale) console.error(`  ${line}`);
}

if (markersWithoutReason.length > 0) {
  console.error('An empty-on-error marker gives no reason:');
  for (const at of markersWithoutReason) console.error(`  ${at}`);
}
if (offenders.length > 0) {
  console.error('An engine read answers a thrown error with an empty value:');
  for (const o of offenders) console.error(`  ${o.at}  ${o.text}`);
  console.error('');
  console.error('Let the VeloqError through and have the caller branch on engineErrorTag or');
  console.error('engineErrorKey (src/shared/native/engineError.ts). A write may answer false.');
  console.error('Where empty is the honest answer, say why on the line above the catch:');
  console.error('  // empty-on-error: <reason>');
}
if (offenders.length > 0 || markersWithoutReason.length > 0 || stale.length > 0) process.exit(1);
console.log('Engine reads: no catch answers an error with an empty value.');
