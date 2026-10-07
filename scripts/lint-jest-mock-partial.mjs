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

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { treeView } from './lib/indexedSources.mjs';

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
  '@expo/vector-icons/MaterialCommunityIcons':
    'one icon set of the package above, which pulls in expo-font the same way',
  'expo-localization':
    'loads its native module through expo-modules-core on import, and the suites that mock expo-modules-core (liveActivityController, liveActivityTraceStride, widgetBlankOnUninitialisedEngine) leave it none, so the global mock cannot spread it',
  'expo-file-system':
    'its File and Directory classes extend classes the native module defines, which are undefined outside a native runtime',
  '@react-native-async-storage/async-storage':
    'reads its native module on import, and the package ships a complete Jest mock',
};

const SHARED = /(^|\/)__shared__\//;

const tree = treeView(ROOT, ['src', 'config']);

function walk(dir, keep) {
  return tree.files(dir, (rel) => !rel.split('/').includes('node_modules') && keep(join(ROOT, rel)));
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

function isRequireActualOf(node, specifier) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'jest' &&
    node.expression.name.text === 'requireActual' &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0]) &&
    node.arguments[0].text === specifier
  );
}

function unwrap(node) {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

// The expressions a function hands back: its expression body, or what its own
// return statements return, not those of a function nested inside it.
function returned(fn) {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out = [];
  const visit = (node) => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) out.push(node.expression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn.body, visit);
  return out;
}

// Every expression a factory, or the shared mock export it delegates to, hands
// back must be an object that spreads the real module it replaces, directly,
// through a name bound to one, or through a call to a function in the same file
// that returns one. A spread anywhere else (a function nested in the returned
// object, a helper nobody calls), loading some other module (a locale file,
// react-native), taking one export of the right one, or spreading it into a
// nested object, leaves the rest of this module's exports undefined.
function bindings(root) {
  const initialisers = new Map();
  const functions = new Map();
  const exported = new Map();
  const isExported = (node) =>
    (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = unwrap(node.initializer);
      initialisers.set(node.name.text, init);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        functions.set(node.name.text, init);
        if (isExported(node)) exported.set(node.name.text, init);
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      functions.set(node.name.text, node);
      if (isExported(node)) exported.set(node.name.text, node);
    }
    ts.forEachChild(node, collect);
  };
  collect(root);
  return { initialisers, functions, exported };
}

function returnsActual(fn, specifier, scope, delegate) {
  const exprs = returned(fn);
  return exprs.length > 0 && exprs.every((expr) => spreadsActual(expr, specifier, scope, delegate));
}

function spreadsActual(node, specifier, scope, delegate, seen = new Set()) {
  const { initialisers, functions } = scope;
  const isActual = (n, names = new Set()) => {
    const inner = unwrap(n);
    if (isRequireActualOf(inner, specifier)) return true;
    if (!ts.isIdentifier(inner) || names.has(inner.text) || !initialisers.has(inner.text)) return false;
    names.add(inner.text);
    return isActual(initialisers.get(inner.text), names);
  };
  const inner = unwrap(node);
  if (ts.isObjectLiteralExpression(inner)) {
    return inner.properties.some((p) => ts.isSpreadAssignment(p) && isActual(p.expression));
  }
  if (ts.isIdentifier(inner)) {
    if (seen.has(inner.text) || !initialisers.has(inner.text)) return false;
    seen.add(inner.text);
    return spreadsActual(initialisers.get(inner.text), specifier, scope, delegate, seen);
  }
  if (ts.isCallExpression(inner)) {
    const callee = unwrap(inner.expression);
    if (ts.isIdentifier(callee) && functions.has(callee.text)) {
      if (seen.has(callee.text)) return false;
      seen.add(callee.text);
      return returnsActual(functions.get(callee.text), specifier, scope, delegate);
    }
    if (delegate) return delegate(inner);
  }
  return false;
}

function parse(file) {
  const text = tree.text(file);
  const kind = /x$/.test(file) ? ts.ScriptKind.TSX : /\.js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

// A shared mock resolves from the `@/` alias or relative to the suite.
function resolveShared(file, specifier) {
  const base = specifier.startsWith('@/')
    ? join(ROOT, 'src', specifier.slice(2))
    : resolve(dirname(file), specifier);
  for (const ext of ['', '.ts', '.tsx', '.js']) {
    if (tree.has(base + ext)) return base + ext;
  }
  return null;
}

// `require('<shared>').<name>(...)`, the one delegation shape a factory uses.
function sharedDelegation(call) {
  const callee = unwrap(call.expression);
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const target = unwrap(callee.expression);
  if (
    ts.isCallExpression(target) &&
    ts.isIdentifier(target.expression) &&
    target.expression.text === 'require' &&
    target.arguments.length === 1 &&
    ts.isStringLiteralLike(target.arguments[0]) &&
    SHARED.test(target.arguments[0].text)
  ) {
    return { shared: target.arguments[0].text, name: callee.name.text };
  }
  return null;
}

const failures = [];
const sharedChecked = new Map();

function checkShared(file, where, specifier, call) {
  const delegation = sharedDelegation(call);
  if (!delegation) return false;
  const path = resolveShared(file, delegation.shared);
  if (!path) {
    failures.push(`${where}  ${specifier}: shared mock ${delegation.shared} not found`);
    return true;
  }
  const key = `${path}\0${delegation.name}\0${specifier}`;
  if (!sharedChecked.has(key)) {
    const scope = bindings(parse(path));
    const fn = scope.exported.get(delegation.name);
    sharedChecked.set(key, fn ? returnsActual(fn, specifier, scope, null) : false);
  }
  if (!sharedChecked.get(key)) {
    failures.push(
      `${relative(ROOT, path)}  ${specifier}: shared mock export ${delegation.name} does not return a spread of jest.requireActual('${specifier}'), used at ${where}`
    );
  }
  return true;
}

for (const file of sourceFiles()) {
  const sf = parse(file);
  const scope = bindings(sf);
  const visit = (node) => {
    if (isJestMock(node)) {
      const specifier = node.arguments[0].text;
      const factory = unwrap(node.arguments[1]);
      if (!isLocal(specifier) && !(specifier in ALLOWLIST)) {
        const where = `${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
        let delegated = false;
        const delegate = (call) => {
          delegated = checkShared(file, where, specifier, call);
          return delegated;
        };
        // A name bound inside the factory shadows one bound elsewhere in the file.
        const own = bindings(factory);
        const local = {
          initialisers: new Map([...scope.initialisers, ...own.initialisers]),
          functions: new Map([...scope.functions, ...own.functions]),
        };
        const passes = ts.isFunctionLike(factory) && returnsActual(factory, specifier, local, delegate);
        if (!passes && !delegated) failures.push(`${where}  ${specifier}`);
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
