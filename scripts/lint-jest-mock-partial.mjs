#!/usr/bin/env node
// A `jest.mock('<package>', () => ({ ... }))` factory replaces the whole
// module, so every export it leaves out is undefined for everything else in
// that suite's graph. backupExclusion mocked `expo-modules-core` with one
// function and CI failed on a load order this machine never hit. A factory for
// a package that loads under Jest spreads `jest.requireActual` and overrides
// only what the suite asserts on, or delegates to a shared mock under
// `__tests__/__shared__/` that does.
//
// A package that cannot load under Jest at all is on the allowlist with the
// reason. Local modules (`@/`, relative paths) are out of scope: the suite owns
// both sides of those.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);

// Each of these throws on `jest.requireActual`, so there is nothing to spread.
const ALLOWLIST = {
  veloqrs: 'registers a TurboModule on import, which throws outside a native runtime',
  'react-native-iap': 'reaches a Nitro module on import, which throws outside a native runtime',
  'react-native-webview': 'reads its native view manager on import',
  '@shopify/react-native-skia': 'needs the native Skia binding on import',
  '@expo/vector-icons': 'pulls in expo-font, which resolves expo-asset, and expo-asset is not installed',
  'expo-localization':
    'loads its native module through expo-modules-core on import, and the suites that mock expo-modules-core (liveActivityController, liveActivityTraceStride, widgetBlankOnUninitialisedEngine) leave it none, so the global mock cannot spread it',
  '@react-native-async-storage/async-storage':
    'reads its native module on import, and the package ships a complete Jest mock',
};

const SHARED = /(^|\/)__shared__\//;

function walk(dir, keep) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walk(full, keep));
    } else if (keep(full)) {
      out.push(full);
    }
  }
  return out;
}

function sourceFiles() {
  const inTests = (full) =>
    /\.(test|spec)\.[jt]sx?$/.test(full) && relative(ROOT, full).split('/').includes('__tests__');
  const setup = (full) => /\/jest\.[^/]*\.js$/.test(full);
  return [...walk(join(ROOT, 'src'), inTests), ...walk(join(ROOT, 'config'), setup)];
}

function isLocal(specifier) {
  return specifier.startsWith('.') || specifier.startsWith('@/') || specifier.startsWith('/');
}

function isJestMock(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'jest' &&
    (node.expression.name.text === 'mock' || node.expression.name.text === 'doMock') &&
    node.arguments.length >= 2 &&
    ts.isStringLiteralLike(node.arguments[0])
  );
}

// A factory that loads the real module it replaces. Loading some other module,
// a locale file or react-native, leaves this one's other exports undefined.
function requiresActualOf(factory, specifier) {
  let found = false;
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'jest' &&
      node.expression.name.text === 'requireActual' &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === specifier
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(factory);
  return found;
}

function parse(file) {
  const text = readFileSync(file, 'utf8');
  const kind = /x$/.test(file) ? ts.ScriptKind.TSX : /\.js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

// A shared mock resolves from the `@/` alias or relative to the suite.
function resolveShared(file, specifier) {
  const base = specifier.startsWith('@/')
    ? join(ROOT, 'src', specifier.slice(2))
    : resolve(dirname(file), specifier);
  for (const ext of ['', '.ts', '.tsx', '.js']) {
    if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext;
  }
  return null;
}

function sharedRequires(factory) {
  const found = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      SHARED.test(node.arguments[0].text)
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(factory);
  return found;
}

const failures = [];
const sharedChecked = new Map();

for (const file of sourceFiles()) {
  const sf = parse(file);
  const visit = (node) => {
    if (isJestMock(node)) {
      const specifier = node.arguments[0].text;
      const factory = node.arguments[1];
      if (!isLocal(specifier) && !(specifier in ALLOWLIST)) {
        const where = `${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
        const shared = sharedRequires(factory);
        if (requiresActualOf(factory, specifier)) {
          // Spreads the real module, the same one it mocks.
        } else if (shared.length > 0) {
          for (const specifierOfShared of shared) {
            const path = resolveShared(file, specifierOfShared);
            if (!path) {
              failures.push(`${where}  ${specifier}: shared mock ${specifierOfShared} not found`);
              continue;
            }
            if (!sharedChecked.has(path)) {
              sharedChecked.set(path, readFileSync(path, 'utf8').includes('jest.requireActual('));
            }
            if (!sharedChecked.get(path)) {
              failures.push(
                `${relative(ROOT, path)}  ${specifier}: shared mock with no jest.requireActual, used at ${where}`
              );
            }
          }
        } else {
          failures.push(`${where}  ${specifier}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (failures.length > 0) {
  console.error(
    `Jest mock factories that replace the whole module: ${failures.length}. Every export they leave out is undefined for the rest of the suite's graph.`
  );
  console.error(
    "Spread `...jest.requireActual('<package>')` and override what the test asserts on, or add the package to ALLOWLIST in scripts/lint-jest-mock-partial.mjs with the reason it cannot load under Jest.\n"
  );
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Jest mock guard: every package factory spreads the actual module or is allowlisted.');
