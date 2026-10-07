#!/usr/bin/env node
// A key written through setSetting that PREFERENCE_KEYS does not list is never
// copied out of AsyncStorage by the settings migration, so an athlete upgrading
// from an older build loses that preference without any error. This collects
// every literal key passed to setSetting under src/ and fails unless it is in
// PREFERENCE_KEYS or on ENGINE_ONLY_KEYS with a reason. A key the checker cannot
// resolve to a literal fails unless its call site is on DYNAMIC_WRITERS.
//
// `--root` points the lint at another tree, so the rule itself can be tested.

import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { treeView } from './lib/indexedSources.mjs';

const rootArg = process.argv.indexOf('--root');
const ROOT =
  rootArg === -1
    ? join(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.argv[rootArg + 1]);
const MIGRATION = 'src/shared/storage/migrateSettingsToSqlite.ts';

// Keys the engine owns and never held in AsyncStorage, so there is nothing to migrate.
const ENGINE_ONLY_KEYS = new Map([
  ['__athlete_id', 'Engine library identity'],
  ['__detection_enabled', 'Engine-only detection preference'],
  ['__export_home_lat', 'Engine-only export privacy preference'],
  ['__export_home_lng', 'Engine-only export privacy preference'],
  ['__export_privacy_radius_m', 'Engine-only export privacy preference'],
  ['oldest_activity_date', 'Demo library boundary'],
  ['sync.last_success_at', 'Engine sync history'],
  ['__last_auto_backup', 'Engine backup history'],
  ['__backup_backend', 'Engine-only backup preference'],
  ['__auto_backup_enabled', 'Engine-only backup preference'],
  ['__last_backup_failure', 'Engine backup diagnostic'],
  ['__backup_folder', 'Engine-only backup folder grant, bound to this device'],
  ['__backup_folder_name', 'Engine-only backup folder grant, bound to this device'],
  ['__platform_record_answered', 'Engine library restore marker'],
  ['__section_health_check_done', 'Engine library health check stamp'],
  ['__settings_migrated', 'Migration completion marker'],
  ['veloq-terrain-override-cleanup-done', 'Migration completion marker'],
]);

// Call sites whose key is a parameter, each forwarding keys that are checked at their own callers.
const DYNAMIC_WRITERS = new Map([
  ['src/shared/storage/settingsStorage.ts:key', 'Dual-write helper forwards its callers'],
  [
    'src/shared/storage/migrateSettingsToSqlite.ts:key',
    'Migration iterates the preference inventory',
  ],
  [
    'src/shared/storage/migrateSettingsToSqlite.ts:sentinelKey',
    'Migration writes its completion marker',
  ],
]);

const tree = treeView(ROOT, ['src']);

const sources = (dir) =>
  tree.files(dir, (rel) => !rel.split('/').includes('__tests__') && /\.tsx?$/.test(rel));

function stripCasts(node) {
  while (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}

function preferenceKeys(file) {
  const source = ts.createSourceFile(
    file,
    tree.text(file),
    ts.ScriptTarget.Latest,
    true
  );
  const arrays = new Map();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer) {
        arrays.set(decl.name.text, stripCasts(decl.initializer));
      }
    }
  }
  const keys = new Set();
  const collect = (node, seen) => {
    if (!ts.isArrayLiteralExpression(node)) return;
    for (const element of node.elements) {
      if (ts.isSpreadElement(element) && ts.isIdentifier(element.expression)) {
        const name = element.expression.text;
        if (!seen.has(name) && arrays.has(name))
          collect(arrays.get(name), new Set([...seen, name]));
      } else if (ts.isStringLiteralLike(element)) {
        keys.add(element.text);
      }
    }
  };
  if (arrays.has('PREFERENCE_KEYS'))
    collect(arrays.get('PREFERENCE_KEYS'), new Set(['PREFERENCE_KEYS']));
  return keys;
}

const files = sources(join(ROOT, 'src'));
const writers = files.filter((file) => /\bsetSetting\b/.test(tree.text(file)));
// The compiler reads the tree's own bytes, so it never opens the working copy.
const host = ts.createCompilerHost({}, true);
host.getSourceFile = (name, languageVersion) => {
  const text = tree.text(name);
  return text === undefined ? undefined : ts.createSourceFile(name, text, languageVersion, true);
};
host.fileExists = (name) => tree.has(name);
host.readFile = (name) => tree.text(name);
const program = ts.createProgram(writers, { noResolve: true, noLib: true }, host);
const checker = program.getTypeChecker();
const covered = new Set([...preferenceKeys(join(ROOT, MIGRATION)), ...ENGINE_ONLY_KEYS.keys()]);
const failures = [];

for (const file of writers) {
  const source = program.getSourceFile(file);
  const rel = relative(ROOT, file).split(sep).join('/');
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const symbol = checker.getSymbolAtLocation(callee);
      const imported = symbol?.declarations?.some(
        (decl) =>
          ts.isImportSpecifier(decl) && (decl.propertyName ?? decl.name).text === 'setSetting'
      );
      if (
        imported ||
        (ts.isIdentifier(callee) && callee.text === 'setSetting') ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'setSetting')
      ) {
        const key = node.arguments[0];
        if (key) {
          const site = `${rel}:${key.getText(source)}`;
          const type = checker.getTypeAtLocation(key);
          if (type.isStringLiteral()) {
            if (!covered.has(type.value)) failures.push(`${rel}: ${type.value}`);
          } else if (!DYNAMIC_WRITERS.has(site)) {
            failures.push(`${site} (unresolved key)`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (failures.length > 0) {
  console.error('setSetting keys the settings migration does not cover:');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    `Add the key to PREFERENCE_KEYS in ${MIGRATION}, or to ENGINE_ONLY_KEYS in scripts/lint-setting-keys.mjs with a reason.`
  );
  process.exit(1);
}
console.log(`lint-setting-keys: ${writers.length} writer files, every key covered`);
