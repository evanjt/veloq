#!/usr/bin/env node
// Every dialog goes through `src/shared/ui/dialog.ts`. A bare `Alert.alert`
// on Android ignores system back and a scrim tap, places its buttons by
// position whatever their style says, and a Promise only its buttons settle
// hangs when it is dismissed. The helpers pass the dismissal and the order.
// A failure notice titled with the bare generic word tells the athlete nothing
// about what failed, so `t('common.error')` and `t('alerts.error')` are refused
// as the title of a dialog. A confirm button labelled with the generic
// `t('common.confirm')` does not say what pressing it does, so the label names
// the action instead. Tests may call `Alert` to spy on it.

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { treeView } from './lib/indexedSources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? resolve(here, '..') : resolve(process.argv[rootFlag + 1]);
const tree = treeView(root, ['src']);
const OWNER = 'src/shared/ui/dialog.ts';
const HELPERS = new Set(['inform', 'confirmAction', 'chooseAction']);
const GENERIC_TITLES = new Set(['common.error', 'alerts.error']);
const GENERIC_LABELS = new Set(['common.confirm']);
const failures = [];

function isAlertCall(node) {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'Alert' &&
    (node.name.text === 'alert' || node.name.text === 'prompt')
  );
}

function calleeName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

/** `t('common.error')` or `i18n.t('alerts.error')`, for the keys in `keys`. */
function isTranslationOf(node, keys) {
  return (
    node !== undefined &&
    ts.isCallExpression(node) &&
    calleeName(node.expression) === 't' &&
    node.arguments.length > 0 &&
    ts.isStringLiteralLike(node.arguments[0]) &&
    keys.has(node.arguments[0].text)
  );
}

function check(file, source) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const at = (node) =>
    `${relative(root, file)}:${parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1}`;
  const visit = (node) => {
    if (isAlertCall(node)) {
      failures.push(`${at(node)}: raise dialogs through ${OWNER}, not Alert.${node.name.text}`);
    } else if (ts.isCallExpression(node) && HELPERS.has(calleeName(node.expression))) {
      const args = node.arguments[0];
      if (args && ts.isObjectLiteralExpression(args)) {
        for (const property of args.properties) {
          if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
          const name = property.name.text;
          if (name === 'title' && isTranslationOf(property.initializer, GENERIC_TITLES)) {
            failures.push(`${at(property)}: title the dialog for what failed, not a bare error`);
          } else if (
            name === 'confirmLabel' &&
            isTranslationOf(property.initializer, GENERIC_LABELS)
          ) {
            failures.push(`${at(property)}: name the action on the confirm button, not Confirm`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
}

const files = tree.files(
  join(root, 'src'),
  (file) =>
    /\.tsx?$/.test(file) &&
    !/\.(d|test|spec)\.tsx?$/.test(file) &&
    !file.includes('/__tests__/') &&
    !file.includes('/__mocks__/')
);
if (!files.some((file) => relative(root, file) === OWNER)) {
  console.error(`lint-dialog-owner: ${OWNER} not found`);
  process.exit(1);
}
for (const file of files) {
  if (relative(root, file) === OWNER) continue;
  const source = tree.text(file);
  if (!source || !/Alert|common\.error|alerts\.error|common\.confirm/.test(source)) continue;
  check(file, source);
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
