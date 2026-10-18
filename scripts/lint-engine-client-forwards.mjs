#!/usr/bin/env node
// The engine's TypeScript API is the delegate namespaces the `veloqrs` barrel
// binds to the client. A client member whose whole body hands `this` to a
// delegate is a second door to the same function: every export was written
// twice, and a component could reach it either way. This refuses one.
//
// The members still to move are listed in the baseline, and the list only
// shrinks: an entry that is no longer a forward on the client is refused until
// it is removed, so a moved member cannot come back under its old name.
//
// Usage: node scripts/lint-engine-client-forwards.mjs [--root <dir>]

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { trackedText } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);

const CLIENT = 'modules/veloqrs/src/EngineClient.ts';
const BASELINE = 'scripts/engine-client-forwards-baseline.json';

/** The one expression a member's arrow body evaluates, or undefined. */
function soleExpression(body) {
  if (!ts.isBlock(body)) return body;
  if (body.statements.length !== 1) return undefined;
  const [statement] = body.statements;
  if (ts.isReturnStatement(statement)) return statement.expression;
  if (ts.isExpressionStatement(statement)) return statement.expression;
  return undefined;
}

/** Whether `call` is `<name>Delegates.<fn>(this, ...)`. */
function isDelegateForward(call) {
  if (!call || !ts.isCallExpression(call)) return false;
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return false;
  if (!/Delegates$/.test(callee.expression.text)) return false;
  const [first] = call.arguments;
  return first !== undefined && first.kind === ts.SyntaxKind.ThisKeyword;
}

/** Every member of every class in `source` that only forwards to a delegate. */
export function delegateForwards(source) {
  const sf = ts.createSourceFile(CLIENT, source, ts.ScriptTarget.Latest, true);
  const found = [];
  const visit = (node) => {
    if (ts.isClassDeclaration(node)) {
      for (const member of node.members) {
        let body;
        if (ts.isPropertyDeclaration(member) && member.initializer) {
          const init = member.initializer;
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) body = init.body;
        } else if (ts.isMethodDeclaration(member) && member.body) {
          body = member.body;
        }
        if (body && isDelegateForward(soleExpression(body))) {
          const line = sf.getLineAndCharacterOfPosition(member.getStart()).line + 1;
          found.push({ name: member.name.getText(sf), line });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function main() {
  const source = trackedText(ROOT, CLIENT);
  if (source === undefined) {
    console.error(`Engine client forwards: ${CLIENT} could not be read.`);
    process.exit(1);
  }
  const baselineText = trackedText(ROOT, BASELINE);
  const listed = new Set(baselineText === undefined ? [] : JSON.parse(baselineText).forwards);

  const forwards = delegateForwards(source);
  const unlisted = forwards.filter((f) => !listed.has(f.name));
  const present = new Set(forwards.map((f) => f.name));
  const stale = [...listed].filter((name) => !present.has(name)).sort();

  if (unlisted.length === 0 && stale.length === 0) {
    console.log(`Engine client forwards: ${forwards.length}, each listed in ${BASELINE}.`);
    return;
  }
  if (unlisted.length > 0) {
    console.error(
      `Engine client forwards: ${unlisted.length} member(s) only hand this to a delegate:`
    );
    for (const f of unlisted) console.error(`  ${CLIENT}:${f.line}  ${f.name}`);
    console.error(
      'Call the bound namespace the veloqrs barrel exports instead, and delete the member.'
    );
  }
  if (stale.length > 0) {
    console.error(
      `Engine client forwards: ${BASELINE} lists ${stale.length} that the client no longer forwards:`
    );
    for (const name of stale) console.error(`  ${name}`);
    console.error('Remove each from the baseline, so the forward cannot come back.');
  }
  process.exit(1);
}

main();
